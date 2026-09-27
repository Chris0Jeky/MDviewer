/**
 * Export must work with the network cut.
 *
 * `offline.spec.ts` proves render+pagination works from the precache, and
 * `export.spec.ts` proves both export paths work online — but neither proves
 * export works offline. If the jsPDF/html2canvas chunks were not precached,
 * the raster path would fail only here. (Print CSS needs no such proof: it is
 * raw-imported into the paginate chunk, so offline pagination implies it.)
 *
 * Preview-only, like the offline spec (`dist/sw.js` does not exist in dev):
 *
 *   npm run build
 *   E2E_TARGET=preview E2E_PORT=5283 npx playwright test tests/e2e/export-offline.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { waitForPagination } from "../helpers/pagedDom";

const IS_PREVIEW = process.env.E2E_TARGET === "preview";

test.describe("export with the network cut", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !IS_PREVIEW,
    "The service worker is only emitted by `vite build` — run with E2E_TARGET=preview after `npm run build`.",
  );

  function assertNoEgress(page: Page) {
    const seen =
      (page as unknown as { __foreignRequests?: string[] }).__foreignRequests ?? [];
    expect(seen, "MDviewer must never request a cross-origin URL").toEqual([]);
  }

  test.beforeEach(async ({ page, context, baseURL }) => {
    const ownOrigin = new URL(baseURL!).origin;
    const foreignRequests: string[] = [];
    (page as unknown as { __foreignRequests?: string[] }).__foreignRequests =
      foreignRequests;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.origin !== ownOrigin) {
        foreignRequests.push(request.url());
      }
    });
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await context.setOffline(true);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: 10_000,
      })
      .toBe(true);
    await expect(page.locator("#app")).toBeVisible();
    // Positive proof the network is actually cut (not merely a controller present):
    // an uncached path resolves online but rejects offline.
    const netState = await page.evaluate(() =>
      fetch(`/__offline-probe-${Date.now()}`)
        .then((r) => `online-${r.status}`)
        .catch(() => "offline"),
    );
    expect(netState).toBe("offline");
    await page.evaluate(() => window.__mdviewer!.loadSample());
    const pageCount = await waitForPagination(page);
    expect(pageCount).toBeGreaterThan(0);
    expect(foreignRequests, "MDviewer must never request a cross-origin URL").toEqual([]);
  });

  test("vector export calls window.print() over real offline sheets", async ({ page }) => {
    // The app only calls window.print in the click handler, so stubbing here is
    // in place in time. Print CSS needs no separate proof: it is raw-imported
    // into the paginate chunk, so the offline pagination above already proves it
    // is present.
    await page.evaluate(() => {
      const w = window as unknown as { __printCalls?: number; __printedSheets?: number };
      w.__printCalls = 0;
      window.print = () => {
        w.__printCalls = (w.__printCalls ?? 0) + 1;
        const host = document.getElementById("paged-output");
        w.__printedSheets = host?.querySelectorAll(".pagedjs_page").length ?? 0;
      };
    });
    await page.locator(".export-primary").first().click();
    const snapshot = await page.evaluate(() => {
      const w = window as unknown as { __printCalls?: number; __printedSheets?: number };
      return { calls: w.__printCalls ?? 0, sheets: w.__printedSheets ?? 0 };
    });
    expect(snapshot.calls).toBe(1);
    expect(snapshot.sheets).toBeGreaterThan(1);
    // The beforeEach assertion only covers setup; re-assert after the export
    // so an export-time fetch/XHR/WebSocket cannot slip through unexamined.
    assertNoEgress(page);
  });

  test("raster export downloads a PDF with no network access", async ({ page }) => {
    const downloadBtn = page.locator(".export-secondary").first();
    test.skip(
      (await downloadBtn.count()) === 0,
      "no .export-secondary control in this build",
    );
    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    await downloadBtn.click();
    await expect(downloadBtn).toBeDisabled();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    await expect(page.locator("#status-live")).toContainText(/pdf downloaded/i, {
      timeout: 30_000,
    });
    await expect(downloadBtn).toBeEnabled();
    assertNoEgress(page);
  });

  test.afterEach(async ({ page }) => {
    // Belt-and-braces: covers skipped-assertion paths (e.g. early skip).
    assertNoEgress(page);
  });
});
