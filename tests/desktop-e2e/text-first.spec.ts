import { test, expect } from "./helpers";

declare global {
  interface Window { __firstPaint: { heights: Record<string, number>; pending: number } | null }
}

test("the reader paints text first, then upgrades code in place without moving it", async ({ page }) => {
  // Record each code placeholder's height at the moment the text is inserted,
  // before highlighting can resolve (MutationObserver runs before later tasks).
  await page.evaluate(() => {
    window.__firstPaint = null;
    const doc = document.getElementById("reader-document")!;
    new MutationObserver((_, observer) => {
      const pending = [...doc.querySelectorAll<HTMLElement>("pre.reader-pending")];
      if (!pending.length) return;
      window.__firstPaint = {
        pending: pending.length,
        heights: Object.fromEntries(pending.map(pre => [pre.dataset.src!, pre.getBoundingClientRect().height])),
      };
      observer.disconnect();
    }).observe(doc, { childList: true, subtree: true });
  });
  const elapsed = await page.evaluate(async () => {
    performance.clearMarks();
    const started = performance.now();
    document.getElementById("reader-sample")!.click();
    while (!performance.getEntriesByName("mdv:reader-text").length) await new Promise(resolve => setTimeout(resolve, 5));
    return performance.getEntriesByName("mdv:reader-text")[0]!.startTime - started;
  });
  expect(elapsed, "first text paint after opening the sample").toBeLessThan(100);

  const doc = page.locator("#reader-document");
  await expect(doc).toHaveAttribute("aria-busy", "false");
  await expect(doc.locator("pre.reader-pending")).toHaveCount(0);
  const first = await page.evaluate(() => window.__firstPaint);
  expect(first?.pending, "code was shown before highlighting").toBeGreaterThan(0);
  const after = await doc.locator("pre.shiki[data-src]").evaluateAll(pres =>
    Object.fromEntries(pres.map(pre => [(pre as HTMLElement).dataset.src!, pre.getBoundingClientRect().height])));
  for (const [range, height] of Object.entries(first!.heights)) {
    expect(Math.abs(after[range]! - height), `code block ${range} height after upgrade`).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => performance.getEntriesByName("mdv:reader-rich").length)).toBe(1);
});
