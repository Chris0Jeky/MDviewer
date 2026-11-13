import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { readRasterPdf } from "../helpers/rasterPdf";

const here = dirname(fileURLToPath(import.meta.url));
const QUOTE = readFileSync(join(here, "..", "fixtures", "shrunk-nested.md"), "utf8");

/** Fractions of a sheet's height a painted container edge may move between preview and raster. */
const EDGE_TOLERANCE = 0.005;

/**
 * #262: the capture clone swaps a Tier 3 block's `zoom` for a scale transform, which restores its
 * unscaled layout box. A shrunk code block nested in a blockquote then made the quote lay out
 * taller, and its bar painted lower than the preview draws it. The vertical extent of each quote
 * fragment's bar must match.
 */
test("Download PDF paints the quote around a shrunk code block as tall as the preview does", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto("/");
  await loadMarkdownIntoApp(page, QUOTE, "shrunk-nested.md");
  await waitForPagination(page);

  const quotes = await page.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll(".pagedjs_page"));
    return Array.from(document.querySelectorAll<HTMLElement>("#paged-output blockquote")).map((quote) => {
      const paper = quote.closest(".pagedjs_page")!.getBoundingClientRect();
      const box = quote.getBoundingClientRect();
      const nested = quote.querySelector("[data-shrunk]");
      return {
        sheet: sheets.indexOf(quote.closest(".pagedjs_page")!),
        shrunk: nested !== null,
        // The middle of the 4px bar, which is as tall as the quote itself.
        u: (box.left + 2 - paper.left) / paper.width,
        v: (box.top + box.height / 2 - paper.top) / paper.height,
      };
    });
  });
  expect(quotes.some(quote => quote.shrunk), "the fixture shrinks a code block inside a blockquote").toBe(true);
  const live = await Promise.all(quotes.map(quote => page.locator(".pagedjs_page").nth(quote.sheet).screenshot()));

  const downloading = page.waitForEvent("download", { timeout: 200_000 });
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const path = test.info().outputPath("raster-shrunk-nested.pdf");
  await (await downloading).saveAs(path);
  const sheets = readRasterPdf(await readFile(path));

  for (const [at, quote] of quotes.entries()) {
    // The bar's colour is read from the preview, then its vertical run is found in each image.
    const [preview, raster] = await page.evaluate(
      async ({ images, quote }) => Promise.all(images.map(async (data) => {
        const image = new Image();
        image.src = data;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const x = Math.floor(quote.u * canvas.width);
        const column = context.getImageData(x, 0, 1, canvas.height).data;
        const isBar = (y: number) => {
          const i = y * 4;
          return column[i]! + column[i + 1]! + column[i + 2]! < 700;
        };
        let top = Math.floor(quote.v * canvas.height);
        let bottom = top;
        if (!isBar(top)) return [-1, -1];
        while (top > 0 && isBar(top - 1)) top--;
        while (bottom < canvas.height - 1 && isBar(bottom + 1)) bottom++;
        return [top / canvas.height, (bottom + 1) / canvas.height];
      })),
      { images: [live[at]!, sheets[quote.sheet]!.png].map(png => `data:image/png;base64,${png.toString("base64")}`), quote },
    );
    expect(preview![0], `the preview paints the quote bar on sheet ${quote.sheet}`).toBeGreaterThanOrEqual(0);
    expect(raster![0], `the raster paints the quote bar on sheet ${quote.sheet}`).toBeGreaterThanOrEqual(0);
    expect(Math.abs(raster![0]! - preview![0]!), `top of the quote bar on sheet ${quote.sheet}`).toBeLessThanOrEqual(EDGE_TOLERANCE);
    expect(Math.abs(raster![1]! - preview![1]!), `bottom of the quote bar on sheet ${quote.sheet}`).toBeLessThanOrEqual(EDGE_TOLERANCE);
  }
});
