/**
 * E2E helper: drive the real MDviewer app through one full render+paginate pipeline,
 * then read back page geometry and per-block geometry so specs can assert the
 * no-cutoff guarantee with plain arithmetic (no layout logic in the spec itself).
 *
 * Everything that needs a real layout engine runs inside the browser via
 * `page.evaluate`; the Node side only orchestrates and returns plain data.
 *
 * The selectors here intentionally mirror the atomic-block list from
 * IMPLEMENTATION_SPEC §4 / the print.css break-rules — these are exactly the
 * elements that must never straddle a `.pagedjs_page` boundary.
 */
import type { Page } from "@playwright/test";

/** A DOMRect flattened to the fields the assertions use (DOMRect is not serializable). */
export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

/** One paginated sheet plus its content-box (inside the @page margins). */
export interface PageRect {
  index: number;
  /** Outer rect of the `.pagedjs_page` element. */
  outer: Rect;
  /** Inner content rect (`.pagedjs_page_content` / `.pagedjs_area`), or `outer` if absent. */
  content: Rect;
}

/** One atomic block, tagged with the page it primarily belongs to. */
export interface BlockRect {
  /** A short, human-readable descriptor: tag + first class, e.g. "pre.shiki". */
  tag: string;
  rect: Rect;
  /** Index of the page whose content box best contains this block (-1 if none). */
  pageIndex: number;
}

/** Full snapshot returned to a spec after pagination settles. */
export interface PagedSnapshot {
  pageCount: number;
  pages: PageRect[];
  blocks: BlockRect[];
}

/** Atomic selectors — must match the break-inside:avoid set in print.css. */
const ATOMIC_SELECTORS = [
  "pre",
  ".shiki",
  "figure.code-figure",
  "figure.mermaid-figure",
  "figure",
  "table",
  ".callout",
  ".katex-display",
  "blockquote",
] as const;

/**
 * Wait until the canvas host contains at least one `.pagedjs_page` and the app is
 * no longer in its paginating state. Falls back to a fixed budget so a stuck run
 * fails loudly in the spec rather than hanging.
 */
export async function waitForPagination(page: Page, timeoutMs = 30_000): Promise<number> {
  await page.waitForFunction(
    () => {
      const host = document.getElementById("paged-output");
      if (!host) return false;
      const pages = host.querySelectorAll(".pagedjs_page");
      if (pages.length === 0) return false;
      // No element should still advertise an in-flight pagination.
      const busy = document.querySelector(".is-paginating");
      return !busy;
    },
    undefined,
    { timeout: timeoutMs, polling: 100 },
  );
  return page.evaluate(() => document.querySelectorAll("#paged-output .pagedjs_page").length);
}

/**
 * Inject one or more files into the running app via the hidden `#file-input`. This is the
 * most reliable programmatic ingestion path in headless Chromium — synthetic clipboard /
 * drag events do not carry their `DataTransfer` payload there, whereas setting
 * `input.files` (via a `DataTransfer`) and dispatching `change` exercises the real
 * `onFileInputChange` → `readFiles` → store path exactly as the file picker would.
 */
export async function loadFilesIntoApp(
  page: Page,
  files: Array<{ name: string; content: string; type?: string }>,
): Promise<void> {
  await page.evaluate((specs) => {
    const dt = new DataTransfer();
    for (const s of specs) {
      dt.items.add(new File([s.content], s.name, { type: s.type ?? "text/markdown" }));
    }
    const input = document.getElementById("file-input") as HTMLInputElement | null;
    if (!input) throw new Error("#file-input not found");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, files);
}

/** Load a single markdown document into the app (the common case). */
export async function loadMarkdownIntoApp(
  page: Page,
  markdown: string,
  filename = "fixture.md",
): Promise<void> {
  await loadFilesIntoApp(page, [{ name: filename, content: markdown, type: "text/markdown" }]);
}

/**
 * Read every `.pagedjs_page` and every atomic block's geometry from the live DOM.
 * Returns plain serializable data; all DOM access happens inside the page. The
 * callback is self-contained (no closure over Node-side helpers) so it serializes
 * cleanly into the browser context.
 */
export async function readPagedSnapshot(page: Page): Promise<PagedSnapshot> {
  return page.evaluate((atomic: string[]): PagedSnapshot => {
    type Rect = {
      top: number;
      right: number;
      bottom: number;
      left: number;
      width: number;
      height: number;
    };
    const toRect = (r: DOMRect): Rect => ({
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      left: r.left,
      width: r.width,
      height: r.height,
    });

    const host = document.getElementById("paged-output");
    const pageEls = Array.from(host?.querySelectorAll<HTMLElement>(".pagedjs_page") ?? []);

    const pages = pageEls.map((el, index) => {
      const inner =
        el.querySelector<HTMLElement>(".pagedjs_page_content") ??
        el.querySelector<HTMLElement>(".pagedjs_area") ??
        el;
      return {
        index,
        outer: toRect(el.getBoundingClientRect()),
        content: toRect(inner.getBoundingClientRect()),
      };
    });

    // Assign each block to the page whose content box vertically contains its center.
    const centerOf = (r: Rect): number => (r.top + r.bottom) / 2;
    const pageForCenter = (cy: number): number => {
      for (const p of pages) {
        if (cy >= p.content.top - 1 && cy <= p.content.bottom + 1) return p.index;
      }
      // Fall back to nearest page by center distance.
      let best = -1;
      let bestDist = Infinity;
      for (const p of pages) {
        const d = Math.abs(cy - centerOf(p.content));
        if (d < bestDist) {
          bestDist = d;
          best = p.index;
        }
      }
      return best;
    };

    const seen = new Set<Element>();
    const blocks: Array<{ tag: string; rect: Rect; pageIndex: number }> = [];
    for (const sel of atomic) {
      for (const el of Array.from(host?.querySelectorAll<HTMLElement>(sel) ?? [])) {
        if (seen.has(el)) continue;
        // Skip atomic elements nested inside another atomic element we already record;
        // the outermost frame is the unit the guarantee protects.
        let ancestorRecorded = false;
        let p: Element | null = el.parentElement;
        while (p && host && host.contains(p)) {
          if (seen.has(p)) {
            ancestorRecorded = true;
            break;
          }
          p = p.parentElement;
        }
        if (ancestorRecorded) continue;
        seen.add(el);
        const rect = toRect(el.getBoundingClientRect());
        if (rect.height < 1 && rect.width < 1) continue; // skip collapsed/hidden
        const cls = (el.className || "").toString().trim().split(/\s+/)[0] ?? "";
        const tag = cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
        blocks.push({ tag, rect, pageIndex: pageForCenter(centerOf(rect)) });
      }
    }

    return { pageCount: pages.length, pages, blocks };
  }, [...ATOMIC_SELECTORS]);
}

/**
 * Convenience: paste a fixture, wait for pagination, return the snapshot in one call.
 */
export async function paginateFixture(page: Page, markdown: string): Promise<PagedSnapshot> {
  await loadMarkdownIntoApp(page, markdown);
  await waitForPagination(page);
  return readPagedSnapshot(page);
}

/**
 * Pure assertion math reused by specs: does `block` straddle the boundary of the
 * page it belongs to? A block straddles when any meaningful part of it falls
 * outside its owning page's content box (top above / bottom below), beyond a small
 * sub-pixel tolerance to absorb rounding and intentional bleed.
 */
export function blockStraddles(block: BlockRect, page: PageRect, tolerancePx = 2): boolean {
  const { rect } = block;
  const above = rect.top < page.content.top - tolerancePx;
  const below = rect.bottom > page.content.bottom + tolerancePx;
  return above || below;
}
