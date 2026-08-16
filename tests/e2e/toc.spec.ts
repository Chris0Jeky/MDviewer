import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_MD = readFileSync(join(here, "..", "fixtures", "sample.md"), "utf8");

/** A document with headings but NO [[toc]] marker — exercises the synthesized path. */
const SYNTHESIZED_MD = [
  "# Ünïcödé Report 🎉",
  "",
  "Opening paragraph before any section.",
  "",
  "## First Section",
  "",
  "Body text.",
  "",
  "### 1. Numbered Subsection",
  "",
  "More body text.",
  "",
  "## Second Section",
  "",
  "Closing text.",
].join("\n");

test.describe("table of contents", () => {
  /** BUG-3: every synthesized entry used to render with empty link text. */
  test("a synthesized TOC has readable entry text, including unicode headings", async ({
    page,
  }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SYNTHESIZED_MD);
    await waitForPagination(page);

    const texts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#paged-output a.toc-link")).map((a) =>
        (a.querySelector(".toc-text")?.textContent ?? "").trim(),
      ),
    );

    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toBe("");
    expect(texts).toEqual([
      "Ünïcödé Report 🎉",
      "First Section",
      "1. Numbered Subsection",
      "Second Section",
    ]);
  });

  /** BUG-7: the synthesized nav goes immediately AFTER the first h1, never above it. */
  test("a synthesized TOC sits immediately after the document title", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SYNTHESIZED_MD);
    await waitForPagination(page);

    const order = await page.evaluate(() => {
      const host = document.getElementById("paged-output")!;
      const h1 = host.querySelector("h1");
      const nav = host.querySelector("nav.toc");
      if (!h1 || !nav) return null;
      // Compare by document position rather than sibling identity: Paged.js re-parents
      // flowed content into per-page wrappers.
      const following = h1.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING;
      const blocks = Array.from(host.querySelectorAll("h1, nav.toc, p, h2, h3"));
      return {
        navFollowsTitle: Boolean(following),
        indexGap: blocks.indexOf(nav) - blocks.indexOf(h1),
      };
    });

    expect(order, "the paginated output must contain both an h1 and a nav.toc").not.toBeNull();
    expect(order!.navFollowsTitle).toBe(true);
    // Directly after: no other block between the title and the contents.
    expect(order!.indexGap).toBe(1);
  });

  /**
   * UX-8: Chrome does not support `content: leader()`, so the fallback rules apply. The
   * dotted rule must be an ordinary growing FLEX ITEM between the title and the number,
   * not an absolutely positioned rule painted across the whole row.
   */
  test("leader dots stop at the page number instead of running past it", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    const rows = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll<HTMLElement>("#paged-output a.toc-link"),
      );
      return links.map((link) => {
        const before = getComputedStyle(link, "::before");
        const after = getComputedStyle(link, "::after");
        return {
          title: (link.querySelector(".toc-text")?.textContent ?? "").trim(),
          dataPage: link.dataset.page ?? "",
          beforePosition: before.position,
          beforeFlexGrow: before.flexGrow,
          beforeOrder: before.order,
          afterOrder: after.order,
          afterFlexGrow: after.flexGrow,
          afterContent: after.content,
          overflows: link.scrollWidth > link.clientWidth + 1,
        };
      });
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.title, "every TOC row needs a title").not.toBe("");
      // The dotted rule is an in-flow, growing item ordered between title and number.
      expect(row.beforePosition).toBe("static");
      expect(row.beforeFlexGrow).toBe("1");
      expect(Number(row.beforeOrder)).toBeLessThan(Number(row.afterOrder));
      // The number never grows, so the dots can never extend past it.
      expect(row.afterFlexGrow).toBe("0");
      expect(row.overflows, `TOC row "${row.title}" overflows its box`).toBe(false);
    }

    // The handler resolved real page numbers and the ::after renders them.
    const numbered = rows.filter((row) => /^\d+$/.test(row.dataPage));
    expect(numbered.length, "TOC page numbers should resolve").toBe(rows.length);
    for (const row of numbered) expect(row.afterContent).toContain(row.dataPage);
  });

  test("a TOC link's accessible name reads title then page number", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    const first = page.locator("#paged-output a.toc-link").first();
    const title = ((await first.locator(".toc-text").textContent()) ?? "").trim();
    const pageNumber = (await first.getAttribute("data-page")) ?? "";
    expect(title).not.toBe("");
    expect(pageNumber).toMatch(/^\d+$/);
    await expect(first).toHaveAccessibleName(new RegExp(`${title}\\s*${pageNumber}`));
  });
});
