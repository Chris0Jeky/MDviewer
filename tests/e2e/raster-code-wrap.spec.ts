import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { readRasterPdf } from "../helpers/rasterPdf";

const here = dirname(fileURLToPath(import.meta.url));
const LONG_PROSE = readFileSync(join(here, "..", "fixtures", "long-prose-fences.md"), "utf8");

/** A region of a sheet as fractions of its width and height. */
interface Region { sheet: number; u0: number; v0: number; u1: number; v1: number }

/**
 * #246: fenced code inherited `.doc { hyphens: auto }`, so wrapped code lines gained hyphen
 * glyphs, and html2canvas-pro drew each hyphen-wrapped word over the start of its line and
 * indented the continuation row in Download PDF. Every continuation row of every wrapped line in
 * an unshrunk code block must start with ink where the live preview starts it. Tier 3 blocks drawn
 * with CSS `zoom` still misplace wrapped rows in the raster for another reason (#258) and are
 * excluded here. Adapted from the draft raster probe written while reviewing #237.
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
      if (pre.hasAttribute("data-shrunk")) continue; // #258
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
