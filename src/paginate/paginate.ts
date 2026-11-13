/**
 * The single pagination call — the last step of the load-bearing render order.
 *
 * A fresh Previewer is created per run (Paged.js carries per-run layout state and is
 * not safe to reuse). The stylesheet is handed in as a Blob URL — Paged.js only accepts
 * stylesheet URLs/paths, not raw text — and the URL is always revoked in `finally`, even
 * if layout throws, so we never leak object URLs across re-paginations.
 *
 * Handlers are NOT registered here. Registration is global+additive in Paged.js, so it
 * happens exactly once via registerHandlersOnce() (called by the App before the first
 * paginate). We only (re)bind the render host so the handler can stamp page numbers and
 * fill the TOC for this specific run.
 *
 * Completeness outranks keep-whole. Paged.js resolves normally even when it stopped early
 * ("Layout repeated", "Unable to layout item"), so every run is audited: every text-bearing
 * source element must be on a page, no page may be empty and no block may sit outside its
 * page's content box. A failed audit re-runs layout from a pristine copy with the offending
 * keep-whole block made splittable, then with every keep-whole block splittable. If that
 * still fails, the pages are torn down and PaginationIncompleteError is thrown: a truncated
 * document is never presented (or exported) as complete.
 */

import type { PagedFlow } from "pagedjs";
import { PAGEDJS, PREVIEW_ZOOM_VAR } from "../app/dom";
import { setPaginationHost } from "./handler";
import { repairFootnoteLinks } from "./footnoteLinks";
import { SPLITTABLE_ATTR, SPLITTABLE_SELECTOR } from "./shrinkToFit";

/**
 * A completed pagination run. `recoveredSplits` is present only when the audit forced a
 * recovery run, and names the keep-whole blocks that run had to split (possibly none).
 */
export interface PaginatedFlow extends PagedFlow {
  recoveredSplits?: string[];
}

/** Pagination could not place the whole document even after recovery. */
export class PaginationIncompleteError extends Error {
  constructor(problem: string) {
    super(`Pagination could not place the whole document (${problem}), so it is not shown.`);
    this.name = "PaginationIncompleteError";
  }
}

/** What an audit found wrong with a run, and the keep-whole block to blame if known. */
export interface PaginationProblem {
  problem: string;
  atomicId: string | null;
}

const ATOMIC_ID_ATTR = "data-mdv-atomic-id";
const PAGE_CONTENT_SELECTOR = ".pagedjs_page_content";
const BLANK_PAGE_CLASS = "pagedjs_blank_page";
/** Flow blocks whose geometry must stay inside their page's content box. */
const FLOW_BLOCKS =
  "p, pre, table, li, h1, h2, h3, h4, h5, h6, blockquote, figure, img, svg, hr, .callout, .katex-display";
/** Pixel slack for sub-pixel rounding, matching the no-cutoff E2E tolerance. */
const TOLERANCE_PX = 2;

/**
 * Remove all paginated output and Paged.js-inserted stylesheets before a re-run.
 * Clears both the host's `.pagedjs_pages` containers and the global
 * `style[data-pagedjs-inserted-styles]` Paged.js injects into <head>, then empties the
 * host so a stale layout can never bleed into the next run.
 */
export function teardownPagination(host: HTMLElement): void {
  host.querySelectorAll(`.${PAGEDJS.pagesClass}`).forEach((node) => node.remove());
  document
    .querySelectorAll(PAGEDJS.insertedStylesSelector)
    .forEach((styleEl) => styleEl.remove());
  host.replaceChildren();
}

/**
 * Paginate `source` into `host` using the generated stylesheet `css`. Resolves with the
 * Paged.js flow (page count, timing, page size). Must run last in the pipeline: every
 * earlier async step (Shiki, KaTeX fonts, Mermaid SVG, image decode) changes laid-out
 * heights, and Paged.js measures real heights to place breaks.
 */
export async function paginate(
  source: DocumentFragment,
  css: string,
  host: HTMLElement,
): Promise<PaginatedFlow> {
  // Keep Paged.js off the empty-state startup path. Import before teardown so an
  // unavailable chunk does not erase the last successfully paginated document.
  const { Previewer } = await import("pagedjs");
  // Paged.js lays out (and mutates) the fragment it is given; recovery needs a clean copy.
  const pristine = source.cloneNode(true) as DocumentFragment;

  // Lay out and audit at zoom 1. The preview zoom is a paint-only transform, but Paged.js
  // 0.4.3 is not scale-invariant: it finds the next page column at `bounds.right +
  // column-gap`, adding an UNSCALED gap to a scaled rect, so under a zoom below 1 blocks
  // that overflow into the next column are never detected and stay hidden there. (A first
  // render ran at zoom 1 only because "Fit" had no pages to fit yet; re-renders did not.)
  // Under a reduced preview zoom, forcing 1 would show the stack jumping to full size and
  // back; hide it (visibility keeps every measurement intact) until the zoom is restored.
  // ponytail: hide-and-reveal; rendering off-screen and swapping pages in is the real fix (#242).
  const zoom = Number.parseFloat(getComputedStyle(host).getPropertyValue(PREVIEW_ZOOM_VAR));
  const hide = Number.isFinite(zoom) && zoom !== 1;
  if (hide) host.style.setProperty("visibility", "hidden");
  host.style.setProperty(PREVIEW_ZOOM_VAR, "1");
  try {
    return await layoutCompletely(Previewer, source, pristine, css, host);
  } finally {
    restoreZoomWithoutEasing(host);
    if (hide) host.style.removeProperty("visibility");
  }
}

/** Hand the zoom back to the canvas without animating the stack from 1 to "Fit". */
function restoreZoomWithoutEasing(host: HTMLElement): void {
  const stacks = Array.from(host.querySelectorAll<HTMLElement>(`.${PAGEDJS.pagesClass}`));
  for (const stack of stacks) stack.style.transition = "none";
  host.style.removeProperty(PREVIEW_ZOOM_VAR);
  for (const stack of stacks) {
    void getComputedStyle(stack).transform; // commit the final scale before easing returns
    stack.style.removeProperty("transition");
  }
}

async function layoutCompletely(
  Previewer: typeof import("pagedjs").Previewer,
  source: DocumentFragment,
  pristine: DocumentFragment,
  css: string,
  host: HTMLElement,
): Promise<PaginatedFlow> {
  let attempt = source;
  let rung: "none" | "offender" | "all" = "none";
  let marked = new Map<string, string>();
  for (;;) {
    teardownPagination(host);
    setPaginationHost(host);
    const blobUrl = URL.createObjectURL(new Blob([css], { type: "text/css" }));
    let flow: PaginatedFlow;
    try {
      flow = await new Previewer().preview(attempt, [blobUrl], host);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    const audit = auditPagination(attempt, host);
    if (!audit) {
      // Only links change after layout, never document geometry.
      repairFootnoteLinks(host);
      if (rung !== "none") flow.recoveredSplits = splitByRecovery(host, marked);
      return flow;
    }

    attempt = pristine.cloneNode(true) as DocumentFragment;
    marked = new Map();
    if (rung === "none" && audit.atomicId) {
      marked = markSplittable(attempt, audit.atomicId);
      rung = "offender";
    }
    if (marked.size === 0 && rung !== "all") {
      marked = markSplittable(attempt, null);
      rung = "all";
    }
    if (marked.size === 0) {
      teardownPagination(host);
      throw new PaginationIncompleteError(audit.problem);
    }
  }
}

/**
 * Describe the recovery-marked blocks that actually split. Tier 4 re-marks a block it
 * measured over-tall, so those (which split on every run) are not reported as recovery.
 */
function splitByRecovery(host: HTMLElement, marked: Map<string, string>): string[] {
  const pagesById = new Map<string, Set<Element>>();
  for (const el of host.querySelectorAll(`[${SPLITTABLE_ATTR}="recovery"]`)) {
    const id = el.getAttribute(ATOMIC_ID_ATTR);
    const page = el.closest(`.${PAGEDJS.pageClass}`);
    if (!id || !page) continue;
    pagesById.set(id, (pagesById.get(id) ?? new Set()).add(page));
  }
  return [...marked].filter(([id]) => (pagesById.get(id)?.size ?? 0) > 1).map(([, name]) => name);
}

/**
 * Check a finished run against its parsed source. Returns null when the document is
 * complete: every source element that carries its own text was rendered on some page,
 * no page is empty, and no block sits below its page's content box or in one of Paged.js's
 * hidden overflow columns to its right.
 */
export function auditPagination(source: ParentNode, host: HTMLElement): PaginationProblem | null {
  const rendered = new Set<string>();
  for (const el of host.querySelectorAll<HTMLElement>("[data-ref]")) rendered.add(el.dataset.ref!);
  for (const el of source.querySelectorAll<HTMLElement>("[data-ref]")) {
    if (rendered.has(el.dataset.ref!) || !hasOwnText(el)) continue;
    return { problem: "content was left unrendered", atomicId: atomicIdOf(el) };
  }

  const pages = Array.from(host.querySelectorAll<HTMLElement>(`.${PAGEDJS.pageClass}`));
  // A split element legitimately continues on the NEXT page; reappearing later means
  // Paged.js backed up and laid the same content out twice.
  const lastPageOf = new Map<string, number>();
  let contentPage = -1;
  for (const [index, page] of pages.entries()) {
    const content = page.querySelector<HTMLElement>(PAGE_CONTENT_SELECTOR);
    // Paged.js inserts an intentional blank page for a left/right (recto/verso) break.
    if (!content || page.classList.contains(BLANK_PAGE_CLASS)) continue;
    contentPage += 1;
    if (pages.length > 1 && isEmptyPage(content)) {
      const next = pages[index + 1]?.querySelector<HTMLElement>(`[${ATOMIC_ID_ATTR}]`);
      return { problem: `page ${index + 1} is empty`, atomicId: next ? atomicIdOf(next) : null };
    }
    for (const el of page.querySelectorAll<HTMLElement>("[data-ref]")) {
      if (!hasOwnText(el)) continue;
      const last = lastPageOf.get(el.dataset.ref!);
      if (last !== undefined && last < contentPage - 1) {
        return { problem: `content repeats on page ${index + 1}`, atomicId: atomicIdOf(el) };
      }
      lastPageOf.set(el.dataset.ref!, contentPage);
    }
    const box = content.getBoundingClientRect();
    for (const el of content.querySelectorAll<HTMLElement>(FLOW_BLOCKS)) {
      // A block inside a closed <details> is not displayed: its rect is a layout guess that
      // can hang below the page (a collapsed tool call at the foot of a conversation page).
      if (el.parentElement?.closest("details:not([open])") && !el.closest("summary")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) continue;
      if (rect.left >= box.right - TOLERANCE_PX || rect.bottom > box.bottom + TOLERANCE_PX) {
        return { problem: `a block on page ${index + 1} lies outside the page`, atomicId: atomicIdOf(el) };
      }
    }
  }
  return null;
}

/**
 * Mark the splittable keep-whole block with `atomicId` (or, with null, every splittable
 * keep-whole block) in `root`. Returns atomic id -> reader-facing description, naming the
 * family and the heading it sits under.
 */
function markSplittable(root: DocumentFragment, atomicId: string | null): Map<string, string> {
  const described = new Map<string, string>();
  let heading = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as HTMLElement;
    if (/^H[1-6]$/.test(el.tagName)) heading = (el.textContent ?? "").trim();
    const id = el.getAttribute(ATOMIC_ID_ATTR);
    if (!id || (atomicId !== null && id !== atomicId) || !el.matches(SPLITTABLE_SELECTOR)) continue;
    el.setAttribute(SPLITTABLE_ATTR, "recovery");
    described.set(id, heading ? `${familyName(el)} under “${heading}”` : familyName(el));
  }
  return described;
}

function familyName(el: HTMLElement): string {
  if (el.matches("table")) return "table";
  if (el.matches("blockquote")) return "quote";
  if (el.matches(".callout")) return "callout";
  return "code block";
}

function atomicIdOf(el: Element): string | null {
  return el.closest(`[${ATOMIC_ID_ATTR}]`)?.getAttribute(ATOMIC_ID_ATTR) ?? null;
}

function hasOwnText(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) return true;
  }
  return false;
}

function isEmptyPage(content: HTMLElement): boolean {
  return !content.textContent?.trim() && !content.querySelector("img, svg, hr, table, canvas");
}
