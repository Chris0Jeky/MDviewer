import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { readRasterPdf } from "../helpers/rasterPdf";

interface MarkerRegion {
  id: string;
  label: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const MARKDOWN = `<h1 id="fn1">Numbered notes</h1>

${Array.from({ length: 9 }, (_, i) => `Reference ${i + 1}[^note-${i + 1}]`).join(", ")}.
The first note is cited again[^note-1].

${Array.from({ length: 18 }, () => "Filler content keeps later references on a separate page while ordinary text follows the normal pagination path.").join("\n\n")}

## Later notes

Reference ten[^note-10], eleven[^note-11], and twelve[^note-12].
The first note still has the same destination[^note-1].

${Array.from({ length: 12 }, (_, i) => {
  if (i === 1) return '[^note-2]: <span data-footnote-block style="display:block">Note 2 starts with a block.</span><span style="display:block">A second block follows in the same note.</span>';
  const prefix = i === 0
    ? '<img alt="Tall inline image" style="display:inline-block;width:12px;height:48px;vertical-align:baseline" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO48+wDAAVUArN93vTuAAAAAElFTkSuQmCC"> '
    : i === 9 ? String.raw`$\dfrac{a}{\dfrac{b}{c}}$ ` : "";
  return `[^note-${i + 1}]: ${prefix}Note ${i + 1} has a visible numeral at the page foot.`;
}).join("\n")}
`;

async function readMarkers(page: Page): Promise<MarkerRegion[]> {
  return page.locator("#paged-output .pagedjs_pages").evaluate((stack) => {
    const sheets = [...stack.querySelectorAll(".pagedjs_page")];
    return [...stack.querySelectorAll<HTMLElement>(".pagedjs_footnote_inner_content .footnote[data-footnote-marker]:not([data-split-from])")].map(note => {
      const sheet = note.closest(".pagedjs_page")!;
      const paper = sheet.getBoundingClientRect();
      const box = note.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(note);
      const first = range.getClientRects()[0];
      const block = note.querySelector<HTMLElement>("[data-footnote-block]");
      const textNode = [...note.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("Note "));
      let markerTop: number;
      let markerWidth: number;
      let markerHeight: number;
      if (block) {
        const style = getComputedStyle(note);
        markerHeight = parseFloat(style.lineHeight);
        // An inside native marker already occupies an anonymous first line
        // before this block. A baseline probe must not add another one.
        if (block.getBoundingClientRect().top - box.top < markerHeight - 1) throw new Error("Expected the native marker's own line before the block.");
        markerTop = box.top;
        markerWidth = parseFloat(style.fontSize) * 2;
      } else {
        if (!first || !textNode || first.left - box.left < 4) throw new Error("The fixture must reserve visible native-marker space.");
        range.selectNodeContents(textNode);
        const text = range.getClientRects()[0]!;
        markerTop = text.top;
        markerWidth = first.left - box.left - 1;
        markerHeight = text.height;
      }
      const link = [...stack.querySelectorAll<HTMLAnchorElement>("sup.footnote-ref a")]
        .find(anchor => anchor.getAttribute("href") === `#${note.id}`);
      if (!link) throw new Error("Every fixture note must retain its citation target.");
      return { id: note.id, label: link.textContent!, page: sheets.indexOf(sheet),
        x: (box.left - paper.left) / paper.width, y: (markerTop - paper.top) / paper.height,
        // Exclude body text and require its first-line baseline. A numeral at
        // the top of a tall image/fraction's line must fail this same test.
        width: markerWidth / paper.width, height: markerHeight / paper.height };
    });
  });
}

async function inspectMarkers(page: Page, name: string, regions: MarkerRegion[], pageCount: number) {
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const path = test.info().outputPath(`${name}.pdf`);
  await (await downloading).saveAs(path);
  await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toBeEnabled();
  const pages = readRasterPdf(await readFile(path));
  expect(pages).toHaveLength(pageCount);
  const evidence: Array<{ label: string; page: number; ink: number }> = [];
  for (const [index, raster] of pages.entries()) {
    await writeFile(test.info().outputPath(`${name}-${index + 1}.png`), raster.png);
    const found = await page.evaluate(async ({ data, regions }) => {
      const image = new Image();
      image.src = data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return regions.map(region => {
        let ink = 0;
        for (let y = Math.ceil(region.y * canvas.height); y < (region.y + region.height) * canvas.height; y++) {
          for (let x = Math.ceil(region.x * canvas.width); x < (region.x + region.width) * canvas.width; x++) {
            const offset = (y * canvas.width + x) * 4;
            if (Math.max(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) < 180) ink++;
          }
        }
        return { label: region.label, page: region.page, ink };
      });
    }, { data: `data:image/png;base64,${raster.png.toString("base64")}`, regions: regions.filter(region => region.page === index) });
    evidence.push(...found);
  }
  await writeFile(test.info().outputPath(`${name}-ink.json`), JSON.stringify(evidence, null, 2));
  return evidence;
}

test("downloaded PDF paints single and double digit footnote markers without moving live notes", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1400, height: 1500 });
  await page.goto("/");
  await page.evaluate(() => window.__mdviewer!.updateSettings({ viewMode: "preview", zoom: 1 }));
  await loadMarkdownIntoApp(page, MARKDOWN, "numbered-notes.md");
  const pageCount = await waitForPagination(page);
  expect(pageCount).toBeGreaterThanOrEqual(2);
  const markers = await readMarkers(page);
  expect(markers.map(marker => marker.label)).toEqual(Array.from({ length: 12 }, (_, i) => `[${i + 1}]`));
  expect(markers[9]!.page).toBeGreaterThan(markers[0]!.page);
  await expect(page.locator("#paged-output h1#fn1")).toHaveCount(1);
  await expect(page.locator(`#paged-output sup.footnote-ref a[href="#${markers[0]!.id}"]`)).toHaveCount(3);
  // Retain the primary path as a review artifact; no runtime change is needed there.
  await page.pdf({ path: test.info().outputPath("numbered-notes-print.pdf"), printBackground: true, preferCSSPageSize: true });
  await page.locator("#paged-output .pagedjs_page").first().screenshot({ path: test.info().outputPath("numbered-notes-browser.png") });
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const evidence = await inspectMarkers(page, "numbered-notes", markers, pageCount);
  expect(evidence.filter(marker => marker.ink < 12), JSON.stringify(evidence)).toEqual([]);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  expect(await readMarkers(page), "export must preserve page positions and generated note identities").toEqual(markers);
  await expect(page.locator("[data-raster-footnote-marker]")).toHaveCount(0);
  await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);

  // Remove only the clone paint, leaving its reserved layout and note text in
  // place. A second real PDF must fail every marker region, not just one sample.
  await page.addStyleTag({ content: "[data-raster-footnote-marker] { visibility: hidden !important; }" });
  const damaged = await inspectMarkers(page, "numbered-notes-missing-marker-control", markers, pageCount);
  expect(damaged.filter(marker => marker.ink >= 12), JSON.stringify(damaged)).toEqual([]);
});
