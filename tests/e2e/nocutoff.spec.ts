import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  paginateFixture,
  loadMarkdownIntoApp,
  waitForPagination,
  blockStraddles,
  splitAtomicOffenders,
  type PageRect,
} from "../helpers/pagedDom";

const here = dirname(fileURLToPath(import.meta.url));
const NOCUTOFF_MD = readFileSync(join(here, "..", "fixtures", "nocutoff.md"), "utf8");

/**
 * THE crown-jewel guarantee: after pagination, no atomic block (code block, table,
 * figure, callout, block math, blockquote) may straddle a `.pagedjs_page` boundary.
 *
 * We load the dense nocutoff fixture, paginate through the real pipeline, then for
 * every atomic block check it sits within its owning page's content box. A block is
 * allowed to BE on a different page than its neighbor; it is NOT allowed to span the
 * gap between two pages.
 */
test.describe("no atomic block straddles a page boundary", () => {
  test("nocutoff.md paginates with zero boundary-straddling blocks", async ({ page }) => {
    await page.goto("/");

    const snapshot = await paginateFixture(page, NOCUTOFF_MD);

    // Sanity: the fixture is long enough to span several pages, or the test is vacuous.
    expect(snapshot.pageCount, "fixture should span multiple pages").toBeGreaterThan(1);
    expect(snapshot.blocks.length, "fixture should contain atomic blocks").toBeGreaterThan(5);

    const embeddedFigure = page.locator(
      '.pagedjs_page img[alt="A small inline figure that should not straddle a page edge"]',
    );
    await expect(embeddedFigure).toBeVisible();
    await expect
      .poll(() => embeddedFigure.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    const embeddedFigureId =
      (await embeddedFigure.getAttribute("data-mdv-atomic-id")) ??
      (await embeddedFigure.getAttribute("data-ref"));
    expect(embeddedFigureId, "fixture image should carry a stable atomic identity").toBeTruthy();
    expect(
      snapshot.blocks.some(
        (block) => block.tag === "img" && block.atomicId === embeddedFigureId,
      ),
      "fixture image should participate in boundary and split checks",
    ).toBe(true);

    const pageByIndex = new Map<number, PageRect>(snapshot.pages.map((p) => [p.index, p]));

    const offenders: string[] = [];
    for (const block of snapshot.blocks) {
      const owner = pageByIndex.get(block.pageIndex);
      if (!owner) {
        offenders.push(`${block.tag}: not assigned to any page`);
        continue;
      }
      if (blockStraddles(block, owner)) {
        offenders.push(
          `${block.tag} on page ${owner.index}: ` +
            `block [${block.rect.top.toFixed(1)}..${block.rect.bottom.toFixed(1)}] ` +
            `exceeds content box [${owner.content.top.toFixed(1)}..${owner.content.bottom.toFixed(1)}]`,
        );
      }
    }

    expect(offenders, `atomic blocks straddling a page boundary:\n${offenders.join("\n")}`).toEqual(
      [],
    );

    const splitOffenders = splitAtomicOffenders(snapshot);
    expect(
      splitOffenders,
      `logical atomic blocks incorrectly split across pages:\n${splitOffenders.join("\n")}`,
    ).toEqual([]);
  });

  /**
   * BUG-4: the vertical guarantee has a horizontal twin. A cell holding an unbreakable
   * token (URL / hash / identifier) grows the column's MIN-content width, auto table
   * layout honours it, and `.pagedjs_page { overflow: hidden }` silently clips whatever
   * crosses the page edge — content lost with no warning. Every td/th must therefore stay
   * inside its page's content box horizontally too.
   */
  test("no table cell is clipped at the horizontal page edge", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, NOCUTOFF_MD);
    await waitForPagination(page);

    const offenders = await page.evaluate(() => {
      const host = document.getElementById("paged-output")!;
      const bad: string[] = [];
      let checked = 0;
      let widest = 0;

      for (const cell of Array.from(host.querySelectorAll<HTMLElement>("td, th"))) {
        const sheet = cell.closest<HTMLElement>(".pagedjs_page");
        const content =
          sheet?.querySelector<HTMLElement>(".pagedjs_page_content") ??
          sheet?.querySelector<HTMLElement>(".pagedjs_area") ??
          sheet;
        if (!content) continue;

        checked += 1;
        const cellRect = cell.getBoundingClientRect();
        const box = content.getBoundingClientRect();
        widest = Math.max(widest, cellRect.width);
        // 2px tolerance absorbs sub-pixel rounding and collapsed-border overlap.
        if (cellRect.left < box.left - 2 || cellRect.right > box.right + 2) {
          bad.push(
            `${cell.tagName.toLowerCase()} "${(cell.textContent ?? "").trim().slice(0, 40)}" ` +
              `[${cellRect.left.toFixed(1)}..${cellRect.right.toFixed(1)}] escapes ` +
              `[${box.left.toFixed(1)}..${box.right.toFixed(1)}]`,
          );
        }
        // The cell must also not be scrolling its own overflow away.
        if (cell.scrollWidth > cell.clientWidth + 2) {
          bad.push(
            `${cell.tagName.toLowerCase()} "${(cell.textContent ?? "").trim().slice(0, 40)}" ` +
              `overflows its own box (${cell.scrollWidth} > ${cell.clientWidth})`,
          );
        }
      }
      return { bad, checked, widest };
    });

    expect(offenders.checked, "the fixture must contain table cells").toBeGreaterThan(10);
    expect(
      offenders.bad,
      `table cells clipped at the page edge:\n${offenders.bad.join("\n")}`,
    ).toEqual([]);
  });

  test("every code block stays inside a single page's content box", async ({ page }) => {
    await page.goto("/");
    const snapshot = await paginateFixture(page, NOCUTOFF_MD);

    const codeBlocks = snapshot.blocks.filter(
      (b) => b.tag.startsWith("pre") || b.tag.includes("shiki") || b.tag.includes("code-figure"),
    );
    expect(codeBlocks.length, "fixture has code blocks").toBeGreaterThan(0);

    const pageByIndex = new Map<number, PageRect>(snapshot.pages.map((p) => [p.index, p]));
    for (const block of codeBlocks) {
      const owner = pageByIndex.get(block.pageIndex);
      expect(owner, `${block.tag} has an owning page`).toBeTruthy();
      if (owner) {
        // A code block taller than a full page is permitted to split cleanly; we only
        // forbid the common failure of a SHORT block overlapping the boundary.
        const blockHeight = block.rect.height;
        const pageHeight = owner.content.bottom - owner.content.top;
        if (blockHeight <= pageHeight) {
          expect(
            blockStraddles(block, owner),
            `${block.tag} (h=${blockHeight.toFixed(0)} <= page ${pageHeight.toFixed(0)}) straddles page ${owner.index}`,
          ).toBe(false);
        }
      }
    }
  });
});

/** #301: record tables of many columns keep every cell inside the page width (reflow, never clipped). */
test("a 16-column record table stays inside the page's content box", async ({ page }) => {
  const columns = Array.from({ length: 16 }, (_, index) => `metric_${String(index + 1).padStart(2, "0")}`);
  const rows = Array.from({ length: 8 }, (_, row) =>
    `| ${columns.map((_, index) => (index === 3 ? "https://example.test/" + "path".repeat(8) : `${row * 7 + index}.25 units`)).join(" | ")} |`);
  const table = [`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`, ...rows].join("\n");
  await page.goto("/");
  await loadMarkdownIntoApp(page, `# Wide records\n\n${table}\n`);
  await waitForPagination(page);
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const cells = Array.from(document.querySelectorAll<HTMLElement>("#paged-output td, #paged-output th"));
    for (const cell of cells) {
      const box = cell.closest(".pagedjs_page")!.querySelector(".pagedjs_page_content")!.getBoundingClientRect();
      const rect = cell.getBoundingClientRect();
      if (rect.left < box.left - 2 || rect.right > box.right + 2 || cell.scrollWidth > cell.clientWidth + 2) out.push(cell.textContent ?? "");
    }
    return { out, count: cells.length };
  });
  expect(bad.count).toBe(16 * 9);
  expect(bad.out).toEqual([]);
});
