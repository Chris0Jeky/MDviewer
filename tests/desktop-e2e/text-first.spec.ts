import { test, expect } from "./helpers";

declare global {
  interface Window { __firstPaint: { heights: Record<string, number>; pending: number } | null }
}

test("the first text frame for the sample lands within 100 ms", async ({ page }) => {
  const elapsed = await page.evaluate(async () => {
    performance.clearMarks();
    const started = performance.now();
    document.getElementById("reader-sample")!.click();
    while (!performance.getEntriesByName("mdv:reader-text").length) await new Promise(resolve => setTimeout(resolve, 5));
    return performance.getEntriesByName("mdv:reader-text")[0]!.startTime - started;
  });
  test.info().annotations.push({ type: "first-text-ms", description: elapsed.toFixed(1) });
  expect(elapsed, "click to the end of the first frame showing the sample text").toBeLessThan(100);
  await expect(page.locator("#reader-document")).toHaveAttribute("aria-busy", "false");
  expect(await page.evaluate(() => performance.getEntriesByName("mdv:reader-rich").length)).toBe(1);
});

test("code placeholders keep their height when highlighting replaces them", async ({ page }) => {
  // Record each placeholder's height as the text is inserted, before highlighting resolves.
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
  await page.locator("#reader-sample").click();
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
});

test("scrolling while code and diagrams upgrade keeps the reader's place", async ({ page }) => {
  // Hold back every lazily loaded chunk (grammars, Mermaid) so the upgrade is still running.
  await page.route("**/assets/**", async route => { await new Promise(resolve => setTimeout(resolve, 800)); await route.continue(); });
  await page.locator("#reader-sample").click();
  const doc = page.locator("#reader-document");
  await expect(doc.locator("pre.reader-pending").first()).toBeAttached();
  await expect(doc).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("navigation", { name: "Document headings" })).toBeVisible();
  const scroll = page.locator("#reader-scroll");
  await scroll.evaluate(element => { element.style.scrollBehavior = "auto"; element.scrollTop = 600; });
  await expect(doc).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(600);
});
