import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

interface Capture { width: number; height: number; ink: number; png?: string }

test("raster pages retain natural resolution and content independently of preview state", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Export quality\n\nThe downloaded page must not inherit the screen zoom.\n\n" +
    Array.from({ length: 12 }, (_, i) => `Paragraph ${i}: ${"Readable source text. ".repeat(12)}`).join("\n\n"));
  await waitForPagination(page);
  const sizes = await page.locator("#paged-output .pagedjs_page").evaluateAll((pages) =>
    pages.map((sheet) => ({ width: (sheet as HTMLElement).offsetWidth, height: (sheet as HTMLElement).offsetHeight })));
  await page.evaluate(() => {
    const win = window as unknown as { __rasterSizes: Capture[] };
    win.__rasterSizes = [];
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, type?: string, quality?: number): string {
      const png = original.call(this, type, quality);
      if (type === "image/png" && this.width > 200 && this.height > 200) {
        const pixels = this.getContext("2d")!.getImageData(0, 0, this.width, this.height).data;
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3]! > 0 && Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) < 220) ink++;
        }
        win.__rasterSizes.push({ width: this.width, height: this.height, ink,
          ...(win.__rasterSizes.length === 0 ? { png } : {}) });
      }
      return png;
    };
  });
  let baseline: Capture[] = [];
  const cases = ["100%", "50%", "Fit", "Markdown only"];
  for (const [index, label] of cases.entries()) {
    if (label === "Markdown only") {
      await page.getByRole("button", { name: "Dark", exact: true }).click();
      await page.getByRole("button", { name: "Markdown", exact: true }).click();
    } else {
      await page.getByRole("button", { name: label, exact: true }).click();
    }
    // Fit is recomputed by ResizeObserver when Markdown-only parks the canvas
    // at a different width. Do not mistake that pending resize for an export
    // mutation by recording the previous transform as the baseline (#92).
    const selectedZoom = label === "100%" ? "1" : label === "50%" ? "0.5" : "fit";
    await page.waitForFunction((zoom) => {
      const canvas = document.querySelector<HTMLElement>("#canvas");
      const sheet = document.querySelector<HTMLElement>("#paged-output .pagedjs_page");
      const stack = document.querySelector<HTMLElement>("#paged-output .pagedjs_pages");
      if (!canvas || !sheet || !stack || canvas.dataset.zoom !== zoom || sheet.offsetWidth <= 0) return false;
      // Same documented 24px gutters and 0.1..1 Fit bounds as Canvas.ts.
      const available = canvas.clientWidth - 48;
      const expected = zoom === "fit"
        ? available <= 0 ? 1 : Math.min(1, Math.max(0.1, available / sheet.offsetWidth))
        : Number(zoom);
      const actual = new DOMMatrixReadOnly(getComputedStyle(stack).transform);
      return Math.abs(actual.a - expected) < 0.00001 && Math.abs(actual.d - expected) < 0.00001;
    }, selectedZoom);
    const previewStyle = await page.locator(".pagedjs_pages").evaluate((el) => getComputedStyle(el).transform);
    await page.evaluate(() => { (window as unknown as { __rasterSizes: Capture[] }).__rasterSizes = []; });
    const downloading = page.waitForEvent("download", { timeout: 60000 });
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    await downloading;
    await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toBeEnabled();
    const captured = await page.evaluate(() => (window as unknown as { __rasterSizes: Capture[] }).__rasterSizes);
    expect(captured, `${label}: one image per paginated sheet`).toHaveLength(sizes.length);
    if (index === 0) baseline = captured;
    for (let i = 0; i < sizes.length; i++) {
      expect(Math.abs(captured[i]!.width - sizes[i]!.width * 2), `${label}: page ${i + 1} width`).toBeLessThanOrEqual(2);
      expect(Math.abs(captured[i]!.height - sizes[i]!.height * 2), `${label}: page ${i + 1} height`).toBeLessThanOrEqual(2);
      expect(captured[i]!.ink, `${label}: page ${i + 1} is not blank`).toBeGreaterThan(1000);
      // Ink coverage detects major blank/cropped captures; allow antialiasing variation.
      expect(captured[i]!.ink / baseline[i]!.ink).toBeGreaterThan(0.8);
      expect(captured[i]!.ink / baseline[i]!.ink).toBeLessThan(1.2);
    }
    expect(await page.locator(".pagedjs_pages").evaluate((el) => getComputedStyle(el).transform)).toBe(previewStyle);
    await writeFile(test.info().outputPath(`raster-${index}.png`), Buffer.from(captured[0]!.png!.split(",")[1]!, "base64"));
    // This static, same-browser document must also retain its small generated
    // TOC leader/page number. A broad ink ratio alone cannot detect their loss.
    const digest = (png: string): string => createHash("sha256").update(png).digest("hex");
    expect(digest(captured[0]!.png!), `${label}: generated page furniture is preserved`)
      .toBe(digest(baseline[0]!.png!));
  }
});
