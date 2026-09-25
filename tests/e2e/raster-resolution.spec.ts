import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

test("raster pages retain their natural capture resolution at every preview zoom", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Export quality\n\nThe downloaded page must not inherit the screen zoom.\n\n" +
    Array.from({ length: 12 }, (_, i) => `Paragraph ${i}: ${"Readable source text. ".repeat(12)}`).join("\n\n"));
  await waitForPagination(page);
  const sizes = await page.locator("#paged-output .pagedjs_page").evaluateAll((pages) =>
    pages.map((page) => ({ width: (page as HTMLElement).offsetWidth, height: (page as HTMLElement).offsetHeight })));
  await page.evaluate(() => {
    const win = window as unknown as { __rasterSizes: Array<{ width: number; height: number }> };
    win.__rasterSizes = [];
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: number): string {
      if (type === "image/png" && this.width > 200 && this.height > 200) {
        win.__rasterSizes.push({ width: this.width, height: this.height });
      }
      return original.call(this, type, quality);
    };
  });
  for (const label of ["100%", "50%", "Fit"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.evaluate(() => { (window as unknown as { __rasterSizes: unknown[] }).__rasterSizes = []; });
    const downloading = page.waitForEvent("download", { timeout: 60000 });
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    await downloading;
    await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toBeEnabled();
    const captured = await page.evaluate(() => (window as unknown as {
      __rasterSizes: Array<{ width: number; height: number }>;
    }).__rasterSizes);
    expect(captured, `${label}: one image per paginated sheet`).toHaveLength(sizes.length);
    for (let i = 0; i < sizes.length; i++) {
      // offset dimensions round to integer CSS pixels; the renderer may floor instead.
      expect(Math.abs(captured[i]!.width - sizes[i]!.width * 2), `${label}: page ${i + 1} width`).toBeLessThanOrEqual(2);
      expect(Math.abs(captured[i]!.height - sizes[i]!.height * 2), `${label}: page ${i + 1} height`).toBeLessThanOrEqual(2);
    }
  }
});
