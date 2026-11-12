/**
 * Tiers 3 and 4 of the no-slice strategy, applied before layout.
 *
 * Runs in the Paged.js `afterParsed` hook (pre-layout, on the parsed source) before the
 * chunker measures heights:
 *
 *   recordSourceHeights   measure every keep-whole block IN CONTEXT (same `.doc` styles,
 *                         same ancestor insets, the printable width) and record it.
 *   shrinkToFit (Tier 3)  a code block or diagram that overflows one page only modestly
 *                         (≤ SHRINK_LIMIT, counting a keep-with-next heading above it) is
 *                         zoomed onto a single page.
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
  const measured = measureInContext(blocks, area);
  blocks.forEach((el, index) => {
    el.setAttribute(ATTRS.atomicSourceHeight, measured[index]!.height.toFixed(3));
    headingLead.set(el, measured[index]!.lead);
  });
}

/**
 * Space a keep-with-next heading directly above a block takes on the block's page
 * (heading top to block top). Tier 3 must fit heading + shrunk block on one page, or the
 * fragmenter splits the shrunk block to honour the heading.
 */
const headingLead = new WeakMap<HTMLElement, number>();

export function shrinkToFit(content: ParentNode, area: PageArea): void {
  const candidates = content.querySelectorAll<HTMLElement>(SHRINK_SELECTOR);
  for (const el of candidates) {
    const naturalHeight = recordedHeight(el) ?? measureInContext([el], area)[0]!.height;
    // Leave a 2px safety gap so rounding never pushes the scaled block over.
    const room = area.heightPx - 2 - (headingLead.get(el) ?? 0);
    const scale = room / naturalHeight;

    // Shrink a block that does not fit the page room left under its keep-with-next
    // heading (even if it would fit alone), only as far as the ceiling allows; anything
    // taller is left to Tier 4.
    if (naturalHeight > room && scale >= 1 / SHRINK_LIMIT) {
      // `zoom`, not a transform: zoom scales the LAYOUT box, so the fragmenter sees the
      // shrunk height. A transformed block keeps its unscaled content height in layout;
      // that content overflowed its reserved box and Chromium fragmented the overflow into
      // the next page column, so "shrunk to fit" blocks were silently split. The zoomed
      // block also keeps filling the column width (its zoomed width is the column).
      el.style.zoom = String(scale);
      el.dataset[camel(ATTRS.shrunk)] = scale.toFixed(3);
    }
  }
}

/**
 * Tier 4: mark splittable families that cannot fit one page, under the keep-with-next
 * heading above them, even after Tier 3.
 */
export function markOverTallSplittable(content: ParentNode, area: PageArea): void {
  for (const el of content.querySelectorAll<HTMLElement>(ATOMIC_SELECTOR)) {
    if (el.hasAttribute(ATTRS.shrunk) || !el.matches(SPLITTABLE_SELECTOR)) continue;
    const height = recordedHeight(el);
    const lead = headingLead.get(el) ?? 0;
    if (height !== null && height + lead > area.heightPx + FIT_TOLERANCE_PX) {
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
function measureInContext(
  blocks: HTMLElement[],
  area: PageArea,
): Array<{ height: number; lead: number }> {
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
    const previous = el.previousElementSibling;
    const heading = previous && /^H[1-6]$/.test(previous.tagName) ? (previous.cloneNode(true) as HTMLElement) : null;
    let wrapped: HTMLElement | null = null;
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const shell = ancestor.cloneNode(false) as HTMLElement;
      if (wrapped) shell.appendChild(wrapped);
      else shell.append(...(heading ? [heading, probe] : [probe]));
      wrapped = shell;
    }
    host.appendChild(wrapped ?? probe);
    return { probe, heading: wrapped ? heading : null };
  });
  document.body.appendChild(host);
  try {
    return probes.map(({ probe, heading }) => {
      const rect = probe.getBoundingClientRect();
      return { height: rect.height, lead: heading ? rect.top - heading.getBoundingClientRect().top : 0 };
    });
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
