import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_MD = readFileSync(join(here, "..", "fixtures", "sample.md"), "utf8");

/**
 * Scroll the preview to a fraction of its extent and wait for it to land.
 * `#canvas` sets `scroll-behavior: smooth`, so a plain `scrollTop =` assignment
 * ANIMATES — reading the position straight afterwards yields a mid-flight value.
 * Force an instant jump, then confirm it took.
 */
async function scrollCanvasTo(page: Page, fraction: number): Promise<number> {
  await page.locator("#canvas").evaluate((el, f) => {
    el.scrollTo({ top: Math.floor((el.scrollHeight - el.clientHeight) * f), behavior: "instant" });
  }, fraction);
  await expect
    .poll(() => page.locator("#canvas").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  return page.locator("#canvas").evaluate((el) => el.scrollTop);
}

/** The page number currently shown on the chip (0 when it has none yet). */
async function chipPage(page: Page): Promise<number> {
  const text = (await page.locator("#page-chip").textContent()) ?? "";
  return Number(/Page (\d+)/.exec(text)?.[1] ?? "0");
}

/** Painted width of the first sheet (transform-scaled), and its layout width. */
async function sheetWidths(page: Page): Promise<{ painted: number; natural: number }> {
  return page.locator("#paged-output .pagedjs_page").first().evaluate((el) => ({
    painted: el.getBoundingClientRect().width,
    // offsetWidth is a layout measurement, so a transform does not touch it.
    natural: (el as HTMLElement).offsetWidth,
  }));
}

async function canvasBox(page: Page): Promise<{ width: number; height: number; top: number }> {
  return page.locator("#canvas").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: el.clientWidth, height: rect.height, top: rect.top };
  });
}

/**
 * The preview chrome: the zoom control, the page chip, and the scroll behaviour
 * around them. Everything here is screen-only — none of it may change the
 * paginated geometry (see nocutoff.spec.ts, which measures that geometry).
 */
test.describe("preview zoom control", () => {
  test("50% halves the painted sheet without re-laying it out", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    const before = await sheetWidths(page);
    expect(before.painted).toBeGreaterThan(0);

    await page.getByRole("button", { name: "50%", exact: true }).click();

    // The painted width halves…
    await expect
      .poll(async () => (await sheetWidths(page)).painted)
      .toBeLessThan(before.natural * 0.55);
    const after = await sheetWidths(page);
    expect(after.painted).toBeGreaterThan(after.natural * 0.45);
    // …while the laid-out sheet is untouched: zoom must never re-flow the document,
    // or the on-screen page breaks would stop matching the exported ones.
    expect(after.natural).toBeCloseTo(before.natural, 0);
  });

  test("aria-pressed follows the active option, including programmatic changes", async ({
    page,
  }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    const fit = page.getByRole("button", { name: "Fit", exact: true });
    const half = page.getByRole("button", { name: "50%", exact: true });
    const full = page.getByRole("button", { name: "100%", exact: true });

    await expect(fit).toHaveAttribute("aria-pressed", "true");

    await half.click();
    await expect(half).toHaveAttribute("aria-pressed", "true");
    await expect(fit).toHaveAttribute("aria-pressed", "false");

    // Settings arriving from outside the control must move the state too.
    await page.evaluate(() => window.__mdviewer!.updateSettings({ zoom: 1 }));
    await expect(full).toHaveAttribute("aria-pressed", "true");
    await expect(half).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#canvas")).toHaveAttribute("data-zoom", "1");
  });

  test("Fit tracks the pane width and is distinct from 100%", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    // Preview-only view gives the canvas the whole window, so Fit is unambiguous.
    await page.evaluate(() => window.__mdviewer!.updateSettings({ viewMode: "preview" }));
    await page.evaluate(() => window.__mdviewer!.updateSettings({ zoom: "fit" }));

    const canvas = await canvasBox(page);
    await expect
      .poll(async () => (await sheetWidths(page)).painted)
      .toBeLessThanOrEqual(canvas.width);

    const fitWidths = await sheetWidths(page);
    // Never blown up past actual size, and never clipped by the pane.
    expect(fitWidths.painted).toBeLessThanOrEqual(fitWidths.natural + 1);
    expect(fitWidths.painted).toBeGreaterThan(0);

    // Narrowing the pane must re-resolve Fit rather than clip the sheet.
    await page.evaluate(() => window.__mdviewer!.updateSettings({ viewMode: "split" }));
    await expect
      .poll(async () => {
        const [widths, box] = await Promise.all([sheetWidths(page), canvasBox(page)]);
        return widths.painted <= box.width + 1;
      })
      .toBe(true);
  });

  test("zoom is CSS-only — it never triggers another pagination", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    const before = await waitForPagination(page);

    // Stamp the live sheets so a re-pagination (which rebuilds them) is detectable.
    await page.evaluate(() => {
      document
        .querySelectorAll("#paged-output .pagedjs_page")
        .forEach((el) => el.setAttribute("data-zoom-probe", "1"));
    });

    await page.getByRole("button", { name: "50%", exact: true }).click();
    await page.waitForTimeout(800);

    expect(await page.locator("#paged-output .pagedjs_page").count()).toBe(before);
    expect(await page.locator("#paged-output .pagedjs_page[data-zoom-probe]").count()).toBe(before);
  });
});

test.describe("page chip", () => {
  test("tracks the visible page while scrolling and stays in the viewport", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    const total = await waitForPagination(page);
    expect(total).toBeGreaterThan(1);

    const chip = page.locator("#page-chip");
    await expect(chip).toContainText(`Page 1 / ${total}`);

    // Scroll to the very bottom of the preview.
    await scrollCanvasTo(page, 1);

    await expect.poll(async () => (await chip.textContent()) ?? "").toContain(`/ ${total}`);
    await expect.poll(() => chipPage(page), { timeout: 10_000 }).toBeGreaterThan(1);

    // …and it must still be on screen. Absolutely positioned inside the scroller it
    // would have scrolled away with the sheets (BUG-5).
    const chipBox = await chip.boundingBox();
    const canvas = await page.locator("#canvas").boundingBox();
    expect(chipBox, "the chip should be laid out").not.toBeNull();
    expect(canvas).not.toBeNull();
    if (chipBox && canvas) {
      expect(chipBox.y).toBeGreaterThanOrEqual(canvas.y - 1);
      expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
      expect(chipBox.x).toBeGreaterThanOrEqual(canvas.x - 1);
    }
  });

  test("the zoom control also stays in the viewport after scrolling", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    await scrollCanvasTo(page, 1);

    const zoomBox = await page.locator("#zoom-control").boundingBox();
    const canvas = await page.locator("#canvas").boundingBox();
    expect(zoomBox).not.toBeNull();
    if (zoomBox && canvas) {
      expect(zoomBox.y + zoomBox.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
      expect(zoomBox.y).toBeGreaterThanOrEqual(canvas.y - 1);
    }
  });
});

test.describe("re-pagination keeps the reader's place", () => {
  test("a settings change does not throw the view back to page 1", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    const total = await waitForPagination(page);
    expect(total).toBeGreaterThan(2);

    // Park the reader well into the document. The chip updates on a rAF, which a
    // loaded machine can defer well past any fixed wait — poll for it.
    const beforeTop = await scrollCanvasTo(page, 0.6);
    expect(beforeTop).toBeGreaterThan(0);
    await expect.poll(() => chipPage(page), { timeout: 10_000 }).toBeGreaterThan(1);
    const beforePage = await chipPage(page);

    // offsetWidth, not the painted rect: the preview zoom is a paint-only transform,
    // so only the layout width proves the sheet was re-laid-out at letter geometry.
    const firstPageWidth = () =>
      page
        .locator("#paged-output .pagedjs_page")
        .first()
        .evaluate((el) => (el as HTMLElement).offsetWidth);
    const widthBefore = await firstPageWidth();

    // Letter is wider than A4, so this proves the re-pagination actually ran rather
    // than the assertion below merely reading a scroll position nothing disturbed.
    await page.evaluate(() => window.__mdviewer!.updateSettings({ paperSize: "letter" }));
    await expect.poll(firstPageWidth, { timeout: 15_000 }).toBeGreaterThan(widthBefore);
    await waitForPagination(page);

    const afterTop = await page.locator("#canvas").evaluate((el) => el.scrollTop);
    expect(afterTop, "the preview scrolled back to the top on a settings change").toBeGreaterThan(0);

    await expect.poll(() => chipPage(page), { timeout: 10_000 }).toBeGreaterThan(1);
    const afterPage = await chipPage(page);
    // Page geometry changed, so the exact page can shift by one; page 1 is a failure.
    expect(Math.abs(afterPage - beforePage)).toBeLessThanOrEqual(2);
  });
});

test.describe("preview accessibility and document lifecycle", () => {
  test("the preview scroller can take keyboard focus", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    await page.locator("#canvas").focus();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("canvas");

    const before = await page.locator("#canvas").evaluate((el) => el.scrollTop);
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => page.locator("#canvas").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before);
  });

  test("the skip link reaches the canvas", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".skip-link")).toHaveAttribute("href", "#canvas");
    await expect(page.locator("#canvas")).toHaveAttribute("tabindex", "0");
  });

  test("export controls are inert until a document is open", async ({ page }) => {
    await page.goto("/");
    const print = page.locator(".export-primary").first();
    const download = page.locator(".export-secondary").first();

    await expect(print).toBeDisabled();
    await expect(download).toBeDisabled();
    await expect(print).toHaveAttribute("title", /load a document/i);

    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);
    await expect(print).toBeEnabled();
    await expect(download).toBeEnabled();
  });

  test("the close button removes the document and restores the empty state", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD, "paper.md");
    await waitForPagination(page);

    const close = page.getByRole("button", { name: /close paper\.md/i });
    await expect(close).toBeVisible();
    await close.click();

    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator(".export-primary").first()).toBeDisabled();
  });
});
