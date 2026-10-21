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
import { IDS, PAGEDJS } from "../app/dom";
import { paintFootnoteMarkers } from "./footnoteMarkers";

export interface FallbackPdfOptions {
  scale?: number;
  fileName?: string;
  /** Called once per rasterized page with the 1-based page and the total. */
  onProgress?(done: number, total: number): void;
}

/** Paper dimensions in millimetres for the supported sizes. */
const PAGE_MM: Record<Settings["paperSize"], readonly [number, number]> = {
  a4: [210, 297],
  letter: [215.9, 279.4],
};

/**
 * html2canvas-pro closes its iframe before adopting the cloned DOM. The iframe's
 * load/readyState check can therefore finish before newly adopted CSS links load.
 * A capture with missing document/KaTeX styles is valid PDF data but wrong output.
 */
async function waitForClonedStyles(document: Document, deadline: number): Promise<void> {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'))
    .filter(link => !link.disabled && !link.sheet);
  if (!links.length) return;
  await new Promise<void>((resolve, reject) => {
    const pending = new Set(links);
    const cleanup = () => {
      window.clearTimeout(timeout);
      for (const link of links) {
        link.removeEventListener("load", onLoad);
        link.removeEventListener("error", onError);
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("The PDF capture stylesheet could not load. Try Print / Save as PDF."));
    };
    const onLoad = (event: Event) => {
      const link = event.currentTarget as HTMLLinkElement;
      if (!link.sheet) { onError(); return; }
      pending.delete(link);
      if (!pending.size) { cleanup(); resolve(); }
    };
    const timeout = window.setTimeout(onError, Math.max(0, deadline - Date.now()));
    for (const link of links) {
      link.addEventListener("load", onLoad);
      link.addEventListener("error", onError);
    }
  });
}

async function waitForClonedFonts(document: Document, deadline: number): Promise<void> {
  if (!document.fonts) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("The PDF capture fonts did not finish loading. Try Print / Save as PDF."));
    }, Math.max(0, deadline - Date.now()));
    document.fonts.ready.then(() => {
      window.clearTimeout(timeout);
      resolve();
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

export async function exportPaginatedToPdf(
  host: HTMLElement,
  settings: Settings,
  opts: FallbackPdfOptions = {},
): Promise<void> {
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
    const canvas = await html2canvas(page, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      onclone: async (cloneDocument, sheet) => {
        try {
          const deadline = Date.now() + 10_000;
          await waitForClonedStyles(cloneDocument, deadline);
          prepareRasterClone(cloneDocument, sheet, page);
          // Loading CSS may introduce fonts after html2canvas's own fonts.ready
          // wait. Resolve layout first so newly used faces are included here.
          sheet.getBoundingClientRect();
          await waitForClonedFonts(cloneDocument, deadline);
          paintFootnoteMarkers(sheet, page);
        } catch (error) {
          // The library's container cleanup begins only after onclone resolves.
          // Do not retain a failed full-document capture in the live workspace.
          cloneDocument.defaultView?.frameElement?.remove();
          throw error;
        }
      },
      // Progress is surfaced by onProgress, not per-element console chatter.
      logging: false,
    });
    if (i > 0) pdf.addPage(settings.paperSize, "portrait");
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h, undefined, "FAST");
    opts.onProgress?.(i + 1, pages.length);
  }

  pdf.save(opts.fileName ?? "document.pdf");
}
