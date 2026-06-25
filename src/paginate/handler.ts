/**
 * Paged.js lifecycle handler for MDviewer.
 *
 * Paged.js `registerHandlers` is GLOBAL and ADDITIVE — registering the same handler
 * twice makes its hooks fire twice. So registration must be guarded by a module flag
 * (`registerHandlersOnce`), and the handler must reach the current page area / render
 * host through module-level holders rather than constructor args (the chunker
 * instantiates handlers internally, so we can't pass our own dependencies in).
 *
 * Hooks:
 *   afterParsed(parsed)     -> Tier-3 shrink-to-fit on the pre-layout source.
 *   afterPageLayout(pageEl) -> stamp a stable `data-page-number` on each page.
 *   afterRendered()         -> resolve TOC leader page numbers from laid-out pages.
 */

import { Handler, registerHandlers } from "pagedjs";
import type { PageArea } from "./measure";
import { shrinkToFit } from "./shrinkToFit";
import { PAGEDJS, CLASSES } from "../app/dom";

/** Set by registerHandlersOnce: how the handler reads the current printable area. */
let areaProvider: (() => PageArea) | null = null;

/** Set by paginate(): the host element the current run renders into. */
let renderHost: HTMLElement | null = null;

/** True once registerHandlers has been called for our handler (idempotency latch). */
let registered = false;

/** Monotonic page counter, reset per pagination run via setPaginationHost. */
let pageCounter = 0;

/**
 * Point the handler at the host that the active pagination run renders into.
 * Called by paginate() immediately before previewer.preview(). Resets the per-run
 * page counter so `data-page-number` stamping starts at 1 for each fresh run.
 */
export function setPaginationHost(host: HTMLElement): void {
  renderHost = host;
  pageCounter = 0;
}

class MDViewerHandler extends Handler {
  /** Pre-layout: shrink modestly-oversized atomic blocks to fit one page (Tier 3). */
  afterParsed(parsed: ParentNode): void {
    if (areaProvider) shrinkToFit(parsed, areaProvider());
  }

  /**
   * Per-page: stamp a stable 1-based page number. Paged.js sets its own counters via
   * CSS, but we need a DOM attribute that fillTocPageNumbers can read back. Only stamp
   * if Paged.js hasn't already provided one for this element.
   */
  afterPageLayout(pageElement: unknown): void {
    const el = pageElement as HTMLElement | null | undefined;
    if (!el || typeof el.setAttribute !== "function") return;
    pageCounter += 1;
    if (!el.getAttribute(PAGEDJS.pageNumberAttr)) {
      el.setAttribute(PAGEDJS.pageNumberAttr, String(pageCounter));
    }
  }

  /** Post-layout: fill TOC leader page numbers from the now-laid-out pages. */
  afterRendered(): void {
    if (renderHost) fillTocPageNumbers(renderHost);
  }
}

/**
 * Register the MDviewer handler exactly once and (re)bind the page-area provider.
 * Safe to call on every pagination run: the global registerHandlers is invoked only
 * the first time; subsequent calls just refresh the area provider (settings change
 * the printable area between runs without re-registering the handler).
 */
export function registerHandlersOnce(area: () => PageArea): void {
  areaProvider = area;
  if (registered) return;
  registerHandlers(MDViewerHandler);
  registered = true;
}

/**
 * Resolve TOC page numbers (LIBRARY_NOTES method 2): for each `a.toc-link`, find its
 * target heading by the href fragment, walk up to the owning `.pagedjs_page`, read that
 * page's `data-page-number`, and stash it on `link.dataset.page`. The CSS leader
 * (`target-counter`) handles the visual fill in print; this DOM mirror keeps the number
 * available to the screen preview and the rasterized fallback export.
 */
export function fillTocPageNumbers(host: HTMLElement): void {
  const links = host.querySelectorAll<HTMLAnchorElement>(`a.${CLASSES.tocLink}`);
  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("#")) continue;
    const id = decodeURIComponent(href.slice(1));
    if (!id) continue;

    // Resolve the target by id (escape for use in a CSS selector when available).
    const target = findById(host, id);
    if (!target) continue;

    const page = target.closest<HTMLElement>(`.${PAGEDJS.pageClass}`);
    const pageNumber = page?.getAttribute(PAGEDJS.pageNumberAttr);
    if (pageNumber) link.dataset.page = pageNumber;
  }
}

/** Find an element by id within a host, tolerating ids that aren't valid selectors. */
function findById(host: HTMLElement, id: string): HTMLElement | null {
  const cssEscape = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape;
  if (cssEscape) {
    return host.querySelector<HTMLElement>(`#${cssEscape(id)}`);
  }
  // Fallback: scan by attribute (no CSS.escape in the environment).
  const all = host.querySelectorAll<HTMLElement>("[id]");
  for (const el of all) {
    if (el.id === id) return el;
  }
  return null;
}
