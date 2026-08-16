import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_MD = readFileSync(join(here, "..", "fixtures", "sample.md"), "utf8");

/**
 * BUG-2 regression: Paged.js only discovers footnotes by walking the declarations of the
 * stylesheets handed to `previewer.preview()`. `float: footnote` therefore has to live in
 * the generated sheet (cssBuilder), not in the globally imported document.css. When it
 * does not, the note span stays inline in the referencing paragraph and the
 * `.pagedjs_footnote_area` at the page foot renders empty.
 */
test.describe("footnotes land at the foot of the referencing page", () => {
  test("sample.md moves the note out of the paragraph into a footnote area", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    const host = page.locator("#paged-output");

    // Paged.js relocated the span: it now lives inside a footnote inner-content box.
    const note = host.locator(".pagedjs_footnote_inner_content .footnote");
    await expect(note).toHaveCount(1);
    await expect(note).toContainText("Footnotes are collected per page");

    // The owning footnote area is real and no longer flagged empty.
    const filledArea = host.locator(
      ".pagedjs_footnote_area .pagedjs_footnote_content:not(.pagedjs_footnote_empty)",
    );
    await expect(filledArea).toHaveCount(1);
    const areaBox = await filledArea.boundingBox();
    expect(areaBox, "the filled footnote area must have layout").not.toBeNull();
    expect(areaBox!.height).toBeGreaterThan(0);

    // The note text must NOT remain inline inside the referencing paragraph.
    const referencingParagraph = host.locator("p", { has: page.locator("sup.footnote-ref") });
    await expect(referencingParagraph.first()).not.toContainText(
      "Footnotes are collected per page",
    );

    // The call marker is not doubled: markdown-it renders the visible [n] link and
    // Paged.js's own `[data-footnote-call]::after` glyph is suppressed by cssBuilder.
    const callGlyph = await host.locator("[data-footnote-call]").first().evaluate((el) =>
      window.getComputedStyle(el, "::after").content,
    );
    expect(callGlyph === "none" || callGlyph === "normal" || callGlyph === '""').toBe(true);
  });

  test("the note sits below the page content box, inside its own page", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    const geometry = await page.evaluate(() => {
      const note = document.querySelector<HTMLElement>(
        "#paged-output .pagedjs_footnote_inner_content .footnote",
      );
      if (!note) return null;
      const sheet = note.closest<HTMLElement>(".pagedjs_page");
      const content = sheet?.querySelector<HTMLElement>(".pagedjs_page_content");
      const call = sheet?.querySelector<HTMLElement>("sup.footnote-ref");
      if (!sheet || !content) return null;
      return {
        noteTop: note.getBoundingClientRect().top,
        contentBottom: content.getBoundingClientRect().bottom,
        sheetBottom: sheet.getBoundingClientRect().bottom,
        callOnSamePage: Boolean(call),
      };
    });

    expect(geometry, "a relocated footnote must exist").not.toBeNull();
    // Below the flowing text column, still within the sheet: that is "at the page foot".
    expect(geometry!.noteTop).toBeGreaterThanOrEqual(geometry!.contentBottom - 2);
    expect(geometry!.noteTop).toBeLessThan(geometry!.sheetBottom);
    // The note stays on the page that references it.
    expect(geometry!.callOnSamePage).toBe(true);
  });
});
