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
      const w = window as unknown as {
        __printCalls?: number;
        __printedText?: string;
        __printedSheets?: number;
      };
      w.__printCalls = 0;
      window.print = () => {
        w.__printCalls = (w.__printCalls ?? 0) + 1;
        // Snapshot the host at the exact moment of the export. Reading it afterwards
        // would let a late render make a stale export look correct.
        const host = document.getElementById("paged-output");
        w.__printedText = host?.innerText ?? "";
        w.__printedSheets = host?.querySelectorAll(".pagedjs_page").length ?? 0;
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

  test("primary print media exports every paginated sheet", async ({ page }) => {
    const sheetCount = await page.locator("#paged-output .pagedjs_page").count();
    expect(sheetCount).toBeGreaterThan(1);

    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    const pageObjects = pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pageObjects, "Chrome PDF page objects should match Paged.js sheets").toHaveLength(
      sheetCount,
    );
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

  /**
   * Both exports read the paginated host directly. Fired inside the 250ms content
   * debounce — clicking Print straight after typing, which is exactly what a user
   * does — the host would still hold the *previous* pages unless the export flushes
   * the pending render first. The symptom is a PDF silently missing the last edits.
   */
  /** What the host held at the instant window.print() was called. */
  async function printed(
    page: import("@playwright/test").Page,
  ): Promise<{ calls: number; text: string; sheets: number }> {
    return page.evaluate(() => {
      const w = window as unknown as {
        __printCalls?: number;
        __printedText?: string;
        __printedSheets?: number;
      };
      return {
        calls: w.__printCalls ?? 0,
        text: w.__printedText ?? "",
        sheets: w.__printedSheets ?? 0,
      };
    });
  }

  test("printing straight after an edit exports the edited text, not the old pages", async ({
    page,
  }) => {
    await page.locator("#editor-input").fill("# Edited at the last moment\n\nBrand new body.");

    // No settling wait: click while the content debounce is still counting down. The
    // export must flush that pending render rather than hand out the sample's pages.
    await page.locator(".export-primary").first().click();

    await expect.poll(async () => (await printed(page)).calls, { timeout: 30_000 }).toBe(1);
    const snapshot = await printed(page);
    expect(snapshot.text).toContain("Edited at the last moment");
    expect(snapshot.text).not.toContain("Sample Document");
  });

  test("printing a document typed from scratch never exports an empty host", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("#editor-input").fill("# Typed then printed immediately");
    await page.locator(".export-primary").first().click();

    await expect.poll(async () => (await printed(page)).calls, { timeout: 30_000 }).toBe(1);
    const snapshot = await printed(page);
    expect(snapshot.sheets).toBeGreaterThan(0);
    expect(snapshot.text).toContain("Typed then printed immediately");
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
