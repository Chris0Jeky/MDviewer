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
 */

import { Previewer } from "pagedjs";
import type { PagedFlow } from "pagedjs";
import { PAGEDJS } from "../app/dom";
import { setPaginationHost } from "./handler";

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
): Promise<PagedFlow> {
  teardownPagination(host);
  setPaginationHost(host);

  const blobUrl = URL.createObjectURL(new Blob([css], { type: "text/css" }));
  try {
    const previewer = new Previewer();
    return await previewer.preview(source, [blobUrl], host);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
