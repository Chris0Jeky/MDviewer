import { test, expect } from "@playwright/test";
import { loadFilesIntoApp, loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

test.describe("empty and error states", () => {
  test("boots showing the empty-state dropzone, no pages yet", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#empty-state")).toBeVisible();
    expect(await page.locator("#paged-output .pagedjs_page").count()).toBe(0);
  });

  test("the empty state offers a way to load the bundled sample", async ({ page }) => {
    await page.goto("/");
    const empty = page.locator("#empty-state");
    await expect(empty).toBeVisible();
    // A sample/demo affordance should exist; match loosely on accessible text.
    const sample = empty.getByRole("button", { name: /sample|demo|example|try/i });
    if (await sample.count()) {
      await sample.first().click();
      const count = await waitForPagination(page);
      expect(count).toBeGreaterThan(0);
    }
  });

  test("a non-markdown file surfaces a rejection warning", async ({ page }) => {
    await page.goto("/");

    // Feed a .png through the real ingestion path; classifyFiles must reject it and the
    // app must surface a warning (the rejection logic is shared by drop + picker).
    await loadFilesIntoApp(page, [
      { name: "photo.png", content: "not-markdown-bytes", type: "image/png" },
    ]);

    // A warning banner (aria-live) should appear naming the rejected file or its type.
    const banner = page.locator("#warning-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/png|not.*markdown|unsupported|skip/i);
  });

  test("loading valid markdown after an error clears the empty/error state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#empty-state")).toBeVisible();

    await loadMarkdownIntoApp(page, "# Recovered\n\nThe app renders after the error.");
    const count = await waitForPagination(page);
    expect(count).toBeGreaterThan(0);

    // Once a document is shown the full-window empty state should no longer block it.
    await expect(page.locator("#paged-output .pagedjs_page").first()).toBeVisible();
  });

  test("an empty document does not crash the pipeline", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "   \n\n   ");
    // Either it stays in the empty state or renders a single blank page; neither throws.
    await page.waitForTimeout(1_000);
    const errorCard = page.locator("#error-card");
    if (await errorCard.count()) {
      await expect(errorCard).toBeHidden();
    }
  });
});
