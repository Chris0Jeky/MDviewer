/**
 * Tier-3 of the no-slice strategy: shrink-to-fit.
 *
 * Runs in the Paged.js `afterParsed` hook (pre-layout, on the parsed source clone)
 * before the chunker measures heights. For each self-contained atomic block (`pre`,
 * `figure.code-figure`, `figure.mermaid-figure`) we measure its natural height with an
 * off-DOM probe. If it overflows one page but only modestly (≤ SHRINK_LIMIT), we apply
 * a `transform: scale(...)` so it lands on a single page and reserve the scaled height
 * via an explicit `height`, so the chunker accounts for the shrunk footprint. Anything
 * taller than the limit is left to a clean forced split (Tier 4). Tables are never
 * shrunk here — they reflow and split gracefully (Tier 2).
 */

import type { PageArea } from "./measure";
import { SHRINK_LIMIT } from "./measure";
import { ATTRS } from "../app/dom";

/** Selector for blocks eligible for shrink-to-fit (never tables — they reflow). */
const SHRINK_SELECTOR = "pre, figure.code-figure, figure.mermaid-figure";

export function shrinkToFit(content: ParentNode, area: PageArea): void {
  const candidates = content.querySelectorAll<HTMLElement>(SHRINK_SELECTOR);
  for (const el of candidates) {
    // Off-DOM probe: clone, render hidden at the element's intended width, measure.
    const probe = el.cloneNode(true) as HTMLElement;
    Object.assign(probe.style, {
      position: "absolute",
      visibility: "hidden",
      left: "-9999px",
      top: "0",
      width: `${el.clientWidth || area.widthPx}px`,
      transform: "none",
      height: "auto",
    });
    document.body.appendChild(probe);
    const naturalHeight = probe.getBoundingClientRect().height;
    probe.remove();

    // Only shrink blocks that overflow one page but stay within the ceiling.
    if (naturalHeight > area.heightPx && naturalHeight <= area.heightPx * SHRINK_LIMIT) {
      // Leave a 2px safety gap so rounding never pushes the scaled block over.
      const scale = (area.heightPx - 2) / naturalHeight;
      el.style.transformOrigin = "top left";
      el.style.transform = `scale(${scale})`;
      // Reserve the scaled footprint so the chunker reflows around the real height.
      el.style.height = `${naturalHeight * scale}px`;
      // Counter the horizontal shrink so the block still fills the column width.
      el.style.width = `${100 / scale}%`;
      el.dataset[camel(ATTRS.shrunk)] = scale.toFixed(3);
    }
  }
}

/** `data-shrunk` -> `shrunk` (dataset key form), derived from the canonical attr name. */
function camel(dataAttr: string): string {
  return dataAttr
    .replace(/^data-/, "")
    .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}
