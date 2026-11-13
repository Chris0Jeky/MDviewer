/**
 * The PDF reading view (P1, PDF_WORKBENCH.md): continuous pages drawn on demand, a selectable
 * text layer, find, bookmarks as the outline, thumbnails, zoom, links and a password prompt.
 * Only visible pages hold bitmaps; at most MAX_LIVE pages are drawn at once.
 */
import { openPdf, PdfOpenError, type PdfDocument, type Rect } from "./engine";

export interface PdfViewOptions {
  name: string;
  bytes: Uint8Array;
  /** The shell's outline panel; the view fills it with the PDF's bookmarks while it is shown. */
  outline: HTMLElement;
  /** The shell's confirm-then-open path for http, https and mailto links. */
  openExternal(url: string): void;
  /** A one-line status (page, count, zoom). */
  status(text: string): void;
}

export interface PdfView {
  readonly pageCount: number;
  zoomBy(step: number): void;
  focusFind(): void;
  /** Re-fill the shell outline (after the shell switched back to this PDF). */
  showOutline(): void;
  destroy(): void;
}

const MAX_LIVE = 12;
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
      if (destroyed) { doc.close(); return true; }
      view = buildView(root, doc, options);
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

function buildView(root: HTMLElement, doc: PdfDocument, options: PdfViewOptions): PdfView {
  const sizes = Array.from({ length: doc.pageCount }, (_, i) => doc.pageSize(i));
  let zoom = 1;
  let current = 0;

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
  root.replaceChildren(toolbar, body);

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
  const live = new Map<number, { zoom: number }>();
  const visible = new Set<number>();
  let queued = false;
  const drawQueue = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const next = [...visible].sort((a, b) => Math.abs(a - current) - Math.abs(b - current)).find(i => live.get(i)?.zoom !== zoom);
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
      live.set(i, { zoom });
      return;
    }
    const canvas = el("canvas", "pdf-canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    canvas.setAttribute("aria-hidden", "true");
    page.replaceChildren(canvas, textLayer(i), linkLayer(i), hitLayer(i));
    live.delete(i);
    live.set(i, { zoom });
    for (const old of live.keys()) {
      if (live.size <= MAX_LIVE) break;
      if (visible.has(old)) continue;
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
        node = el("a", "pdf-link");
        (node as HTMLAnchorElement).href = target.uri;
        (node as HTMLAnchorElement).rel = "noopener noreferrer";
        node.setAttribute("aria-label", `Open ${target.uri}`);
        node.title = target.uri;
        node.addEventListener("click", event => { event.preventDefault(); options.openExternal(target.uri); });
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
    }
  }, { root: thumbs, rootMargin: "200px 0px" });
  let thumbsBuilt = false;
  thumbsToggle.addEventListener("click", () => {
    thumbs.hidden = !thumbs.hidden;
    thumbsToggle.setAttribute("aria-pressed", String(!thumbs.hidden));
    if (thumbs.hidden || thumbsBuilt) return;
    thumbsBuilt = true;
    thumbs.replaceChildren(...sizes.map((_, i) => {
      const item = button("", `Page ${i + 1}`, "pdf-thumb");
      item.dataset.page = String(i);
      item.append(el("span", undefined, String(i + 1)));
      item.addEventListener("click", () => goTo(i));
      thumbObserver.observe(item);
      return item;
    }));
    syncPage();
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
  options.status(`${options.name} · page 1 of ${doc.pageCount} · PDF`);

  return {
    pageCount: doc.pageCount,
    zoomBy,
    focusFind: () => { find.focus(); find.select(); },
    showOutline,
    destroy: () => {
      ++findGeneration;
      window.clearTimeout(findTimer);
      observer.disconnect();
      thumbObserver.disconnect();
      document.removeEventListener("keydown", onKey);
      outlineList?.remove(); // only this view's list: a newer view may own the panel already
      root.replaceChildren();
      doc.close();
    },
  };
}
