import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

test("the phone recovery offer exposes discard and its lifetime explanation together", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Draft", "draft.md");
  await waitForPagination(page);
  await page.getByRole("button", { name: "Close draft.md", exact: true }).click();
  await expect(page.locator("#empty-state")).toBeVisible();
  const toolbar = (await page.locator("#toolbar").boundingBox())!;
  for (const selector of [".document-recovery-hint", "[aria-label='Discard closed document']"]) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(toolbar.y);
    expect(box.y + box.height).toBeLessThanOrEqual(toolbar.y + toolbar.height + 1);
  }
  await page.screenshot({ path: test.info().outputPath("undo-close-phone-complete.png") });
});
