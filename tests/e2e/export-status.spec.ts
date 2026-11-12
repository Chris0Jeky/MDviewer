import { test, expect, type Frame, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { placeSource } from "../helpers/sourcePosition";

const markdown = "# Export status\n\n" + Array.from({ length: 28 }, (_, index) =>
  `Paragraph ${index + 1}. Find this source while PDF capture runs. The original text, selection, and scroll position remain available.`,
).join("\n\n");

const layouts = [
  { mode: "editor", width: 1280, height: 800, find: false },
  { mode: "split", width: 1280, height: 800, find: false },
  { mode: "preview", width: 1280, height: 800, find: false },
  { mode: "split", width: 1280, height: 420, find: true },
  { mode: "split", width: 560, height: 420, find: true },
  { mode: "editor", width: 375, height: 667, find: false },
] as const;

async function sourcePosition(page: Page) {
  return page.locator("#editor-input").evaluate(element => {
    const input = element as HTMLTextAreaElement;
    return { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection,
      top: input.scrollTop, left: input.scrollLeft, text: input.value };
  });
}

async function visibleStatusGeometry(page: Page) {
  const geometry = await page.locator(".export-status-content").evaluate(element => {
    const box = element.getBoundingClientRect();
    const text = element.querySelector(".export-status-text")!.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      width: innerWidth, height: innerHeight, textLeft: text.left, textRight: text.right,
      textTop: text.top, textBottom: text.bottom, unobscured: !!hit && element.contains(hit),
      parkedAncestor: !!element.closest("#canvas, #toolbar, [hidden], [inert]") };
  });
  // Layout engines expose fractional CSS pixels (Firefox can report 800.000015
  // at the bottom of an 800px viewport); allow subpixel rounding, not clipping.
  const rounding = 0.5;
  expect(geometry.left).toBeGreaterThanOrEqual(-rounding);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width + rounding);
  expect(geometry.top).toBeGreaterThanOrEqual(-rounding);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + rounding);
  expect(geometry.textLeft).toBeGreaterThanOrEqual(geometry.left - rounding);
  expect(geometry.textRight).toBeLessThanOrEqual(geometry.right + rounding);
  expect(geometry.textTop).toBeGreaterThanOrEqual(geometry.top - rounding);
  expect(geometry.textBottom).toBeLessThanOrEqual(geometry.bottom + rounding);
  expect(geometry.unobscured).toBe(true);
  expect(geometry.parkedAncestor).toBe(false);
  return geometry;
}

for (const layout of layouts) {
  const name = `${layout.mode}-${layout.width}x${layout.height}${layout.find ? "-find" : ""}`;
  test(`PDF progress remains exposed without moving focus (${name})`, async ({ page }, info) => {
    test.skip(process.env.E2E_TARGET !== "preview", "Pauses actual capture at linked production CSS requests.");
    test.setTimeout(60_000);
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown);
    const count = await waitForPagination(page);
    expect(count).toBeGreaterThan(1);
    await page.evaluate(mode => window.__mdviewer!.updateSettings({ viewMode: mode }), layout.mode);
    const editor = page.locator("#editor-input");
    if (layout.mode === "preview") await page.locator("#canvas").focus();
    else {
      await editor.focus();
      await placeSource(editor, 30, 50, "backward", 120);
    }
    if (layout.find) {
      await editor.press("Control+h");
      await page.getByRole("searchbox", { name: "Find in Markdown" }).fill("source");
      await expect(page.locator(".editor-search-status")).toContainText("matches");
    }
    const before = await sourcePosition(page);
    const focused = await page.evaluateHandle(() => document.activeElement);
    const focusPreserved = () => focused.evaluate(element => element === document.activeElement);
    const firstPage = await page.locator("#paged-output .pagedjs_page").first().elementHandle();
    const frames = new Map<Frame, number>();
    let releaseFirst!: () => void;
    let releaseRest!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const restGate = new Promise<void>(resolve => { releaseRest = resolve; });
    await page.route("**/assets/*.css", async route => {
      const frame = route.request().frame();
      if (frame.parentFrame()) {
        if (!frames.has(frame)) frames.set(frame, frames.size);
        await (frames.get(frame) === 0 ? firstGate : restGate);
      }
      await route.continue();
    });
    try {
      const downloaded = page.waitForEvent("download");
      void downloaded.catch(() => {}); // Preserve the assertion failure if teardown interrupts a paused capture.
      await page.evaluate(() => { void window.__mdviewer!.exportPdf(); });
      const strip = page.locator("#app > #export-status");
      const live = page.locator("#app > #export-status > #export-status-live");
      await expect(strip).toHaveAttribute("data-phase", "preparing");
      await expect(page.locator(".export-secondary")).toBeDisabled();
      await visibleStatusGeometry(page);
      expect(await focusPreserved()).toBe(true);
      releaseFirst();
      // One page's capture, not a UI reaction: it took ~7 s on a loaded CI runner (#245).
      await expect(strip).toHaveAttribute("data-phase", "rendering", { timeout: 30_000 });
      await expect(page.locator(".export-status-text")).toHaveText(`Rendered 1 of ${count} PDF pages…`);
      await expect(page.getByRole("progressbar", { name: "PDF pages rendered" })).toHaveJSProperty("value", 1);
      await expect(live).toHaveAttribute("aria-live", "polite");
      await expect(live).toHaveAttribute("aria-atomic", "true");
      expect(await live.ariaSnapshot()).toContain(`Rendered 1 of ${count} PDF pages`);
      const geometry = await visibleStatusGeometry(page);
      if (layout.find) {
        const source = await editor.boundingBox();
        expect(source!.height).toBeGreaterThanOrEqual(60);
        expect(source!.y + source!.height).toBeLessThanOrEqual(geometry.top + 0.5);
      }
      if (layout.mode === "editor" || layout.find) {
        const canvas = await page.locator("#canvas").evaluate(element => ({ visibility: getComputedStyle(element).visibility,
          width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
        expect(canvas.visibility).toBe("hidden");
        expect(canvas.width).toBeGreaterThan(0);
        expect(canvas.height).toBeGreaterThan(0);
      }
      await info.attach("progress-geometry", { body: JSON.stringify(geometry), contentType: "application/json" });
      await writeFile(info.outputPath(`pdf-progress-${name}.json`), JSON.stringify(geometry, null, 2));
      await page.screenshot({ path: info.outputPath(`pdf-progress-${name}.png`), fullPage: true });
      expect(await sourcePosition(page)).toEqual(before);
      expect(await focusPreserved()).toBe(true);
      releaseRest();
      await downloaded;
      await expect(strip).toHaveAttribute("data-phase", "download-requested");
      await expect(live).toHaveText("PDF download requested.");
      await expect(page.locator(".export-secondary")).toBeEnabled();
      expect(await sourcePosition(page)).toEqual(before);
      expect(await focusPreserved()).toBe(true);
      expect(await firstPage!.evaluate(element => element.isConnected)).toBe(true);
      await expect(page.locator("#paged-output .pagedjs_page")).toHaveCount(count);
      await page.emulateMedia({ media: "print" });
      await expect(strip).toBeHidden();
      await expect(page.locator("#paged-output h1#export-status")).toBeVisible();
    } finally {
      releaseFirst();
      releaseRest();
      await page.unrouteAll({ behavior: "wait" });
      await focused.dispose();
    }
  });
}

test("failed PDF capture exposes failure and a successful retry clears it", async ({ page }, info) => {
  test.skip(process.env.E2E_TARGET !== "preview", "Exercises a real production capture stylesheet failure.");
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 560, height: 420 });
  await page.goto("/");
  await loadMarkdownIntoApp(page, markdown);
  await waitForPagination(page);
  await page.evaluate(() => window.__mdviewer!.updateSettings({ viewMode: "editor" }));
  const editor = page.locator("#editor-input");
  await editor.focus();
  const before = await sourcePosition(page);
  let downloads = 0;
  page.on("download", () => { downloads++; });
  await page.route("**/assets/*.css", route => route.request().frame().parentFrame()
    ? route.abort("failed") : route.continue());
  await page.evaluate(() => window.__mdviewer!.exportPdf());
  await expect(page.locator("#app > #export-status")).toHaveAttribute("data-phase", "failed");
  await expect(page.locator("#app > #export-status > #export-status-live")).toContainText("stylesheet could not load");
  await expect(page.locator(".export-status-text")).toContainText("stylesheet could not load");
  await visibleStatusGeometry(page);
  await expect(editor).toBeFocused();
  expect(await sourcePosition(page)).toEqual(before);
  expect(downloads).toBe(0);
  await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("pdf-status-failed.png"), fullPage: true });
  await page.unroute("**/assets/*.css");
  const downloaded = page.waitForEvent("download");
  await page.evaluate(() => { void window.__mdviewer!.exportPdf(); });
  await downloaded;
  await expect(page.locator("#app > #export-status > #export-status-live")).toHaveText("PDF download requested.");
  await expect(page.locator("#error-card")).toBeHidden();
  await expect(page.locator(".export-secondary")).toBeEnabled();
  await expect(editor).toBeFocused();
  expect(await sourcePosition(page)).toEqual(before);
  expect(downloads).toBe(1);
  await visibleStatusGeometry(page);
  await page.screenshot({ path: info.outputPath("pdf-status-recovered.png"), fullPage: true });
});
