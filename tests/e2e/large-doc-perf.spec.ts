import { test, expect } from "@playwright/test";
import { generateLargeDoc } from "../perf/generateLargeDoc";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

/**
 * Large-document profiling ladder. Opt-in only (`MDVIEWER_PERF=1`): these runs
 * take minutes and their wall times are machine-dependent, so they assert
 * completion — never a duration. The measured numbers feed docs/PERF_BUDGET.md.
 *
 * Sizes stop below SIZE_SOFT_BYTES (2 MB): above it the app asks for
 * confirmation, which is a UX path, not a pagination profile.
 */
const ENABLED = process.env.MDVIEWER_PERF === "1";
const SIZES = [100_000, 500_000, 1_000_000, 1_800_000];
// Generous on purpose: the ladder asserts completion, never a duration, and the
// reference top rung already takes ~4 minutes. A tight cap would turn slower
// hardware into a failure instead of a valid measurement.
const PER_DOC_TIMEOUT_MS = 900_000;

test.describe("large-document profile", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!ENABLED, "Set MDVIEWER_PERF=1 to run the profiling ladder.");

  for (const target of SIZES) {
    test(`profiles a ~${target / 1000} kB document`, async ({ page }) => {
      test.setTimeout(PER_DOC_TIMEOUT_MS);
      const markdown = generateLargeDoc(target);
      const bytes = Buffer.byteLength(markdown, "utf8");
      await page.goto("/");
      const started = Date.now();
      await loadMarkdownIntoApp(page, markdown, `perf-${target}.md`);
      const pageCount = await waitForPagination(page, PER_DOC_TIMEOUT_MS - 5_000);
      const elapsedMs = Date.now() - started;
      expect(pageCount).toBeGreaterThan(0);
      console.log(
        `PERF bytes=${bytes} pages=${pageCount} elapsedMs=${elapsedMs}`,
      );
    });
  }
});
