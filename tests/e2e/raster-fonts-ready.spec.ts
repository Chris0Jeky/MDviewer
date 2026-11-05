import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { readRasterPdf } from "../helpers/rasterPdf";

test("missing cached font saves no offline PDF, cleans up and permits a restored-cache retry", async ({ page, context, baseURL }, info) => {
  test.skip(process.env.E2E_TARGET !== "preview", "This regression requires the production service worker.");
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  const ownOrigin = new URL(baseURL!).origin;
  const foreignRequests: string[] = [];
  const evidence: Array<Record<string, unknown>> = [];
  let fontUrl = "";
  let downloads = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== ownOrigin) foreignRequests.push(request.url());
  });
  page.on("requestfailed", request => {
    if (request.url() !== fontUrl || evidence.length >= 64) return;
    let frame: string | undefined;
    try { frame = request.frame().url(); } catch { /* Worker requests have no frame. */ }
    evidence.push({ event: "font-error", url: request.url(), frame, error: request.failure()?.errorText });
  });
  page.on("response", response => {
    if (evidence.length >= 64 || (response.url() !== fontUrl && response.request().resourceType() !== "stylesheet")) return;
    let frame: string | undefined;
    try { frame = response.request().frame().url(); } catch { /* Worker requests have no frame. */ }
    evidence.push({ event: response.url() === fontUrl ? "font-response" : "stylesheet-response", url: response.url(),
      status: response.status(), frame, fromServiceWorker: response.fromServiceWorker() });
  });
  page.on("download", () => { downloads++; });
  const assertOfflineSource = async (stage: string) => {
    const state = await page.evaluate(() => ({ online: navigator.onLine,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      fontLoaded: [...document.fonts].some(font => font.family.replaceAll('"', "") === "KaTeX_Main" &&
        font.style === "normal" && ["normal", "400"].includes(font.weight) && font.status === "loaded") }));
    evidence.push({ event: "source", stage, ...state });
    expect(state.online, `${stage}: capture requires the offline routing hint`).toBe(false);
    expect(state.controller, `${stage}: capture requires the existing service worker`).toBeTruthy();
    expect(state.fontLoaded, `${stage}: the source must retain its already loaded math font`).toBe(true);
  };
  try {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await context.setOffline(true);
    await page.reload();
    // The extra cache-control CDP session must agree with the context's offline
    // transport. No JavaScript navigator property or asset response is replaced.
    await session.send("Network.emulateNetworkConditions", {
      offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await page.evaluate(() => fetch(`/__offline-font-probe-${Date.now()}`)
      .then(response => `online-${response.status}`).catch(() => "offline"))).toBe("offline");
    const markdown = "# Offline font recovery\n\nThe source keeps its loaded font.\n\nMath: $123 + 456 = 579$.";
    await loadMarkdownIntoApp(page, markdown, "offline-font-recovery.md");
    expect(await waitForPagination(page)).toBe(1);
    await expect(page.locator("#paged-output .katex-error")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    await assertOfflineSource("source-ready");

    // Vite precaches woff2; its woff/ttf fallback files are deliberately excluded.
    // Delete only the real Main-Regular font, after the source has loaded it.
    const removed = await page.evaluate(async () => {
      const backups: Array<{ name: string; request: Request; response: Response }> = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (!/\/KaTeX_Main-Regular-[^/]+\.woff2$/.test(new URL(request.url).pathname)) continue;
          const response = await cache.match(request);
          if (response && await cache.delete(request)) backups.push({ name, request, response });
        }
      }
      (window as Window & { __offlineFontBackups?: typeof backups }).__offlineFontBackups = backups;
      return { urls: [...new Set(backups.map(backup => backup.request.url))], entries: backups.length };
    });
    expect(removed.urls).toHaveLength(1);
    expect(removed.entries).toBeGreaterThan(0);
    fontUrl = removed.urls[0]!;
    const exportButton = page.getByRole("button", { name: "Download PDF", exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await assertOfflineSource(`missing-font-${attempt + 1}`);
      await exportButton.click();
      const error = page.getByRole("alertdialog", { name: "Rendering failed" });
      await expect(error).toBeVisible();
      await expect(error).toContainText("fonts could not load. Try Print / Save as PDF.");
      await expect(exportButton).toBeEnabled();
      await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
      await expect(page.locator("#editor-input")).toHaveValue(markdown);
      await expect(page.locator("#workspace")).toHaveAttribute("data-view-mode", "editor");
      expect(downloads, "a missing attempted font must not yield a fallback-font PDF").toBe(0);
    }
    expect(evidence.filter(event => event.event === "font-error" && event.frame === "about:srcdoc").length,
      "both failed captures must request the missing font in the controlled destination").toBeGreaterThanOrEqual(2);
    expect(evidence.filter(event => event.event === "stylesheet-response" && event.frame === "about:srcdoc" &&
      event.fromServiceWorker === true && event.status === 200).length, "app CSS must still load for both font controls").toBeGreaterThanOrEqual(2);

    const restored = await page.evaluate(async () => {
      const target = window as Window & {
        __offlineFontBackups?: Array<{ name: string; request: Request; response: Response }>;
      };
      let count = 0;
      for (const backup of target.__offlineFontBackups ?? []) {
        const cache = await caches.open(backup.name);
        await cache.put(backup.request, backup.response);
        if (await cache.match(backup.request)) count++;
      }
      delete target.__offlineFontBackups;
      return count;
    });
    expect(restored).toBe(removed.entries);
    await assertOfflineSource("restored-cache-retry");
    const downloading = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloading;
    const path = info.outputPath("offline-font-recovery.pdf");
    await download.saveAs(path);
    expect(readRasterPdf(await readFile(path))).toHaveLength(1);
    await expect(exportButton).toBeEnabled();
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
    await expect(page.locator("#error-card")).toBeHidden();
    await expect(page.locator("#editor-input")).toHaveValue(markdown);
    await expect(page.locator("#workspace")).toHaveAttribute("data-view-mode", "editor");
    expect(downloads).toBe(1);
    expect(foreignRequests).toEqual([]);
    expect(evidence.some(event => event.event === "font-response" && event.frame === "about:srcdoc" &&
      event.fromServiceWorker === true && event.status === 200), "retry font must come from the service worker").toBe(true);
  } finally {
    const path = info.outputPath("offline-font-recovery.json");
    await writeFile(path, JSON.stringify(evidence, null, 2));
    await info.attach("offline-font-recovery", { path, contentType: "application/json" });
    if (info.status !== info.expectedStatus) console.log("Offline font recovery:", JSON.stringify(evidence));
    if (!page.isClosed()) await session.detach();
  }
});
