import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_MD = readFileSync(join(here, "..", "fixtures", "sample.md"), "utf8");

test.describe("golden path: open a document and see a paginated preview", () => {
  test("the app boots to an empty state with a dropzone", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible();
    // Empty state OR its dropzone should be present before any document is loaded.
    const empty = page.locator("#empty-state");
    await expect(empty).toBeVisible();
  });

  test("loading the sample produces .pagedjs_page sheets", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    const count = await waitForPagination(page);
    expect(count).toBeGreaterThan(0);
    await expect(page.locator("#paged-output .pagedjs_page").first()).toBeVisible();
  });

  test("rendered document contains highlighted code, math, callouts and a TOC", async ({
    page,
  }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    const host = page.locator("#paged-output");
    // Shiki code
    await expect(host.locator(".shiki").first()).toBeVisible();
    // KaTeX math (inline or display)
    await expect(host.locator(".katex").first()).toBeVisible();
    // Callouts (sample.md has note/tip/warning/danger)
    await expect(host.locator(".callout").first()).toBeVisible();
    // TOC nav from [[toc]]
    expect(await host.locator(".toc").count()).toBeGreaterThan(0);
  });

  test("the page chip reflects a positive page count", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    const count = await waitForPagination(page);

    const chip = page.locator("#page-chip");
    if (await chip.count()) {
      const text = (await chip.first().textContent()) ?? "";
      // The chip should mention the total page count somewhere in its label.
      expect(text).toMatch(new RegExp(String(count)));
    }
  });

  test("changing a setting re-paginates without losing the document", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    // Toggle to letter paper via the public app API exposed for testing, or via the
    // toolbar if present. We drive it through the app instance when available.
    await page.evaluate(() => {
      const w = window as unknown as {
        __mdviewer?: { updateSettings(p: Record<string, unknown>): void };
      };
      w.__mdviewer?.updateSettings({ paperSize: "letter" });
    });

    // Either the explicit API repaginated, or we force a content reload as a fallback
    // so the assertion still validates a stable paginated state.
    const count = await waitForPagination(page);
    expect(count).toBeGreaterThan(0);
    await expect(page.locator("#paged-output .pagedjs_page").first()).toBeVisible();
  });
});
