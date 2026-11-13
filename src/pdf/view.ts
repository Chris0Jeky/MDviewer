/**
 * The PDF reading view (P1, PDF_WORKBENCH.md): continuous pages drawn on demand, a selectable
 * text layer, find, bookmarks as the outline, thumbnails, zoom, links and a password prompt.
 * Only visible pages hold bitmaps; at most MAX_LIVE pages are drawn at once.
 */
import { openPdf, PdfOpenError, type PdfDocument, type Rect } from "./engine";
import { describe, Journal, type PdfEdit } from "./journal";

export interface PdfViewOptions {
  name: string;
  bytes: Uint8Array;
  /** The shell's outline panel; the view fills it with the PDF's bookmarks while it is shown. */
  outline: HTMLElement;
  /** The shell's one path for http(s) links. */
  openExternal(url: string): void;
  /** Aborted when the shell no longer wants this view (another PDF was chosen before it opened). */
  signal?: AbortSignal;
  /** Save bytes as a copy the user places (download on the web, a native dialog on Windows). */
  saveCopy?(bytes: Uint8Array, filename: string): Promise<void>;
  /** Open bytes as a new, unsaved PDF tab (Extract). */
  openPdf?(name: string, bytes: Uint8Array): void;
  /** The document has (or no longer has) unsaved changes. */
  onDirty?(dirty: boolean): void;
  /** A one-line status (page, count, zoom). */
  status(text: string): void;
}

export interface PdfView {
  readonly pageCount: number;
  zoomBy(step: number): void;
  focusFind(): void;
  /** Re-fill the shell outline (after the shell switched back to this PDF). */
  showOutline(): void;
  /** `keepDocument` leaves the engine document open (an internal rebuild after an edit). */
  destroy(keepDocument?: boolean): void;
}

/** What survives a rebuild of the view after an edit, undo or redo. */
interface Session {
  doc: PdfDocument;
  journal: Journal;
  zoom: number;
  page: number;
  thumbs: boolean;
  selected: Set<number>;
  rebuild(): void;
}

const MAX_LIVE = 12;
/** About 400 MB of RGBA across the drawn pages (PDF_WORKBENCH.md, "Caps"). */
const MAX_LIVE_PIXELS = 100_000_000;
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const GAP = 16;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ICONS: Record<string, string> = {
  thumbs: '<rect x="2" y="2.5" width="4.5" height="5" rx="1"/><rect x="2" y="9.5" width="4.5" height="4" rx="1"/><path d="M9 3.5h5M9 6h5M9 10.5h5M9 13h3"/>',
  minus: '<path d="M3.5 8h9"/>',
  plus: '<path d="M3.5 8h9M8 3.5v9"/>',
  up: '<path d="M4 10l4-4 4 4"/>',
  down: '<path d="M4 6l4 4 4-4"/>',
  fit: '<path d="M2.5 8h11M5 5.5L2.5 8 5 10.5M11 5.5l2.5 2.5-2.5 2.5"/>',
  rotl: '<path d="M3 6.5A5 5 0 1 1 4.5 11.5"/><path d="M3 3v3.5h3.5"/>',
  rotr: '<path d="M13 6.5A5 5 0 1 0 11.5 11.5"/><path d="M13 3v3.5H9.5"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8.5" rx="1"/><path d="M3.5 10.5V3a1 1 0 0 1 1-1h6"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
  blank: '<path d="M4 2h5.5L12 4.5V14H4z"/><path d="M8 7.5v4M6 9.5h4"/>',
  image: '<rect x="2.5" y="3" width="11" height="10" rx="1"/><path d="M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5"/><circle cx="10.5" cy="6" r="1"/>',
  addpdf: '<path d="M4 2h5.5L12 4.5V14H4z"/><path d="M9.5 2v2.5H12M6 10h4M8 8v4"/>',
  extract: '<path d="M4 2h5.5L12 4.5V8M4 2v12h4"/><path d="M10 11h4.5M12.5 9l2 2-2 2"/>',
  undo: '<path d="M4 6.5h6a3.5 3.5 0 0 1 0 7H6"/><path d="M6.5 4L4 6.5 6.5 9"/>',
  redo: '<path d="M12 6.5H6a3.5 3.5 0 0 0 0 7h4"/><path d="M9.5 4L12 6.5 9.5 9"/>',
};

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name]!; // static markup defined above, never document content
  return svg;
}

function button(label: string | SVGSVGElement, title: string, className = "pdf-button"): HTMLButtonElement {
  const b = el("button", className);
  b.append(label);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  return b;
}

/** Mount a PDF into `host`. Resolves once the document is open (or the password prompt shows). */
export async function mountPdf(host: HTMLElement, options: PdfViewOptions): Promise<PdfView> {
  const root = el("div", "pdf-view");
  host.replaceChildren(root);
  let view: PdfView | null = null;
  let destroyed = false;

  const shell: PdfView = {
    get pageCount() { return view?.pageCount ?? 0; },
    zoomBy: step => view?.zoomBy(step),
    focusFind: () => view?.focusFind(),
    showOutline: () => view?.showOutline(),
    destroy: () => { destroyed = true; view?.destroy(); root.remove(); },
  };

  const attempt = async (password: string): Promise<boolean> => {
    try {
      const doc = await openPdf(options.bytes, password);
      if (destroyed || options.signal?.aborted) { doc.close(); root.remove(); return true; }
      const session: Session = {
        doc, journal: new Journal(options.bytes, password), zoom: 1, page: 0, thumbs: false, selected: new Set(),
        rebuild: () => {
          view?.destroy(true);
          view = buildView(root, session.doc, options, session);
        },
      };
      try { view = buildView(root, doc, options, session); } catch (error) { doc.close(); throw error; }
      return true;
    } catch (error) {
      if (error instanceof PdfOpenError && error.code === "password") return false;
      root.replaceChildren(el("p", "pdf-error", error instanceof Error ? error.message : "This PDF could not be opened."));
      options.status(`${options.name} · could not be opened`);
      return true;
    }
  };

  if (!await attempt("")) passwordPrompt(root, options, attempt);
  return shell;
}

/** The password lives only in this closure and the engine call (security rule 5). */
function passwordPrompt(root: HTMLElement, options: PdfViewOptions, attempt: (password: string) => Promise<boolean>): void {
  const form = el("form", "pdf-password");
  const heading = el("h2", undefined, `${options.name} is protected`);
  const label = el("label", undefined, "Password");
  const input = el("input");
  input.type = "password";
  input.autocomplete = "off";
  input.required = true;
  label.append(input);
  const submit = el("button", "pdf-primary", "Open");
  submit.type = "submit";
  const message = el("p", "pdf-password-message");
  message.setAttribute("role", "status");
  form.append(heading, el("p", undefined, "Enter the password to read this PDF. It is kept in memory only while this tab is open."), label, submit, message);
  root.replaceChildren(form);
  options.status(`${options.name} · password needed`);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const password = input.value;
    submit.disabled = true;
    void attempt(password).then(opened => {
      submit.disabled = false;
      if (opened) return;
      input.value = "";
      message.textContent = "That password did not open this PDF. Try again.";
      input.focus();
    });
  });
  queueMicrotask(() => input.focus());
}

function buildView(root: HTMLElement, doc: PdfDocument, options: PdfViewOptions, session: Session): PdfView {
  const sizes = Array.from({ length: doc.pageCount }, (_, i) => doc.pageSize(i));
  let zoom = session.zoom;
  let current = Math.min(session.page, doc.pageCount - 1);
  for (const index of [...session.selected]) if (index >= doc.pageCount) session.selected.delete(index);

  // Toolbar
  const toolbar = el("div", "pdf-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "PDF");
  const thumbsToggle = button(icon("thumbs"), "Page thumbnails", "pdf-button pdf-thumbs-toggle");
  thumbsToggle.setAttribute("aria-pressed", "false");
  const pageInput = el("input", "pdf-page-input");
  pageInput.type = "number";
  pageInput.min = "1";
  pageInput.max = String(doc.pageCount);
  pageInput.value = "1";
  pageInput.setAttribute("aria-label", "Page number");
  const pageOf = el("span", "pdf-page-of", `of ${doc.pageCount}`);
  const zoomOut = button(icon("minus"), "Zoom out (Ctrl+-)");
  const zoomLabel = el("output", "pdf-zoom-label", "100%");
  const zoomIn = button(icon("plus"), "Zoom in (Ctrl+=)");
  const fitWidth = button(icon("fit"), "Fit the page width");
  const find = el("input", "pdf-find");
  find.type = "search";
  find.placeholder = "Find in PDF";
  find.setAttribute("aria-label", "Find in PDF");
  find.setAttribute("aria-keyshortcuts", "Control+F");
  const findPrev = button(icon("up"), "Previous match (Shift+Enter)");
  const findNext = button(icon("down"), "Next match (Enter)");
  const findCount = el("span", "pdf-find-count");
  findCount.setAttribute("aria-live", "polite");
  const group = (...children: HTMLElement[]): HTMLElement => { const g = el("div", "pdf-group"); g.append(...children); return g; };
  toolbar.append(
    group(thumbsToggle),
    group(pageInput, pageOf),
    group(zoomOut, zoomLabel, zoomIn, fitWidth),
    group(find, findPrev, findNext, findCount),
  );

  // Pages bar (P2): operations act on the selected thumbnails, or on the current page.
  const pagebar = el("div", "pdf-toolbar pdf-pagebar");
  pagebar.setAttribute("role", "toolbar");
  pagebar.setAttribute("aria-label", "Pages");
  const target = el("span", "pdf-target");
  target.setAttribute("aria-live", "polite");
  const rotateLeft = button(icon("rotl"), "Rotate left");
  const rotateRight = button(icon("rotr"), "Rotate right");
  const moveEarlier = button(icon("up"), "Move earlier");
  const moveLater = button(icon("down"), "Move later");
  const duplicate = button(icon("copy"), "Duplicate");
  const remove = button(icon("trash"), "Delete (Del in thumbnails)");
  const insertBlank = button(icon("blank"), "Insert a blank page after");
  const insertImages = button(icon("image"), "Insert images as pages…");
  const insertPdfs = button(icon("addpdf"), "Insert pages from other PDFs…");
  const extract = button(icon("extract"), "Extract to a new PDF");
  const undo = button(icon("undo"), "Undo (Ctrl+Z)");
  const redo = button(icon("redo"), "Redo (Ctrl+Y)");
  const save = el("button", "pdf-primary pdf-save", "Save a copy…");
  save.type = "button";
  const pick = (accept: string): HTMLInputElement => {
    const input = el("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.hidden = true;
    return input;
  };
  const imagePicker = pick("image/png,image/jpeg,.png,.jpg,.jpeg");
  const pdfPicker = pick(".pdf,application/pdf");
  pagebar.append(
    group(target),
    group(rotateLeft, rotateRight, moveEarlier, moveLater, duplicate, remove),
    group(insertBlank, insertImages, insertPdfs, extract),
    group(undo, redo),
    group(save),
    imagePicker, pdfPicker,
  );
  undo.disabled = !session.journal.canUndo;
  redo.disabled = !session.journal.canRedo;
  if (!options.saveCopy) save.hidden = true;
  if (!options.openPdf) extract.hidden = true;

  // Body
  const body = el("div", "pdf-body");
  const thumbs = el("nav", "pdf-thumbs");
  thumbs.setAttribute("aria-label", "Pages");
  thumbs.hidden = true;
  const scroller = el("div", "pdf-scroll");
  scroller.tabIndex = 0;
  scroller.setAttribute("aria-label", `${options.name}, ${doc.pageCount} pages`);
  const column = el("div", "pdf-pages");
  scroller.append(column);
  body.append(thumbs, scroller);
  root.replaceChildren(toolbar, pagebar, body);

  const pages = sizes.map((_, i) => {
    const page = el("div", "pdf-page");
    page.dataset.page = String(i);
    page.setAttribute("role", "region");
    page.setAttribute("aria-label", `Page ${i + 1}`);
    column.append(page);
    return page;
  });

  const layout = (): void => {
    column.style.setProperty("--pdf-gap", `${GAP}px`);
    sizes.forEach((size, i) => {
      pages[i]!.style.width = `${size.width * zoom}px`;
      pages[i]!.style.height = `${size.height * zoom}px`;
    });
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  };

  // Drawing: visible pages draw, the oldest beyond MAX_LIVE are released.
  const live = new Map<number, { zoom: number; pixels: number }>();
  const visible = new Set<number>();
  let queued = false;
  let closed = false;
  /** The pages to hold drawn: the MAX_LIVE visible pages nearest the current one. */
  const wanted = (): number[] => [...visible].sort((a, b) => Math.abs(a - current) - Math.abs(b - current)).slice(0, MAX_LIVE);
  const drawQueue = (): void => {
    if (queued || closed) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (closed) return;
      const next = wanted().find(i => live.get(i)?.zoom !== zoom);
      if (next === undefined) return;
      draw(next);
      drawQueue();
    });
  };

  const draw = (i: number): void => {
    const page = pages[i]!;
    const scale = zoom * (window.devicePixelRatio || 1);
    let image;
    try { image = doc.render(i, scale); } catch (error) {
      page.replaceChildren(el("p", "pdf-error", error instanceof Error ? error.message : "This page could not be drawn."));
      live.set(i, { zoom, pixels: 0 });
      return;
    }
    const canvas = el("canvas", "pdf-canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    canvas.setAttribute("aria-hidden", "true");
    page.replaceChildren(canvas, textLayer(i), linkLayer(i), hitLayer(i));
    live.delete(i);
    live.set(i, { zoom, pixels: image.width * image.height });
    // Release the oldest pages beyond MAX_LIVE or MAX_LIVE_PIXELS, never one on screen.
    const total = (): number => [...live.values()].reduce((sum, entry) => sum + entry.pixels, 0);
    const keep = new Set(wanted());
    for (const old of [...live.keys()]) {
      if (live.size <= MAX_LIVE && total() <= MAX_LIVE_PIXELS) break;
      if (keep.has(old) || old === i) continue;
      release(old);
    }
  };

  const release = (i: number): void => {
    pages[i]!.replaceChildren();
    live.delete(i);
    doc.releasePage(i);
  };

  const measure = document.createElement("canvas").getContext("2d");
  const textLayer = (i: number): HTMLElement => {
    const layer = el("div", "pdf-text");
    for (const run of doc.textRuns(i)) {
      const span = el("span", undefined, run.text);
      const size = run.height * zoom;
      span.style.left = `${run.x * zoom}px`;
      span.style.top = `${run.y * zoom}px`;
      span.style.fontSize = `${size}px`;
      if (measure) {
        measure.font = `${size}px sans-serif`;
        const width = measure.measureText(run.text).width;
        if (width > 0) span.style.transform = `scaleX(${(run.width * zoom) / width})`;
      }
      layer.append(span, el("br"));
    }
    return layer;
  };

  const place = (node: HTMLElement, rect: Rect): void => {
    node.style.left = `${rect.x * zoom}px`;
    node.style.top = `${rect.y * zoom}px`;
    node.style.width = `${rect.width * zoom}px`;
    node.style.height = `${rect.height * zoom}px`;
  };

  const linkLayer = (i: number): HTMLElement => {
    const layer = el("div", "pdf-links");
    for (const { rect, target } of doc.links(i)) {
      let node: HTMLElement;
      if (target.kind === "page") {
        node = el("a", "pdf-link");
        (node as HTMLAnchorElement).href = `#page-${target.page + 1}`;
        node.setAttribute("aria-label", `Go to page ${target.page + 1}`);
        node.addEventListener("click", event => { event.preventDefault(); goTo(target.page); });
      } else if (target.kind === "uri") {
        // No href: only this handler opens it, through the shell (no middle-click or drag bypass).
        node = el("a", "pdf-link");
        node.tabIndex = 0;
        node.setAttribute("role", "link");
        node.setAttribute("aria-label", `Open ${target.uri}`);
        node.title = target.uri;
        const open = (): void => options.openExternal(target.uri);
        node.addEventListener("click", event => { event.preventDefault(); open(); });
        node.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); open(); } });
      } else {
        node = el("span", "pdf-link pdf-link-blocked");
        node.title = `Not followed: ${target.reason}`;
      }
      place(node, rect);
      layer.append(node);
    }
    return layer;
  };

  // Find
  let hits: Array<{ page: number; rects: Rect[] }> = [];
  let hitIndex = -1;
  let findGeneration = 0;
  const hitLayer = (i: number): HTMLElement => {
    const layer = el("div", "pdf-hits");
    hits.forEach((hit, n) => {
      if (hit.page !== i) return;
      for (const rect of hit.rects) {
        const mark = el("div", n === hitIndex ? "pdf-hit is-current" : "pdf-hit");
        place(mark, rect);
        layer.append(mark);
      }
    });
    return layer;
  };
  const repaintHits = (): void => {
    for (const i of live.keys()) pages[i]!.querySelector(".pdf-hits")?.replaceWith(hitLayer(i));
  };
  const runFind = async (query: string): Promise<void> => {
    const generation = ++findGeneration;
    hits = [];
    hitIndex = -1;
    repaintHits();
    if (!query.trim()) { findCount.textContent = ""; return; }
    findCount.textContent = "Searching…";
    for (let i = 0; i < doc.pageCount; i++) {
      if (generation !== findGeneration) return;
      for (const rects of doc.find(i, query)) hits.push({ page: i, rects });
      // Yield every few pages so typing and scrolling stay responsive on long files.
      if (i % 20 === 19) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (generation !== findGeneration) return;
    if (hits.length) stepHit(1); else { findCount.textContent = "No matches"; repaintHits(); }
  };
  const stepHit = (delta: number): void => {
    if (!hits.length) return;
    hitIndex = (hitIndex + delta + hits.length) % hits.length;
    findCount.textContent = `${hitIndex + 1} of ${hits.length}`;
    const hit = hits[hitIndex]!;
    const rect = hit.rects[0];
    goTo(hit.page, rect ? rect.y * zoom - scroller.clientHeight / 3 : 0);
    repaintHits();
  };
  let findTimer = 0;
  find.addEventListener("input", () => {
    window.clearTimeout(findTimer);
    findTimer = window.setTimeout(() => { void runFind(find.value); }, 200);
  });
  find.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); stepHit(event.shiftKey ? -1 : 1); }
    if (event.key === "Escape") { find.value = ""; void runFind(""); scroller.focus(); }
  });
  findNext.addEventListener("click", () => stepHit(1));
  findPrev.addEventListener("click", () => stepHit(-1));

  // Navigation
  const offsetOf = (i: number): number => pages[i]!.offsetTop - column.offsetTop;
  function goTo(i: number, within = 0): void {
    scroller.scrollTop = offsetOf(i) + within;
  }
  const currentPage = (): number => {
    const middle = scroller.scrollTop + scroller.clientHeight / 2;
    let low = 0, high = pages.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (offsetOf(mid) <= middle) low = mid; else high = mid - 1;
    }
    return low;
  };
  const syncPage = (): void => {
    const page = currentPage();
    if (page === current && pageInput.value === String(page + 1)) return;
    current = page;
    if (document.activeElement !== pageInput) pageInput.value = String(page + 1);
    options.status(`${options.name} · page ${page + 1} of ${doc.pageCount} · PDF`);
    for (const thumb of thumbs.children) thumb.toggleAttribute("aria-current", (thumb as HTMLElement).dataset.page === String(page));
    if (!session.selected.size) target.textContent = `Page ${page + 1}`;
  };
  scroller.addEventListener("scroll", syncPage, { passive: true });
  pageInput.addEventListener("change", () => {
    const n = Math.min(doc.pageCount, Math.max(1, Math.round(Number(pageInput.value)) || 1));
    pageInput.value = String(n);
    goTo(n - 1);
  });

  // Zoom keeps the current page and the offset within it.
  const setZoom = (next: number): void => {
    const clamped = Math.min(4, Math.max(0.25, next));
    if (clamped === zoom) return;
    const page = currentPage();
    const within = (scroller.scrollTop - offsetOf(page)) / zoom;
    zoom = clamped;
    layout();
    for (const i of [...live.keys()]) if (!visible.has(i)) release(i);
    goTo(page, within * zoom);
    drawQueue();
  };
  const zoomBy = (step: number): void => {
    const at = ZOOMS.findIndex(z => z >= zoom - 1e-6);
    const index = step > 0 ? (ZOOMS[at] !== undefined && ZOOMS[at]! > zoom + 1e-6 ? at : at + 1) : at - 1;
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, index))]!);
  };
  zoomIn.addEventListener("click", () => zoomBy(1));
  zoomOut.addEventListener("click", () => zoomBy(-1));
  fitWidth.addEventListener("click", () => {
    const widest = Math.max(...sizes.map(size => size.width));
    setZoom((scroller.clientWidth - 2 * GAP) / widest);
  });

  // Thumbnails draw lazily while the strip is open.
  const thumbObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const item = entry.target as HTMLElement;
      thumbObserver.unobserve(item);
      const i = Number(item.dataset.page);
      try {
        const image = doc.render(i, 120 / Math.max(sizes[i]!.width, sizes[i]!.height));
        const canvas = el("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d")?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        canvas.setAttribute("aria-hidden", "true");
        item.prepend(canvas);
      } catch { /* the label stays; the page view reports the error */ }
      if (!live.has(i)) doc.releasePage(i); // thumbnails keep no engine handles
    }
  }, { root: thumbs, rootMargin: "200px 0px" });
  let thumbsBuilt = false;
  let anchor = current;
  const showSelection = (): void => {
    for (const thumb of thumbs.children) {
      const i = Number((thumb as HTMLElement).dataset.page);
      thumb.setAttribute("aria-pressed", String(session.selected.has(i)));
    }
    const n = session.selected.size;
    target.textContent = n > 1 ? `${n} pages selected` : n === 1 ? `Page ${[...session.selected][0]! + 1} selected` : `Page ${current + 1}`;
  };
  const buildThumbs = (): void => {
    if (thumbsBuilt) return;
    thumbsBuilt = true;
    thumbs.replaceChildren(...sizes.map((_, i) => {
      const item = button("", `Page ${i + 1}`, "pdf-thumb");
      item.dataset.page = String(i);
      item.draggable = true;
      item.append(el("span", undefined, String(i + 1)));
      item.addEventListener("click", event => {
        if (event.shiftKey) {
          const [from, to] = [Math.min(anchor, i), Math.max(anchor, i)];
          for (let n = from; n <= to; n++) session.selected.add(n);
        } else if (event.ctrlKey || event.metaKey) {
          if (!session.selected.delete(i)) session.selected.add(i);
          anchor = i;
        } else {
          session.selected.clear();
          session.selected.add(i);
          anchor = i;
          goTo(i);
        }
        showSelection();
      });
      item.addEventListener("keydown", event => {
        if (event.key === "Delete") { event.preventDefault(); remove.click(); }
      });
      item.addEventListener("dragstart", event => {
        if (!session.selected.has(i)) { session.selected.clear(); session.selected.add(i); showSelection(); }
        event.dataTransfer?.setData("application/x-mdviewer-pdf-pages", "1");
      });
      item.addEventListener("dragover", event => {
        if (event.dataTransfer?.types.includes("application/x-mdviewer-pdf-pages")) event.preventDefault();
      });
      item.addEventListener("drop", event => {
        if (!event.dataTransfer?.types.includes("application/x-mdviewer-pdf-pages")) return;
        event.preventDefault();
        event.stopPropagation();
        const moving = [...session.selected].sort((a, b) => a - b);
        const before = moving.filter(page => page < i).length;
        const to = Math.min(doc.pageCount - moving.length, Math.max(0, i - before));
        void edit({ op: "move", pages: moving, to }, to);
      });
      thumbObserver.observe(item);
      return item;
    }));
    showSelection();
    syncPage();
  };
  const setThumbs = (open: boolean): void => {
    thumbs.hidden = !open;
    session.thumbs = open;
    thumbsToggle.setAttribute("aria-pressed", String(open));
    if (open) buildThumbs();
  };
  thumbsToggle.addEventListener("click", () => setThumbs(!session.thumbs));

  // Edits (P2): journal, rebuild, dirty mark.
  const targets = (): number[] => (session.selected.size ? [...session.selected] : [current]).sort((a, b) => a - b);
  const remember = (page: number): void => {
    session.zoom = zoom;
    session.page = Math.max(0, page);
  };
  let busy = false;
  const edit = async (change: PdfEdit, focusPage = current): Promise<void> => {
    if (busy) return;
    try {
      session.journal.record(session.doc, change);
    } catch (error) {
      options.status(`${options.name} · ${error instanceof Error ? error.message : "That change could not be made."}`);
      return;
    }
    session.selected.clear();
    remember(focusPage);
    options.onDirty?.(session.journal.dirty);
    options.status(`${options.name} · ${describe(change)} · not saved`);
    session.rebuild();
  };
  const step = async (direction: "undo" | "redo"): Promise<void> => {
    if (busy || (direction === "undo" ? !session.journal.canUndo : !session.journal.canRedo)) return;
    busy = true;
    try {
      const next = await (direction === "undo" ? session.journal.undo() : session.journal.redo());
      const old = session.doc;
      session.doc = next;
      old.close();
      session.selected.clear();
      remember(Math.min(current, next.pageCount - 1));
      options.onDirty?.(session.journal.dirty);
      options.status(`${options.name} · ${direction === "undo" ? "Undone" : "Redone"}`);
      busy = false;
      session.rebuild();
    } catch (error) {
      busy = false;
      options.status(`${options.name} · ${error instanceof Error ? error.message : "That could not be undone."}`);
    }
  };
  rotateLeft.addEventListener("click", () => void edit({ op: "rotate", pages: targets(), quarterTurns: -1 }));
  rotateRight.addEventListener("click", () => void edit({ op: "rotate", pages: targets(), quarterTurns: 1 }));
  duplicate.addEventListener("click", () => {
    const pages = targets();
    void edit({ op: "duplicate", pages }, pages[pages.length - 1]! + 1);
  });
  remove.addEventListener("click", () => {
    const pages = targets();
    void edit({ op: "delete", pages }, Math.max(0, pages[0]! - 1));
  });
  moveEarlier.addEventListener("click", () => {
    const pages = targets();
    if (pages[0]! > 0) void edit({ op: "move", pages, to: pages[0]! - 1 }, pages[0]! - 1);
  });
  moveLater.addEventListener("click", () => {
    const pages = targets();
    if (pages[pages.length - 1]! < doc.pageCount - 1) void edit({ op: "move", pages, to: pages[0]! + 1 }, pages[0]! + 1);
  });
  insertBlank.addEventListener("click", () => {
    const after = targets().at(-1)!;
    const size = sizes[after]!;
    void edit({ op: "insertBlank", at: after + 1, width: size.width, height: size.height }, after + 1);
  });
  insertImages.addEventListener("click", () => imagePicker.click());
  insertPdfs.addEventListener("click", () => pdfPicker.click());
  imagePicker.addEventListener("change", () => {
    const files = [...(imagePicker.files ?? [])];
    imagePicker.value = "";
    void insertFiles(files, "image");
  });
  pdfPicker.addEventListener("change", () => {
    const files = [...(pdfPicker.files ?? [])];
    pdfPicker.value = "";
    void insertFiles(files, "pdf");
  });
  /** Insert files after the target pages, one journal entry each. Images are decoded by the browser first. */
  const insertFiles = async (files: File[], kind: "image" | "pdf"): Promise<void> => {
    let at = targets().at(-1)! + 1;
    const changes: PdfEdit[] = [];
    for (const file of files.slice(0, 50)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (kind === "pdf") { changes.push({ op: "insertPdf", at, bytes, name: file.name }); continue; }
      const png = bytes[0] === 0x89 && bytes[1] === 0x50;
      try {
        const bitmap = await createImageBitmap(new Blob([bytes]));
        changes.push({ op: "insertImage", at, bytes, kind: png ? "png" : "jpeg", width: bitmap.width, height: bitmap.height, name: file.name });
        bitmap.close();
      } catch {
        options.status(`${options.name} · ${file.name} is not a PNG or JPEG image`);
        return;
      }
      at += 1;
    }
    let focus = targets().at(-1)! + 1;
    for (const change of changes) {
      if (change.op === "insertPdf") change.at = focus;
      try { session.journal.record(session.doc, change); } catch (error) {
        options.status(`${options.name} · ${change.op === "insertPdf" ? change.name : "Image"}: ${error instanceof Error ? error.message : "could not be inserted"}`);
        break;
      }
      focus = change.op === "insertPdf" ? focus + session.doc.pageCount - doc.pageCount : focus + 1;
    }
    session.selected.clear();
    remember(targets().at(-1)! + 1);
    options.onDirty?.(session.journal.dirty);
    options.status(`${options.name} · inserted ${changes.length} file${changes.length === 1 ? "" : "s"} · not saved`);
    session.rebuild();
  };
  extract.addEventListener("click", () => {
    const pages = targets();
    try {
      const bytes = session.doc.extract(pages);
      const base = options.name.replace(/\.pdf$/i, "");
      const label = pages.length === 1 ? `page ${pages[0]! + 1}` : `${pages.length} pages`;
      options.openPdf?.(`${base} (${label}).pdf`, bytes);
    } catch (error) {
      options.status(`${options.name} · ${error instanceof Error ? error.message : "Extract failed."}`);
    }
  });
  undo.addEventListener("click", () => void step("undo"));
  redo.addEventListener("click", () => void step("redo"));
  save.addEventListener("click", () => {
    if (!options.saveCopy) return;
    // Additions append an incremental update (the original bytes stay unchanged at the start);
    // a removal rewrites the file so the removed content is gone (PDF_WORKBENCH.md, save model).
    const journal = session.journal;
    const mode = !journal.dirty ? "unchanged" : journal.removes ? "full" : "incremental";
    let bytes: Uint8Array;
    try { bytes = mode === "unchanged" ? journal.original : session.doc.save(mode); } catch (error) {
      options.status(`${options.name} · ${error instanceof Error ? error.message : "The PDF could not be written."}`);
      return;
    }
    const base = options.name.replace(/\.pdf$/i, "");
    save.disabled = true;
    void options.saveCopy(bytes, `${base}${mode === "unchanged" ? "" : " (edited)"}.pdf`).then(() => {
      const how = mode === "full" ? "rewritten in full, so removed pages are gone from the file"
        : mode === "incremental" ? "your changes were appended; the original bytes are unchanged at the start of the file" : "unchanged";
      options.status(`${options.name} · saved a copy (${how}). This tab still has your changes.`);
    }, (error: unknown) => {
      if (error instanceof Error && error.name === "SaveCanceled") return;
      options.status(`${options.name} · could not save a copy: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => { save.disabled = false; });
  });

  // Outline
  const outlineItems = doc.outline();
  let outlineList: HTMLElement | null = null;
  const showOutline = (): void => {
    const list = (items: typeof outlineItems): HTMLElement => {
      const ul = el("ul", "pdf-outline");
      for (const item of items) {
        const li = el("li");
        const entry = el("button", "pdf-outline-entry", item.title);
        entry.type = "button";
        if (item.page === null) entry.disabled = true;
        else {
          const page = item.page;
          entry.addEventListener("click", () => goTo(page));
        }
        li.append(entry);
        if (item.children.length) li.append(list(item.children));
        ul.append(li);
      }
      return ul;
    };
    outlineList = outlineItems.length ? list(outlineItems) : null;
    options.outline.replaceChildren(...(outlineList ? [outlineList] : []));
  };

  // Keyboard: Ctrl+F finds while the PDF is shown.
  const onKey = (event: KeyboardEvent): void => {
    if (!root.isConnected || root.closest("[hidden]")) return;
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !typing && root.contains(document.activeElement)) {
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) { event.preventDefault(); void step("undo"); return; }
      if (key === "y" || (key === "z" && event.shiftKey)) { event.preventDefault(); void step("redo"); return; }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      find.focus();
      find.select();
    }
  };
  document.addEventListener("keydown", onKey);

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const i = Number((entry.target as HTMLElement).dataset.page);
      if (entry.isIntersecting) visible.add(i); else visible.delete(i);
    }
    drawQueue();
  }, { root: scroller, rootMargin: "100% 0px" });

  layout();
  for (const page of pages) observer.observe(page);
  showOutline();
  if (session.thumbs) setThumbs(true);
  showSelection();
  if (current > 0) goTo(current);
  if (!session.journal.dirty) options.status(`${options.name} · page ${current + 1} of ${doc.pageCount} · PDF`);

  return {
    pageCount: doc.pageCount,
    zoomBy,
    focusFind: () => { find.focus(); find.select(); },
    showOutline,
    destroy: (keepDocument = false) => {
      remember(current);
      closed = true;
      ++findGeneration;
      window.clearTimeout(findTimer);
      observer.disconnect();
      thumbObserver.disconnect();
      document.removeEventListener("keydown", onKey);
      outlineList?.remove(); // only this view's list: a newer view may own the panel already
      root.replaceChildren();
      if (!keepDocument) doc.close();
    },
  };
}
