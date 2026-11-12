import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { readRasterPdf } from "../helpers/rasterPdf";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "..", "fixtures", name), "utf8");
const LONG_PROSE = fixture("long-prose-fences.md");

/** A region of a sheet as fractions of its width and height. */
interface Region { sheet: number; u0: number; v0: number; u1: number; v1: number }

/**
 * #246: fenced code inherited `.doc { hyphens: auto }`, so wrapped code lines gained hyphen
 * glyphs, and html2canvas-pro drew each hyphen-wrapped word over the start of its line and
 * indented the continuation row in Download PDF. Every continuation row of every wrapped line in
 * a code block must start with ink where the live preview starts it, including the Tier 3 block
 * that pagination draws with CSS `zoom` (#258). Adapted from the draft raster probe written while
 * reviewing #237.
 */
test("Download PDF draws wrapped code lines where the preview does, without hyphenation", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await loadMarkdownIntoApp(page, LONG_PROSE, "long-prose-fences.md");
  await waitForPagination(page);

  const live = await page.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll(".pagedjs_page"));
    const rows: Array<{ sheet: number; u0: number; v0: number; u1: number; v1: number }> = [];
    const hyphens = new Set<string>();
    for (const pre of Array.from(document.querySelectorAll<HTMLElement>("#paged-output pre"))) {
      hyphens.add(getComputedStyle(pre).hyphens);
      const code = pre.querySelector("code");
      if (code) hyphens.add(getComputedStyle(code).hyphens);
      const sheet = pre.closest(".pagedjs_page")!;
      const paper = sheet.getBoundingClientRect();
      const u = (x: number) => (x - paper.left) / paper.width;
      const v = (y: number) => (y - paper.top) / paper.height;
      for (const line of Array.from(pre.querySelectorAll<HTMLElement>(".line"))) {
        const range = document.createRange();
        range.selectNodeContents(line);
        const rects = Array.from(range.getClientRects()).filter(r => r.width > 0);
        if (!rects.length) continue;
        const firstTop = Math.min(...rects.map(r => r.top));
        const continuation = rects.filter(r => r.top > firstTop + 2);
        if (!continuation.length) continue;
        const top = Math.min(...continuation.map(r => r.top));
        const row = continuation.filter(r => Math.abs(r.top - top) < 2);
        const left = Math.min(...row.map(r => r.left));
        const height = Math.max(...row.map(r => r.height));
        const charWidth = Math.max(...row.map(r => r.width)) / 6; // the first word is at least ~6 chars
        rows.push({ sheet: sheets.indexOf(sheet), u0: u(left + 1), v0: v(top + height * 0.2), u1: u(left + charWidth * 1.2), v1: v(top + height * 0.8) });
      }
    }
    return { rows, hyphens: [...hyphens] };
  });
  expect.soft(live.hyphens, "fenced code opts out of hyphenation").toEqual(["none"]);
  expect(live.rows.length, "the fixture must contain wrapped code lines").toBeGreaterThan(10);

  const downloading = page.waitForEvent("download", { timeout: 200_000 });
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const path = test.info().outputPath("raster-code-wrap.pdf");
  await (await downloading).saveAs(path);
  const sheets = readRasterPdf(await readFile(path));

  const blank: Region[] = [];
  for (const index of new Set(live.rows.map(row => row.sheet))) {
    const rows = live.rows.filter(row => row.sheet === index);
    const ink = await page.evaluate(
      async ({ data, rows }) => {
        const image = new Image();
        image.src = data;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return rows.map(r => {
          const x0 = Math.floor(r.u0 * canvas.width);
          const y0 = Math.floor(r.v0 * canvas.height);
          const w = Math.max(1, Math.ceil((r.u1 - r.u0) * canvas.width));
          const h = Math.max(1, Math.ceil((r.v1 - r.v0) * canvas.height));
          const px = context.getImageData(x0, y0, w, h).data;
          let dark = 0;
          for (let i = 0; i < px.length; i += 4) if (px[i]! + px[i + 1]! + px[i + 2]! < 300) dark += 1;
          return dark;
        });
      },
      { data: `data:image/png;base64,${sheets[index]!.png.toString("base64")}`, rows },
    );
    ink.forEach((dark, at) => { if (dark === 0) blank.push(rows[at]!); });
  }
  expect(blank, "continuation rows whose first character is missing in the raster").toEqual([]);
});

/** Fractions of a sheet's width and height an ink edge may move between preview and raster. */
const BOX_TOLERANCE = 0.005;

/**
 * #258: html2canvas-pro misdraws the inside of an element with CSS `zoom`, which Tier 3 puts on
 * a block shrunk to fit its page. The ink inside each shrunk block must sit where the live
 * preview draws it, for a code block and for a diagram.
 */
for (const [name, selector] of [["long-prose-fences.md", "pre"], ["shrunk-figure.md", "figure.mermaid-figure"]] as const) {
  test(`Download PDF draws a shrunk ${selector} where the preview does (${name})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 1600 });
    await page.goto("/");
    await loadMarkdownIntoApp(page, fixture(name), name);
    await waitForPagination(page);
    // The screen-only "scaled to fit" badge is not the block's content; hiding it moves nothing.
    await page.addStyleTag({ content: ".doc [data-shrunk]::after { visibility: hidden !important; }" });

    const blocks = await page.evaluate((selector) => {
      const sheets = Array.from(document.querySelectorAll(".pagedjs_page"));
      return Array.from(document.querySelectorAll<HTMLElement>("#paged-output [data-shrunk]")).map((block) => {
        const sheet = block.closest(".pagedjs_page")!;
        const paper = sheet.getBoundingClientRect();
        const box = block.getBoundingClientRect();
        // Inside the border, so only the block's own content counts as ink.
        return {
          matches: block.matches(selector),
          sheet: sheets.indexOf(sheet),
          u0: (box.left + 4 - paper.left) / paper.width,
          v0: (box.top + 4 - paper.top) / paper.height,
          u1: (box.right - 4 - paper.left) / paper.width,
          v1: (box.bottom - 4 - paper.top) / paper.height,
        };
      });
    }, selector);
    expect(blocks.map(block => block.matches), `the fixture shrinks a ${selector}`).toContain(true);
    const live = await Promise.all(blocks.map(block => page.locator(".pagedjs_page").nth(block.sheet).screenshot()));

    const downloading = page.waitForEvent("download", { timeout: 200_000 });
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    const path = test.info().outputPath(`raster-shrunk-${name}.pdf`);
    await (await downloading).saveAs(path);
    const sheets = readRasterPdf(await readFile(path));

    for (const [at, block] of blocks.entries()) {
      const [preview, raster] = await page.evaluate(
        async ({ images, block }) => Promise.all(images.map(async (data) => {
          const image = new Image();
          image.src = data;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          const x0 = Math.ceil(block.u0 * canvas.width);
          const y0 = Math.ceil(block.v0 * canvas.height);
          const w = Math.floor(block.u1 * canvas.width) - x0;
          const h = Math.floor(block.v1 * canvas.height) - y0;
          const px = context.getImageData(x0, y0, w, h).data;
          let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              // Neutral grey ink (text, strokes) at either resolution; skips the light fills
              // and the block border.
              const [r, g, b] = [px[i]!, px[i + 1]!, px[i + 2]!];
              if (r + g + b >= 600 || Math.abs(b - r) > 40) continue;
              left = Math.min(left, x); right = Math.max(right, x);
              top = Math.min(top, y); bottom = Math.max(bottom, y);
            }
          }
          return [(x0 + left) / canvas.width, (y0 + top) / canvas.height, (x0 + right + 1) / canvas.width, (y0 + bottom + 1) / canvas.height];
        })),
        { images: [live[at]!, sheets[block.sheet]!.png].map(png => `data:image/png;base64,${png.toString("base64")}`), block },
      );
      preview!.forEach((edge, i) => {
        expect(Math.abs(raster![i]! - edge), `${["left", "top", "right", "bottom"][i]} ink edge of the shrunk block on sheet ${block.sheet}`).toBeLessThanOrEqual(BOX_TOLERANCE);
      });
    }
  });
}
