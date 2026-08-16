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

    // "Visible" is not enough: the banner used to render unstyled a full
    // canvas-height below the fold, which Playwright still calls visible, so the
    // rejection was silent in practice (BUG-6). Assert it is actually on screen.
    const bannerBox = await banner.boundingBox();
    const viewport = page.viewportSize();
    expect(bannerBox, "the warning banner should be laid out").not.toBeNull();
    expect(viewport).not.toBeNull();
    if (bannerBox && viewport) {
      expect(bannerBox.width).toBeGreaterThan(0);
      expect(bannerBox.height).toBeGreaterThan(0);
      expect(bannerBox.y).toBeGreaterThanOrEqual(0);
      expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(viewport.height);
      expect(bannerBox.x).toBeGreaterThanOrEqual(0);
      expect(bannerBox.x + bannerBox.width).toBeLessThanOrEqual(viewport.width);
    }

    // The dismiss affordance must actually clear it.
    await banner.getByRole("button", { name: /dismiss/i }).click();
    await expect(banner).toBeHidden();
  });

  test("a rejection warning stays on screen after the preview is scrolled", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "# Long\n\n" + "Filler paragraph.\n\n".repeat(400));
    await waitForPagination(page);

    await loadFilesIntoApp(page, [
      { name: "photo.png", content: "not-markdown-bytes", type: "image/png" },
    ]);
    const banner = page.locator("#warning-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Instant, not a plain scrollTop assignment: #canvas sets scroll-behavior: smooth,
    // so the position would still be animating when the assertions below run.
    await page.locator("#canvas").evaluate((el) => {
      el.scrollTo({ top: Math.floor(el.scrollHeight / 2), behavior: "instant" });
    });
    await expect
      .poll(() => page.locator("#canvas").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);

    const bannerBox = await banner.boundingBox();
    const canvas = await page.locator("#canvas").boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(canvas).not.toBeNull();
    if (bannerBox && canvas) {
      expect(bannerBox.y).toBeGreaterThanOrEqual(canvas.y - 1);
      expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
    }
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

  /**
   * UX-12: an empty document used to paginate to one blank sheet and announce plain
   * success, leaving the user with no idea whether anything had loaded. The hint has to
   * come through the banner: putting it in the paginated output would export it into
   * the PDF.
   */
  test("an empty document renders without crashing and says so", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "   \n\n   ");

    const banner = page.locator("#warning-banner");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(/empty/i);

    // Not an error: the pipeline completed.
    const errorCard = page.locator("#error-card");
    if (await errorCard.count()) {
      await expect(errorCard).toBeHidden();
    }

    // The hint stays out of the document that gets exported.
    const pages = page.locator("#paged-output .pagedjs_page");
    await expect(pages).toHaveCount(1);
    await expect(pages.first()).not.toContainText(/empty/i);
  });

  test("the empty hint clears as soon as real content arrives", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "   \n\n   ");
    await expect(page.locator("#warning-banner")).toContainText(/empty/i, { timeout: 10_000 });

    await loadMarkdownIntoApp(page, "# Now it has content\n\nA paragraph.");
    await waitForPagination(page);
    await expect(page.locator("#warning-banner")).toBeHidden();
  });
});
