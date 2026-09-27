import { test, expect, type Page } from "@playwright/test";
import { generateLargeDoc } from "../perf/generateLargeDoc";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { SIZE_SOFT_BYTES } from "../../src/app/input";

/**
 * Large-document profiling ladder. Opt-in only (`MDVIEWER_PERF=1`): these runs
 * take minutes and their wall times are machine-dependent, so they assert
 * completion — never a duration. The measured numbers feed docs/PERF_BUDGET.md.
 *
 * The ladder straddles SIZE_SOFT_BYTES on purpose: rungs above the gate must
 * show the large-file confirm dialog (accepted here), rungs at or below it
 * must not, pinning the gate the budget bands are set from. Each rung also
 * records main-thread longtasks and JS heap growth, the responsiveness and
 * memory halves of the budget.
 */
const ENABLED = process.env.MDVIEWER_PERF === "1";
const SIZES = [100_000, 250_000, 500_000, 1_000_000, 1_800_000];
// Generous on purpose: the ladder asserts completion, never a duration, and the
// reference top rung already takes several minutes. A tight cap would turn slower
// hardware into a failure instead of a valid measurement.
const PER_DOC_TIMEOUT_MS = 900_000;

interface LongtaskWindow {
  __perfLongtasks?: number[];
}

interface MemoryPerformance {
  memory?: { usedJSHeapSize: number };
}

async function heapMB(page: Page): Promise<string> {
  const bytes = await page.evaluate(
    () => (performance as unknown as MemoryPerformance).memory?.usedJSHeapSize ?? null,
  );
  return bytes === null ? "n/a" : (bytes / 1_000_000).toFixed(1);
}

/**
 * Collect garbage through CDP so heap samples measure retained memory rather
 * than whatever V8 has not gotten around to freeing. Without this, GC timing
 * alone moves the readings rung to rung. Best-effort: runtimes without CDP
 * (non-Chromium) fall back to a raw sample.
 */
async function collectGarbage(page: Page): Promise<void> {
  try {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("HeapProfiler.collectGarbage");
    } finally {
      await session.detach();
    }
  } catch {
    // No CDP — the sample below still runs, just with live garbage included.
  }
}

test.describe("large-document profile", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!ENABLED, "Set MDVIEWER_PERF=1 to run the profiling ladder.");

  for (const target of SIZES) {
    test(`profiles a ~${target / 1000} kB document`, async ({ page }) => {
      test.setTimeout(PER_DOC_TIMEOUT_MS);
      const markdown = generateLargeDoc(target);
      const bytes = Buffer.byteLength(markdown, "utf8");
      let dialogShown = false;
      page.on("dialog", (dialog) => {
        dialogShown = true;
        void dialog.accept();
      });
      await page.goto("/");
      await page.evaluate(() => {
        const w = window as unknown as LongtaskWindow;
        w.__perfLongtasks = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) w.__perfLongtasks?.push(entry.duration);
        }).observe({ entryTypes: ["longtask"] });
      });
      await collectGarbage(page);
      const heapBefore = await heapMB(page);
      const started = Date.now();
      await loadMarkdownIntoApp(page, markdown, `perf-${target}.md`);
      const pageCount = await waitForPagination(page, PER_DOC_TIMEOUT_MS - 5_000);
      const elapsedMs = Date.now() - started;
      const longtasks =
        (await page.evaluate(
          () => (window as unknown as LongtaskWindow).__perfLongtasks ?? [],
        )) as number[];
      await collectGarbage(page);
      const heapAfter = await heapMB(page);
      // The paginated DOM lives mostly outside the V8 heap, so node count is
      // the memory proxy with teeth; the JS-heap pair guards JS-side retention.
      const nodeCount = await page.evaluate(() => document.getElementsByTagName("*").length);
      expect(pageCount).toBeGreaterThan(0);
      // A failed pipeline can leave partial sheets behind (runPipeline clears
      // .is-paginating in a finally), so a bare page count would record a broken
      // render as a valid measurement. The fatal card must stay hidden.
      await expect(page.locator("#error-card")).toBeHidden();
      // The confirm dialog is the UX for the minutes-scale band: it must appear
      // exactly when the input exceeds the soft gate.
      expect(dialogShown).toBe(bytes > SIZE_SOFT_BYTES);
      const longtaskMs = Math.round(longtasks.reduce((n, d) => n + d, 0));
      console.log(
        `PERF bytes=${bytes} pages=${pageCount} elapsedMs=${elapsedMs} ` +
          `longtasks=${longtasks.length} longtaskMs=${longtaskMs} ` +
          `heapBeforeMB=${heapBefore} heapAfterMB=${heapAfter} nodes=${nodeCount}`,
      );
    });
  }
});
