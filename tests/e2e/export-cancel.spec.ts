import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { readRasterPdf } from "../helpers/rasterPdf";

/**
 * #201: bounded cancellation of the real raster export. The renderer is the actual html2canvas-pro
 * in Chromium; the only simulated part is the stall itself.
 */
declare global {
  interface Window {
    __stallClone?: { promise: Promise<void>; release(): void; pass: number; seen: number; frames: number } | null;
  }
}

const markdown = "# Cancel export\n\n" + Array.from({ length: 90 }, (_, index) =>
  `Paragraph ${index + 1}. Canceling a raster export must leave this document, its selection and its scroll position exactly as they were.`,
).join("\n\n");

const SAVED = "PDF export canceled. Nothing was saved. Your document is still open.";

const park = (page: Page, pass: number) => page.evaluate(pass => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  window.__stallClone = { promise, release, pass, seen: 0, frames: 0 };
}, pass);

async function openDocument(page: Page) {
  // Park the capture clone's font set so the real renderer waits exactly where it cannot be
  // interrupted: after its frame is mounted and before the adapter's onclone callback runs.
  await page.addInitScript(() => {
    const getter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow")!.get!;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get(this: HTMLIFrameElement) {
        const view = getter.call(this) as Window | null;
        const stall = window.__stallClone;
        if (stall && view && this.classList.contains("html2canvas-container") && !("__seen" in view.document)) {
          Object.defineProperty(view.document, "__seen", { value: true });
          // The first `pass` captures run normally; the next one parks.
          if (stall.seen++ >= stall.pass) {
            Object.defineProperty(view.document, "fonts", { configurable: true, value: { ready: stall.promise } });
            stall.frames++;
          }
        }
        return view;
      },
    });
  });
  await page.goto("/");
  await loadMarkdownIntoApp(page, markdown);
  expect(await waitForPagination(page)).toBeGreaterThan(3);
}

const exportButtons = (page: Page) => page.locator(".export-primary, .export-secondary");
const status = (page: Page) => page.locator("#export-status-live");
const cancel = (page: Page) => page.getByRole("button", { name: "Cancel PDF export", exact: true });

test("a stall before the renderer's clone callback keeps the lease until it settles, saves nothing and retries cleanly", async ({ page }) => {
  test.setTimeout(180_000);
  await openDocument(page);
  let downloads = 0;
  page.on("download", () => { downloads++; });
  const download = page.getByRole("button", { name: "Download PDF", exact: true });

  for (let cycle = 0; cycle < 2; cycle++) {
    await park(page, 0);
    await download.click();
    await expect.poll(() => page.evaluate(() => window.__stallClone!.frames)).toBe(1);
    await expect(status(page)).toHaveText("Preparing PDF…");
    await cancel(page).click();
    await expect(status(page)).toHaveText("Canceling PDF export…");
    await expect(cancel(page)).toBeHidden();
    // The renderer cannot be interrupted here, so nothing is released and nothing is claimed.
    await page.waitForTimeout(400);
    await expect(status(page)).toHaveText("Canceling PDF export…");
    for (const button of await exportButtons(page).all()) await expect(button).toBeDisabled();
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(1);
    expect(await page.evaluate(() => window.__stallClone!.frames), "no second capture starts").toBe(1);

    await page.evaluate(() => window.__stallClone!.release());
    await expect(status(page)).toHaveText(SAVED);
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
    await expect(page.locator("div[data-html2canvas-ignore]")).toHaveCount(0);
    for (const button of await exportButtons(page).all()) await expect(button).toBeEnabled();
    await expect(page.locator("#error-card")).toBeHidden();
    expect(downloads, "no partial or late save").toBe(0);
  }

  await page.evaluate(() => { window.__stallClone = null; });
  const saved = page.waitForEvent("download", { timeout: 120_000 });
  await download.click();
  const path = test.info().outputPath("after-cancel.pdf");
  await (await saved).saveAs(path);
  expect(readRasterPdf(await readFile(path)).length).toBeGreaterThan(3);
  await expect(status(page)).toHaveText("PDF download requested.");
  await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
});

test("a cancel between pages stops before the next page, saves no partial PDF and retries", async ({ page }) => {
  test.setTimeout(180_000);
  await openDocument(page);
  let downloads = 0;
  page.on("download", () => { downloads++; });
  const download = page.getByRole("button", { name: "Download PDF", exact: true });

  // Page 1 renders for real; page 2 parks inside the renderer, so the cancel lands mid-export.
  await park(page, 1);
  await download.click();
  await expect.poll(() => page.evaluate(() => window.__stallClone!.frames)).toBe(1);
  await expect(status(page)).toContainText("Rendered 1 of");
  await cancel(page).click();
  await expect(status(page)).toHaveText("Canceling PDF export…");
  await page.evaluate(() => window.__stallClone!.release());
  await expect(status(page)).toHaveText(SAVED);
  expect(await page.evaluate(() => window.__stallClone!.seen), "no page after the stopped one starts").toBe(2);
  await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
  await expect(page.locator("div[data-html2canvas-ignore]")).toHaveCount(0);
  await expect(download).toBeEnabled();
  // Give a late handoff every chance to appear.
  await page.waitForTimeout(1_000);
  expect(downloads, "no partial or late save").toBe(0);

  await page.evaluate(() => { window.__stallClone = null; });
  const saved = page.waitForEvent("download", { timeout: 120_000 });
  await download.click();
  const path = test.info().outputPath("after-mid-cancel.pdf");
  await (await saved).saveAs(path);
  expect(readRasterPdf(await readFile(path)).length).toBeGreaterThan(3);
});
