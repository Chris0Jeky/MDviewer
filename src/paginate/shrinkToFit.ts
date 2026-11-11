/**
 * Tiers 3 and 4 of the no-slice strategy, applied before layout.
 *
 * Runs in the Paged.js `afterParsed` hook (pre-layout, on the parsed source) before the
 * chunker measures heights:
 *
 *   recordSourceHeights   measure every keep-whole block IN CONTEXT (same `.doc` styles,
 *                         same ancestor insets, the printable width) and record it.
 *   shrinkToFit (Tier 3)  a code block or diagram that overflows one page only modestly
 *                         (≤ SHRINK_LIMIT) is scaled onto a single page.
 *   markOverTallSplittable (Tier 4)  a splittable family (code, table, quote, callout) that
 *                         still cannot fit one page is marked `data-mdv-splittable`, which
 *                         print.css turns into `break-inside: auto`, so the browser's
 *                         fragmenter and Paged.js agree it may break at line/row boundaries.
 *
 * A keep-whole block taller than a page is physically un-keepable: leaving it
 * `break-inside: avoid` lets Chromium push it (and its keep-with-next heading) into a
 * later column, which wastes the page and, on Paged.js 0.4.3, can feed its loop guard.
 * Media that cannot split (images, diagrams) is capped to the page height by cssBuilder.
 */

import type { PageArea } from "./measure";
import { SHRINK_LIMIT } from "./measure";
import { ATTRS } from "../app/dom";

/** Marks a keep-whole block that may break across pages (print.css relaxes break-inside). */
export const SPLITTABLE_ATTR = "data-mdv-splittable";

/** Outermost keep-whole blocks, as stamped by buildSource.stampAtomicBlocks. */
const ATOMIC_SELECTOR = "[data-mdv-atomic-id]";

/** Selector for blocks eligible for shrink-to-fit (never tables — they reflow). */
const SHRINK_SELECTOR = "pre, figure.code-figure, figure.mermaid-figure";

/** Keep-whole families that can split cleanly at line, row or paragraph boundaries. */
export const SPLITTABLE_SELECTOR = "pre, .shiki, figure.code-figure, table, blockquote, .callout";

/** Rounding slack: a block this close to the page height still fits it. */
const FIT_TOLERANCE_PX = 2;

/**
 * Record each outermost keep-whole block's natural height as `data-mdv-source-height`.
 * Paged.js copies the attribute to every fragment, so E2E can tell a genuine over-tall
 * split from a duplicated short block, and the tiers below read it instead of re-measuring.
 */
export function recordSourceHeights(content: ParentNode, area: PageArea): void {
  const blocks = Array.from(content.querySelectorAll<HTMLElement>(ATOMIC_SELECTOR));
  const heights = measureInContext(blocks, area);
  blocks.forEach((el, index) => {
    el.setAttribute(ATTRS.atomicSourceHeight, heights[index]!.toFixed(3));
  });
}

export function shrinkToFit(content: ParentNode, area: PageArea): void {
  const candidates = content.querySelectorAll<HTMLElement>(SHRINK_SELECTOR);
  for (const el of candidates) {
    const naturalHeight = recordedHeight(el) ?? measureInContext([el], area)[0]!;

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

/** Tier 4: mark splittable families that cannot fit one page even after Tier 3. */
export function markOverTallSplittable(content: ParentNode, area: PageArea): void {
  for (const el of content.querySelectorAll<HTMLElement>(ATOMIC_SELECTOR)) {
    if (el.hasAttribute(ATTRS.shrunk) || !el.matches(SPLITTABLE_SELECTOR)) continue;
    const height = recordedHeight(el);
    if (height !== null && height > area.heightPx + FIT_TOLERANCE_PX) {
      el.setAttribute(SPLITTABLE_ATTR, "tier4");
    }
  }
}

function recordedHeight(el: HTMLElement): number | null {
  const value = Number(el.getAttribute(ATTRS.atomicSourceHeight));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Measure blocks with the styles and width they get on the page. Each probe is a deep
 * clone wrapped in shallow clones of its real ancestors (up to the `.doc` root that
 * carries the typography tokens), inside a hidden host at the printable width. All
 * probes share one host, so the whole batch costs a single layout.
 */
function measureInContext(blocks: HTMLElement[], area: PageArea): number[] {
  if (blocks.length === 0) return [];
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "absolute",
    visibility: "hidden",
    left: "-100000px",
    top: "0",
    width: `${area.widthPx}px`,
  });
  const probes = blocks.map((el) => {
    const probe = el.cloneNode(true) as HTMLElement;
    let wrapped: HTMLElement = probe;
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const shell = ancestor.cloneNode(false) as HTMLElement;
      shell.appendChild(wrapped);
      wrapped = shell;
    }
    host.appendChild(wrapped);
    return probe;
  });
  document.body.appendChild(host);
  try {
    return probes.map((probe) => probe.getBoundingClientRect().height);
  } finally {
    host.remove();
  }
}

/** `data-shrunk` -> `shrunk` (dataset key form), derived from the canonical attr name. */
function camel(dataAttr: string): string {
  return dataAttr
    .replace(/^data-/, "")
    .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}
