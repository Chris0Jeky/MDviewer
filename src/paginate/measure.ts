/**
 * Page-area geometry for the no-slice pagination engine.
 *
 * Paged.js lays out at CSS pixels (96dpi). The shrink-to-fit tier (handler.ts ->
 * shrinkToFit.ts) needs the printable height in px to decide whether a tall, atomic
 * block can be scaled onto a single page. This module owns that unit math so the
 * conversion lives in exactly one place and is unit-tested independently of layout.
 */

import type { Settings } from "../app/settings";
import { MARGIN_MM } from "../app/settings";

/** CSS pixels per millimetre at 96dpi: 96 / 25.4. */
export const MM = 96 / 25.4;

/** CSS pixels per inch at 96dpi. */
export const IN = 96;

/**
 * Tier-3 shrink ceiling. A block taller than one page but within this multiple of
 * the page height (≤ 1.15×) is scaled to fit; anything taller is left to a clean
 * forced split (Tier 4). Keeping the ceiling tight avoids illegibly tiny code.
 */
export const SHRINK_LIMIT = 1.15;

export interface PageArea {
  widthPx: number;
  heightPx: number;
}

/** Physical paper dimensions in CSS pixels (before margins). */
function paperPx(paperSize: Settings["paperSize"]): { widthPx: number; heightPx: number } {
  if (paperSize === "letter") {
    // US Letter: 8.5in × 11in.
    return { widthPx: 8.5 * IN, heightPx: 11 * IN };
  }
  // A4: 210mm × 297mm.
  return { widthPx: 210 * MM, heightPx: 297 * MM };
}

/**
 * The printable content area for the current settings, in CSS pixels at 96dpi:
 * paper size minus the symmetric @page margin (applied on all four edges).
 * Mirrors the `@page { size; margin }` block emitted by cssBuilder.buildStylesheet.
 */
export function measurePageArea(settings: Settings): PageArea {
  const paper = paperPx(settings.paperSize);
  const marginPx = MARGIN_MM[settings.margins] * MM;
  return {
    widthPx: paper.widthPx - marginPx * 2,
    heightPx: paper.heightPx - marginPx * 2,
  };
}
