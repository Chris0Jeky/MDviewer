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
import { PAGEDJS } from "../app/dom";

export interface FallbackPdfOptions {
  scale?: number;
  fileName?: string;
}

/** Paper dimensions in millimetres for the supported sizes. */
const PAGE_MM: Record<Settings["paperSize"], readonly [number, number]> = {
  a4: [210, 297],
  letter: [215.9, 279.4],
};

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

  const scale = opts.scale ?? 2;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page) continue;
    const canvas = await html2canvas(page, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
    if (i > 0) pdf.addPage(settings.paperSize, "portrait");
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h, undefined, "FAST");
  }

  pdf.save(opts.fileName ?? "document.pdf");
}
