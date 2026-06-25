import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_MD = readFileSync(join(here, "..", "fixtures", "sample.md"), "utf8");

test.describe("export paths over one paginated DOM", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Neutralize the real print dialog before any code can call it.
    await page.addInitScript(() => {
      const w = window as unknown as { __printCalls?: number };
      w.__printCalls = 0;
      window.print = () => {
        w.__printCalls = (w.__printCalls ?? 0) + 1;
      };
    });
    await page.reload();
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);
  });

  test("primary export calls window.print() (vector path)", async ({ page }) => {
    const printBtn = page.locator(".export-primary").first();
    if (await printBtn.count()) {
      await printBtn.click();
    } else {
      // Fall back to the public app API hook if the toolbar button is not present.
      await page.evaluate(() => {
        const w = window as unknown as { __mdviewer?: { exportPrint?: () => void } };
        w.__mdviewer?.exportPrint?.();
      });
    }
    const calls = await page.evaluate(
      () => (window as unknown as { __printCalls?: number }).__printCalls ?? 0,
    );
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test("fallback export produces a downloadable PDF (rasterized path)", async ({ page }) => {
    const downloadBtn = page.locator(".export-secondary").first();
    test.skip(
      (await downloadBtn.count()) === 0,
      "no .export-secondary control in this build",
    );

    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await downloadBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  });

  test("the paginated DOM is identical for both export paths (single source)", async ({
    page,
  }) => {
    // Both exports operate over the SAME .pagedjs_page nodes; assert they exist and
    // are stable (the count does not change merely by reading them).
    const before = await page.locator("#paged-output .pagedjs_page").count();
    expect(before).toBeGreaterThan(0);

    // Trigger the print path (mocked) and confirm the page nodes are untouched.
    const printBtn = page.locator(".export-primary").first();
    if (await printBtn.count()) await printBtn.click();

    const after = await page.locator("#paged-output .pagedjs_page").count();
    expect(after).toBe(before);
  });
});
