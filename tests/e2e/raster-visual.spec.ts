import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { readRasterPdf } from "../helpers/rasterPdf";

interface Box { x: number; y: number; width: number; height: number }
interface ColorProbe { name: string; box: string; u: number; v: number; rgb: number[] }
interface Evidence {
  colors: Array<{ name: string; rgb: number[] }>;
  ink: Array<{ name: string; dark: number; colored: number; light: number }>;
}

// Expectations are independent of html2canvas and previous captures. Interior
// samples avoid font antialiasing and gradient edges; a four-level channel budget
// allows only rounding, not a lost filter, wrong HSL color or missing content.
const COLORS: ColorProbe[] = [
  { name: "hsl", box: "hsl", u: .5, v: .5, rgb: [0, 102, 204] },
  { name: "filter-chain", box: "filter", u: .5, v: .5, rgb: [191, 128, 128] },
  { name: "linear-left", box: "linear", u: .25, v: .5, rgb: [191, 0, 64] },
  { name: "linear-right", box: "linear", u: .75, v: .5, rgb: [64, 0, 191] },
  { name: "radial-center", box: "radial", u: .5, v: .5, rgb: [0, 128, 0] },
  { name: "radial-corner", box: "radial", u: .05, v: .1, rgb: [255, 255, 255] },
  { name: "svg-left", box: "svg", u: .1, v: .5, rgb: [225, 29, 72] },
  { name: "svg-right", box: "svg", u: .9, v: .5, rgb: [225, 29, 72] },
  { name: "stacking-front", box: "stacking", u: .5, v: .5, rgb: [37, 99, 235] },
  { name: "stacking-back", box: "stacking", u: .1, v: .5, rgb: [245, 158, 11] },
  { name: "checked-task", box: "checkbox", u: .25, v: .25, rgb: [26, 79, 184] },
];

function visualFailures(evidence: Evidence): string[] {
  const failures = COLORS.filter((probe) => {
    const actual = evidence.colors.find((value) => value.name === probe.name);
    return !actual || probe.rgb.some((value, i) => Math.abs(value - actual.rgb[i]!) > 4);
  }).map((probe) => probe.name);
  for (const name of ["heading", "code", "math", "table", "toc"]) {
    const region = evidence.ink.find((value) => value.name === name);
    if (!region || region.dark < 30) failures.push(`${name}-ink`);
    if (name === "code" && (!region || region.colored < 30)) failures.push("syntax-colors");
  }
  // The small tick is antialiased after the renderer resizes its SVG. Count
  // light interior pixels, excluding the white paper outside the checkbox.
  if ((evidence.ink.find((value) => value.name === "checkbox")?.light ?? 0) < 8) failures.push("checked-tick");
  return failures;
}

async function inspectPdf(page: Page, name: string, boxes: Record<string, Box>): Promise<Evidence> {
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const path = test.info().outputPath(`${name}.pdf`);
  await download.saveAs(path);
  await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toBeEnabled();
  const pages = readRasterPdf(await readFile(path));
  expect(pages, "fixture and downloaded PDF each have one complete page").toHaveLength(1);
  const raster = pages[0]!;
  expect(raster.widthPt).toBeCloseTo(595.28, 2);
  expect(raster.heightPt).toBeCloseTo(841.89, 2);
  expect(raster.width, "A4 at the default 2x capture scale").toBeGreaterThan(1580);
  expect(raster.height).toBeGreaterThan(2240);
  await writeFile(test.info().outputPath(`${name}.png`), raster.png);

  return page.evaluate(async ({ png, boxes, probes }) => {
    const image = new Image();
    image.src = png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgbAt = (x: number, y: number): number[] => {
      const i = (Math.floor(y * canvas.height) * canvas.width + Math.floor(x * canvas.width)) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    };
    const colors = probes.map((probe) => {
      const box = boxes[probe.box]!;
      return { name: probe.name, rgb: rgbAt(box.x + box.width * probe.u, box.y + box.height * probe.v) };
    });
    const ink = ["heading", "code", "math", "table", "toc", "checkbox"].map((name) => {
      const outer = boxes[name]!;
      const inset = name === "checkbox" ? .2 : 0;
      const box = { x: outer.x + outer.width * inset, y: outer.y + outer.height * inset,
        width: outer.width * (1 - inset * 2), height: outer.height * (1 - inset * 2) };
      let dark = 0;
      let colored = 0;
      let light = 0;
      for (let y = Math.ceil(box.y * canvas.height); y < (box.y + box.height) * canvas.height; y++) {
        for (let x = Math.ceil(box.x * canvas.width); x < (box.x + box.width) * canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const channels = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
          if (Math.max(...channels) < 180) dark++;
          if (Math.max(...channels) - Math.min(...channels) > 50) colored++;
          if (Math.min(...channels) > 180) light++;
        }
      }
      return { name, dark, colored, light };
    });
    return { colors, ink };
  }, { png: `data:image/png;base64,${raster.png.toString("base64")}`, boxes, probes: COLORS });
}

test("downloaded PDF preserves colors, SVG transforms and rich content", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1400, height: 1500 });
  await page.goto("/");
  await page.evaluate(() => window.__mdviewer!.updateSettings({ viewMode: "preview", zoom: 1 }));
  const markdown = await readFile(new URL("../fixtures/raster-visual.md", import.meta.url), "utf8");
  await loadMarkdownIntoApp(page, markdown, "raster-visual.md");
  expect(await waitForPagination(page)).toBe(1);
  const sheet = page.locator("#paged-output .pagedjs_page");
  await expect(sheet.locator(".katex-error, .diagram-error")).toHaveCount(0);
  await expect(sheet.locator("[data-raster-probe]")).toHaveCount(6);
  const boxes = await sheet.evaluate((element): Record<string, Box> => {
    const paper = element.getBoundingClientRect();
    const result: Record<string, Box> = {};
    const record = (name: string, target: Element | null) => {
      if (!target) throw new Error(`Missing visual fixture region ${name}`);
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error(`Empty visual region ${name}`);
      result[name] = { x: (rect.x - paper.x) / paper.width, y: (rect.y - paper.y) / paper.height,
        width: rect.width / paper.width, height: rect.height / paper.height };
    };
    element.querySelectorAll<HTMLElement>("[data-raster-probe]").forEach((target) => record(target.dataset.rasterProbe!, target));
    record("heading", element.querySelector("h1"));
    record("code", element.querySelector("pre.shiki code"));
    record("math", element.querySelector(".katex-html"));
    record("table", element.querySelector("table"));
    record("toc", element.querySelector("nav.toc"));
    record("checkbox", element.querySelector("input:checked"));
    return result;
  });
  await sheet.screenshot({ path: test.info().outputPath("browser-reference.png") });

  // The live preview is parked and its chrome is dark during the real export.
  // The fixed-paper geometry captured above remains the expected PDF geometry.
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  // Only the capture iframe's linked CSS is delayed. Its live source is already
  // styled, so a valid but unstyled PDF demonstrates the clone-readiness race.
  let delayedStyles = 0;
  await page.route("**/assets/*.css", async route => {
    if (route.request().frame().parentFrame()) {
      delayedStyles++;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    await route.continue();
  });
  const evidence = await inspectPdf(page, "fallback-visual", boxes);
  if (process.env.E2E_TARGET === "preview") {
    expect(delayedStyles, "the production regression must actually delay clone CSS").toBeGreaterThanOrEqual(1);
  }
  await writeFile(test.info().outputPath("pixel-evidence.json"), JSON.stringify(evidence, null, 2));
  expect(visualFailures(evidence), JSON.stringify(evidence)).toEqual([]);

  // A fresh, actually damaged download must fail the same assertions. Comparing
  // two captures to one another would otherwise accept a consistently blank or
  // miscolored renderer (the gap in #136).
  await page.addStyleTag({ content:
    '#paged-output [data-raster-probe="hsl"] { background: white !important; } ' +
    '#paged-output pre.shiki code { visibility: hidden !important; } ' +
    '#paged-output input:checked { background-image: none !important; }' });
  const damaged = await inspectPdf(page, "fallback-missing-content-control", boxes);
  expect(visualFailures(damaged)).toEqual(expect.arrayContaining(["hsl", "code-ink", "syntax-colors", "checked-tick"]));
});
