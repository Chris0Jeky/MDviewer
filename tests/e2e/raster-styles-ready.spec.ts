import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

test("failed clone styles save no PDF, release their iframe and permit a retry", async ({ page }) => {
  test.skip(process.env.E2E_TARGET !== "preview", "This regression requires linked production CSS, not Vite's injected dev styles.");
  const markdown = "# Capture recovery\n\nThe source survives a failed stylesheet load.";
  await page.goto("/");
  await loadMarkdownIntoApp(page, markdown);
  await waitForPagination(page);
  let downloads = 0;
  let rejectedStyles = 0;
  page.on("download", () => { downloads++; });
  await page.route("**/assets/*.css", async route => {
    if (route.request().frame().parentFrame()) {
      rejectedStyles++;
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.abort("failed");
    } else await route.continue();
  });
  const exportButton = page.getByRole("button", { name: "Download PDF", exact: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    await exportButton.click();
    await expect(page.getByRole("alertdialog", { name: "Rendering failed" })).toContainText("stylesheet could not load. Try Print / Save as PDF.");
    await expect(exportButton).toBeEnabled();
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
    await expect(page.locator("#editor-input")).toHaveValue(markdown);
    expect(downloads, "a failed stylesheet must not yield a misleading PDF").toBe(0);
  }
  expect(rejectedStyles).toBeGreaterThanOrEqual(2);
  await page.unroute("**/assets/*.css");
  const retry = page.waitForEvent("download");
  await exportButton.click();
  await retry;
  await expect(exportButton).toBeEnabled();
  expect(downloads).toBe(1);
  await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
});
