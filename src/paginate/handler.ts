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
 *   filter(content)         -> undo Paged.js's bogus "undisplayed" marks (restoreDisplayedElements).
 *   afterParsed(parsed)     -> in-context heights, Tier-3 shrink, Tier-4 split marking.
 *   afterPageLayout(pageEl) -> stamp a stable `data-page-number` on each page.
 *   afterRendered()         -> resolve TOC leader page numbers from laid-out pages.
 */

import type { PageArea } from "./measure";
import { markOverTallSplittable, recordSourceHeights, shrinkToFit } from "./shrinkToFit";
import { PAGEDJS, CLASSES } from "../app/dom";

/** Set by registerHandlersOnce: how the handler reads the current printable area. */
let areaProvider: (() => PageArea) | null = null;

/** Set by paginate(): the host element the current run renders into. */
let renderHost: HTMLElement | null = null;

/** True once registerHandlers has been called for our handler (idempotency latch). */
let registered = false;

/** Shared in-flight import/registration so overlapping renders cannot double-register. */
let registrationPromise: Promise<void> | null = null;

/** Monotonic page counter, reset per pagination run via setPaginationHost. */
let pageCounter = 0;

/**
 * Optional per-page progress sink. Paged.js layout is not incremental and gives no
 * progress signal of its own, so `afterPageLayout` is the only honest one available.
 * The App sets this immediately before `paginate()` and clears it in a `finally`;
 * renders are serialized (see createRenderScheduler), so at most one sink is ever live.
 */
let progressSink: ((page: number) => void) | null = null;

/** Install (or clear, with `null`) the per-page pagination progress sink. */
export function setPaginationProgress(sink: ((page: number) => void) | null): void {
  progressSink = sink;
}

/**
 * Point the handler at the host that the active pagination run renders into.
 * Called by paginate() immediately before previewer.preview(). Resets the per-run
 * page counter so `data-page-number` stamping starts at 1 for each fresh run.
 */
export function setPaginationHost(host: HTMLElement): void {
  renderHost = host;
  pageCounter = 0;
}

/**
 * Register the MDviewer handler exactly once and (re)bind the page-area provider.
 * Safe to call on every pagination run: the global registerHandlers is invoked only
 * the first time; subsequent calls just refresh the area provider (settings change
 * the printable area between runs without re-registering the handler).
 */
export async function registerHandlersOnce(area: () => PageArea): Promise<void> {
  areaProvider = area;
  if (registered) return;

  registrationPromise ??= import("pagedjs")
    .then(({ Handler, registerHandlers }) => {
      class MDViewerHandler extends Handler {
        /** Post-parse filter: undo Paged.js marking every inline-styled element hidden. */
        filter(content: ParentNode): void {
          restoreDisplayedElements(content);
        }

        /** Pre-layout: measure in context, then Tier 3 shrink and Tier 4 split marking. */
        afterParsed(parsed: ParentNode): void {
          if (areaProvider) {
            const area = areaProvider();
            recordSourceHeights(parsed, area);
            shrinkToFit(parsed, area);
            markOverTallSplittable(parsed, area);
          }
        }

        /** Stamp a stable 1-based page number on each laid-out page. */
        afterPageLayout(pageElement: unknown): void {
          const el = pageElement as HTMLElement | null | undefined;
          if (!el || typeof el.setAttribute !== "function") return;
          pageCounter += 1;
          if (!el.getAttribute(PAGEDJS.pageNumberAttr)) {
            el.setAttribute(PAGEDJS.pageNumberAttr, String(pageCounter));
          }
          // Progress reporting must never be able to break layout.
          if (progressSink) {
            try {
              progressSink(pageCounter);
            } catch {
              /* a failing progress display is not worth losing the pagination over */
            }
          }
        }

        /** Post-layout: fill TOC leader page numbers from the now-laid-out pages. */
        afterRendered(): void {
          if (renderHost) fillTocPageNumbers(renderHost);
        }
      }

      registerHandlers(MDViewerHandler);
      registered = true;
    })
    .catch((error: unknown) => {
      // A transient chunk-load failure should be retryable on the next render.
      registrationPromise = null;
      throw error;
    });

  await registrationPromise;
}

/**
 * Paged.js 0.4.3's UndisplayedFilter marks EVERY element carrying an inline `style`
 * attribute `data-undisplayed` (its `removable()` only exempts an inline display other
 * than none), so every Shiki `<pre style="background-color:…">` is treated as hidden.
 * Breaks.processBreaks then skips it when propagating a heading's `break-after: avoid`:
 * the keep-with-next lands on the NEXT block after the code (often the next heading)
 * instead of the code. When that next heading is pushed into an overflow column on a page
 * that began inside the code block, Paged.js backs up to the code block's start, lays the
 * same content out again and stops with "Layout repeated" — silently dropping the rest of
 * the document. Clearing the bogus mark before Breaks runs restores correct propagation.
 * An element whose inline style really hides it keeps the mark.
 */
export function restoreDisplayedElements(content: ParentNode): void {
  for (const el of content.querySelectorAll<HTMLElement>("[data-undisplayed]")) {
    if (el.hasAttribute("style") && el.style.display !== "none") delete el.dataset.undisplayed;
  }
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
    let id: string;
    try {
      id = decodeURIComponent(href.slice(1));
    } catch {
      continue;
    }
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
