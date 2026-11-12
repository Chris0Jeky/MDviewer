/**
 * FALLBACK export path — programmatic PDF via html2canvas-pro + jsPDF.
 *
 * Each `.pagedjs_page` is already a fully broken page, so we rasterize one canvas per
 * page and place it onto one PDF page at true paper size. Page-break safety is inherited
 * from Paged.js — we never re-flow. This path is rasterized (non-selectable, larger) and
 * is best-effort: it exists for browsers/PDF engines where `window.print()` is poor, and
 * for users who want a file without touching the print dialog.
 *
 * Always dark-on-white: html2canvas captures the on-screen DOM, and the print/light Shiki
 * side plus light callout backgrounds are forced for the paginated content.
 */

import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";
import type { Settings } from "../app/settings";
import { ATTRS, IDS, PAGEDJS } from "../app/dom";
import { getDownloadDestination } from "./destination";
import { paintFootnoteMarkers } from "./footnoteMarkers";
import { captureLifecycleError, createOfflineCapture, offlineCaptureController } from "./offlineCapture";

export interface FallbackPdfOptions {
  scale?: number;
  fileName?: string;
  /** Called once per rasterized page with the 1-based page and the total. */
  onProgress?(done: number, total: number): void;
  /** Capture is complete; the native save or browser download is about to start. */
  onSaving?(destination: "native" | "browser"): void;
}

export type PdfExportResult = "saved" | "download-requested";

/** Paper dimensions in millimetres for the supported sizes. */
const PAGE_MM: Record<Settings["paperSize"], readonly [number, number]> = {
  a4: [210, 297],
  letter: [215.9, 279.4],
};

function requiredClonedStyles(document: Document): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')).filter(link => {
    const alternate = link.rel.toLowerCase().split(/\s+/).includes("alternate");
    return !link.disabled && !alternate && Boolean(link.getAttribute("href"));
  });
}

/**
 * Observe the mounted clone before resource event tasks can dispatch. A failed
 * CSS request can retain a non-null sheet (including inaccessible cssRules), so
 * only an observed load event establishes success. Never inspect rule contents:
 * empty stylesheets and cross-origin sheets can both be valid.
 */
function observeClonedStyles(container: HTMLElement, frame = container.querySelector("iframe")) {
  const document = frame?.contentDocument;
  if (!frame || !document) return;

  const links = requiredClonedStyles(document);
  const deadline = Date.now() + 10_000;
  const records = links.map(link => {
    const href = link.href;
    let finish!: (loaded: boolean) => void;
    // An error can arrive long before onclone. Store a resolved outcome rather
    // than rejecting an as-yet-unawaited promise.
    const outcome = new Promise<boolean>(resolve => { finish = resolve; });
    let settled = false;
    const settle = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      link.removeEventListener("load", onLoad);
      link.removeEventListener("error", onError);
      window.clearTimeout(timeout);
      finish(loaded);
    };
    const onLoad = () => settle(true);
    const onError = () => settle(false);
    link.addEventListener("load", onLoad);
    link.addEventListener("error", onError);
    const timeout = window.setTimeout(onError, Math.max(0, deadline - Date.now()));
    return { link, href, outcome, dispose: onError };
  });

  return {
    async ready(cloneDocument: Document): Promise<void> {
      if (cloneDocument !== document || frame.contentDocument !== document || !container.contains(frame)) {
        throw captureLifecycleError();
      }
      const current = requiredClonedStyles(document);
      if (current.length !== links.length || current.some((link, i) => link !== links[i])) {
        throw captureLifecycleError();
      }
      // Upstream's sheet polling can finish before the queued load/error event.
      // Await every outcome, rejecting promptly when any required link fails.
      await Promise.all(records.map(async ({ link, href, outcome }) => {
        if (!await outcome || link.href !== href || !link.sheet) {
          throw new Error("The PDF capture stylesheet could not load. Try Print / Save as PDF.");
        }
      }));
    },
    dispose() { records.forEach(record => record.dispose()); },
  };
}

async function waitForClonedFonts(document: Document, deadline: number): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("The PDF capture fonts did not finish loading. Try Print / Save as PDF."));
    }, Math.max(0, deadline - Date.now()));
    fonts.ready.then(() => {
      window.clearTimeout(timeout);
      if (Array.from(fonts).some(font => font.status === "error")) {
        reject(new Error("The PDF capture fonts could not load. Try Print / Save as PDF."));
      } else resolve();
    }, error => {
      window.clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * html2canvas measures its cloned target after onclone. Remove screen-only
 * ancestor scaling/clipping there, not on the live preview. Do not touch any
 * transform inside a sheet: those can be part of the no-slice layout itself.
 */
function prepareRasterClone(cloneDocument: Document, sheet: HTMLElement, sourceSheet: HTMLElement): void {
  const stack = sheet.closest<HTMLElement>(`.${PAGEDJS.pagesClass}`);
  if (stack) {
    stack.style.setProperty("transform", "none", "important");
    stack.style.setProperty("transition", "none", "important");
  }
  const host = sheet.closest<HTMLElement>(`#${IDS.pagedOutput}`);
  if (host) {
    host.style.setProperty("height", "auto", "important");
    host.style.setProperty("width", "auto", "important");
    host.style.setProperty("overflow", "visible", "important");
  }
  // Markdown-only mode parks a measurable but invisible preview. Reveal only
  // the copied sheet; inherited visibility in the live workspace stays intact.
  sheet.style.setProperty("visibility", "visible", "important");

  // The cloner materializes ::before/::after before onclone, copying their
  // computed visibility inline. Revealing the sheet cannot override that copy.
  // Re-read the originating pseudo's visibility in the now-visible clone so
  // TOC leaders/counters return, while explicitly hidden author content stays
  // hidden. These tag/class names belong to html2canvas-pro's cloner and are
  // covered by real-raster regressions when that dependency changes.
  const view = cloneDocument.defaultView;
  if (!view) return;

  // SVG nodes, unlike ordinary HTML nodes, have every computed style inlined by
  // the cloner. Restore the authored visibility declaration so the now-visible
  // sheet can supply inheritance again. Preserve explicit inline/CSS/attribute
  // hiding; forcing every SVG visible would expose intentionally hidden content.
  const svgNodes = (root: HTMLElement) => Array.from(root.querySelectorAll<SVGElement>("svg, svg *"))
    .filter((node) => node.namespaceURI === "http://www.w3.org/2000/svg");
  const sourceSvg = svgNodes(sourceSheet);
  const copiedSvg = svgNodes(sheet);
  if (sourceSvg.length !== copiedSvg.length || sourceSvg.some((node, i) => node.localName !== copiedSvg[i]!.localName)) {
    throw new Error("The PDF capture clone changed the SVG structure. Try Print / Save as PDF.");
  }
  copiedSvg.forEach((node, i) => {
    const original = sourceSvg[i]!.style;
    const visibility = original.getPropertyValue("visibility");
    if (visibility) node.style.setProperty("visibility", visibility, original.getPropertyPriority("visibility"));
    else node.style.removeProperty("visibility");
  });

  // html2canvas's native checkbox painter ignores appearance:none and replaces
  // our background/border/tick with a grey control. Preserve the already-laid-out
  // static paint in the clone; the real disabled checkbox stays untouched.
  for (const checkbox of sheet.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox")) {
    const paint = cloneDocument.createElement("span");
    paint.className = checkbox.className;
    const style = view.getComputedStyle(checkbox);
    for (let i = 0; i < style.length; i++) {
      const property = style.item(i);
      paint.style.setProperty(property, style.getPropertyValue(property));
    }
    checkbox.replaceWith(paint);
  }
  for (const generated of sheet.querySelectorAll<HTMLElement>("html2canvaspseudoelement")) {
    const parent = generated.parentElement;
    if (!parent) continue;
    const before = parent.classList.contains("___html2canvas___pseudoelement_before");
    const after = parent.classList.contains("___html2canvas___pseudoelement_after");
    // v1 surrounds ordinary children; v2 clones both pseudos before them.
    // Their relative before/after order is stable. Match only a complete,
    // recognized set of direct generated children, never an arbitrary node.
    const peers = Array.from(parent.children).filter((child) => child.localName === "html2canvaspseudoelement");
    if (peers.length !== Number(before) + Number(after)) continue;
    const index = peers.indexOf(generated);
    let pseudo: "::before" | "::after";
    if (before && index === 0) pseudo = "::before";
    else if (after && index === (before ? 1 : 0)) pseudo = "::after";
    else continue;
    // The dotted TOC leader grows into the space left by the title. The cloner
    // copies its *used* width, turning it into a competing flex basis; rounding
    // can then shrink the title just enough to wrap it and reflow the whole page.
    if (pseudo === "::before" && parent.matches("a.toc-link")) generated.style.width = "auto";
    if (generated.style.visibility === "hidden") {
      generated.style.visibility = view.getComputedStyle(parent, pseudo).visibility;
    }
  }
}

/**
 * #258: html2canvas-pro 2.6 models CSS `zoom` itself and misplaces what is inside a zoomed
 * element: it unzooms each text run against its own parent's box, not the zoomed element's,
 * then scales again, so wrapped rows drift and child boxes are scaled twice. Pagination needs
 * `zoom` on Tier 3 blocks (a transformed block still fragments), but a captured sheet is a
 * fixed box, so the clone draws each one as the equivalent scale transform, which html2canvas
 * measures untransformed and scales correctly.
 *
 * The transformed block's layout box is its unscaled height. Paged.js lays a page out in a
 * multi-column box, so that taller box would fragment into an unseen second column; the
 * page's column grows by the difference first (a negative margin keeps any footnote area in
 * place). Nothing below the block is on the page: Tier 3 shrinks it to fill the page.
 */
function unzoomShrunkBlocks(sheet: HTMLElement): void {
  for (const block of sheet.querySelectorAll<HTMLElement>(`[${ATTRS.shrunk}]`)) {
    const zoom = Number(block.style.zoom);
    if (!(zoom > 0) || zoom === 1) continue;
    const zoomed = block.getBoundingClientRect();
    const column = block.closest<HTMLElement>(`.${PAGEDJS.pageContentClass}`);
    if (column) {
      const grow = Math.ceil(zoomed.height / zoom - zoomed.height) + 2;
      const height = column.getBoundingClientRect().height + grow;
      const margin = parseFloat(column.ownerDocument.defaultView?.getComputedStyle(column).marginBottom ?? "") || 0;
      column.style.setProperty("height", `${height}px`, "important");
      column.style.setProperty("margin-bottom", `${margin - grow}px`, "important");
    }
    block.style.removeProperty("zoom");
    // Same content width as the zoomed block, so every line wraps where it did.
    block.style.setProperty("box-sizing", "border-box", "important");
    block.style.setProperty("width", `${zoomed.width / zoom}px`, "important");
    block.style.setProperty("max-width", "none", "important");
    block.style.setProperty("transform-origin", "0 0", "important");
    block.style.setProperty("transform", `scale(${zoom})`, "important");
    // Unzoomed margins can move the block; put its top-left corner back.
    const scaled = block.getBoundingClientRect();
    const dx = zoomed.left - scaled.left;
    const dy = zoomed.top - scaled.top;
    block.style.setProperty("transform", `translate(${dx}px, ${dy}px) scale(${zoom})`, "important");
  }
}

async function capturePage(page: HTMLElement, scale: number): Promise<HTMLCanvasElement> {
  const container = page.ownerDocument.createElement("div");
  container.setAttribute("data-html2canvas-ignore", "true");
  container.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none";
  page.ownerDocument.body.append(container);
  let styles: ReturnType<typeof observeClonedStyles>;
  let prepared = false;
  try {
    const controller = offlineCaptureController(page.ownerDocument);
    const offline = controller ? await createOfflineCapture(page.ownerDocument, container, controller) : undefined;
    const rendererContainer = offline ? page.ownerDocument.createElement("div") : container;
    if (offline) container.append(rendererContainer);
    const capture = html2canvas(page, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      iframeContainer: rendererContainer,
      ignoreElements: offline?.ignoreElements,
      onclone: async (cloneDocument, sheet) => {
        if (!styles || sheet.ownerDocument !== cloneDocument) throw captureLifecycleError();
        await styles.ready(cloneDocument);
        if (offline) {
          styles.dispose();
          cloneDocument = offline.adopt(cloneDocument);
          if (sheet.ownerDocument !== cloneDocument) throw captureLifecycleError();
          styles = observeClonedStyles(container, offline.frame);
          if (!styles) throw captureLifecycleError();
          await styles.ready(cloneDocument);
          offline.validate();
        }
        prepareRasterClone(cloneDocument, sheet, page);
        unzoomShrunkBlocks(sheet);
        // Revealing the sheet can use fonts after html2canvas's fonts.ready
        // wait. Resolve layout first, then start a fresh font deadline.
        sheet.getBoundingClientRect();
        await waitForClonedFonts(cloneDocument, Date.now() + 10_000);
        offline?.validate();
        paintFootnoteMarkers(sheet, page);
        prepared = true;
      },
      // Progress is surfaced by onProgress, not per-element console chatter.
      logging: false,
    }).then(
      canvas => ({ ok: true as const, canvas }),
      error => ({ ok: false as const, error }),
    );
    // In html2canvas-pro 2.6, renderElement -> toIFrame -> mountCloneInIFrame
    // mounts the final Document synchronously before renderElement's first
    // await. Attach now, in the same task; resource events and onclone run later.
    // Observing the capture rejection above also covers failures before mount.
    styles = observeClonedStyles(rendererContainer);
    const result = await capture;
    if (!result.ok) throw result.error;
    if (!prepared) throw captureLifecycleError();
    return result.canvas;
  } finally {
    styles?.dispose();
    // Own the entire capture lifetime, including failures outside onclone.
    // Never query/remove unrelated library frames in the source document.
    container.remove();
  }
}

export async function exportPaginatedToPdf(
  host: HTMLElement,
  settings: Settings,
  opts: FallbackPdfOptions = {},
): Promise<PdfExportResult> {
  const [w, h] = PAGE_MM[settings.paperSize];
  const pages = Array.from(host.querySelectorAll<HTMLElement>(`.${PAGEDJS.pageClass}`));
  if (pages.length === 0) {
    throw new Error("No paginated pages to export. Render a document first.");
  }

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: settings.paperSize,
  });

  const DEFAULT_SCALE = 2;
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 4;
  const requestedScale = opts.scale ?? DEFAULT_SCALE;
  const scale =
    Number.isFinite(requestedScale) && requestedScale >= MIN_SCALE && requestedScale <= MAX_SCALE
      ? requestedScale
      : DEFAULT_SCALE;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page) continue;
    const canvas = await capturePage(page, scale);
    if (i > 0) pdf.addPage(settings.paperSize, "portrait");
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h, undefined, "FAST");
    opts.onProgress?.(i + 1, pages.length);
  }

  const filename = opts.fileName ?? "document.pdf";
  const destination = getDownloadDestination();
  opts.onSaving?.(destination ? "native" : "browser");
  if (destination) {
    await destination(pdf.output("blob"), filename);
    return "saved";
  }
  // jsPDF's promise covers generating and handing off the file, not a browser's
  // eventual disk write or download-prompt cancellation.
  await pdf.save(filename, { returnPromise: true });
  return "download-requested";
}
