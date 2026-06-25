import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  paginateFixture,
  blockStraddles,
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
