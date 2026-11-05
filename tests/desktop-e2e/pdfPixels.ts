import type { Page } from "@playwright/test";
import { readRasterPdf } from "../helpers/rasterPdf";

export interface PdfRegion { x: number; y: number; width: number; height: number }

/** Inspect pixels from the actual saved PDF, independently of html2canvas. */
export async function pdfRegionInk(page: Page, pdf: Buffer, regions: Record<string, PdfRegion>): Promise<{
  png: Buffer;
  ink: Record<string, { dark: number; colored: number }>;
}> {
  const pages = readRasterPdf(pdf);
  if (pages.length !== 1) throw new Error("The desktop visual fixture must fit on one PDF page.");
  const png = pages[0]!.png;
  const ink = await page.evaluate(async ({ data, regions }) => {
    const image = new Image();
    image.src = data;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const result: Record<string, { dark: number; colored: number }> = {};
    for (const [name, box] of Object.entries(regions)) {
      let dark = 0;
      let colored = 0;
      for (let y = Math.floor(box.y * canvas.height); y < (box.y + box.height) * canvas.height; y++) {
        for (let x = Math.floor(box.x * canvas.width); x < (box.x + box.width) * canvas.width; x++) {
          const index = (y * canvas.width + x) * 4;
          const channels = [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!];
          if (Math.max(...channels) < 100) dark++;
          if (Math.max(...channels) - Math.min(...channels) > 50) colored++;
        }
      }
      result[name] = { dark, colored };
    }
    return result;
  }, { data: `data:image/png;base64,${png.toString("base64")}`, regions });
  return { png, ink };
}
