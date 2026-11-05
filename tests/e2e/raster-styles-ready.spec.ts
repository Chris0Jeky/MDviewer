import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { readRasterPdf } from "../helpers/rasterPdf";

for (const viewMode of ["split", "editor"] as const) {
  test(`failed clone styles save no PDF, release their iframe and permit a retry (${viewMode})`, async ({ page }) => {
    test.skip(process.env.E2E_TARGET !== "preview", "This regression requires linked production CSS, not Vite's injected dev styles.");
    const markdown = "# Capture recovery\n\n" + Array.from({ length: 30 }, (_, index) =>
      `Paragraph ${index + 1}. The source survives a failed stylesheet load without losing the reader's place in the Markdown editor.`,
    ).join("\n\n");
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown);
    await waitForPagination(page);
    await page.getByRole("button", { name: viewMode === "editor" ? "Markdown" : "Split", exact: true }).click();
    const workspace = page.locator("#workspace");
    await expect(workspace).toHaveAttribute("data-view-mode", viewMode);
    const canvas = page.locator("#canvas");
    await canvas.evaluate(element => {
      const root = element as HTMLElement;
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      root.scrollTop = root.scrollHeight;
      root.style.scrollBehavior = behavior;
    });
    await expect.poll(() => canvas.evaluate(element => element.scrollTop - element.clientHeight)).toBeGreaterThan(0);
    const editor = page.locator("#editor-input");
    await editor.evaluate(element => {
      const input = element as HTMLTextAreaElement;
      input.setSelectionRange(12, 29, "forward");
      input.scrollTop = 120;
    });
    const readEditorPosition = () => editor.evaluate(element => {
      const input = element as HTMLTextAreaElement;
      return { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection,
        top: input.scrollTop, left: input.scrollLeft };
    });
    const editorPosition = await readEditorPosition();
    expect(editorPosition.top).toBeGreaterThan(0);
    let downloads = 0;
    let rejectedStyles = 0;
    page.on("download", () => { downloads++; });
    await page.route("**/assets/*.css", async route => {
      if (route.request().frame().parentFrame()) {
        rejectedStyles++;
        await new Promise(resolve => setTimeout(resolve, 350));
        await route.abort("failed");
      } else await route.continue();
    });
    const exportButton = page.getByRole("button", { name: "Download PDF", exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await exportButton.click();
      const errorCard = page.getByRole("alertdialog", { name: "Rendering failed" });
      await expect(errorCard).toBeVisible();
      await expect(errorCard).toContainText("stylesheet could not load. Try Print / Save as PDF.");
      const reload = errorCard.getByRole("button", { name: "Reload", exact: true });
      const viewport = await canvas.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      });
      // Check the actual viewport before trial click/focus can scroll the card into view.
      for (const feedback of [errorCard.locator(".error-message"), reload]) {
        const box = await feedback.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
        });
        expect(box.top).toBeGreaterThanOrEqual(viewport.top);
        expect(box.bottom).toBeLessThanOrEqual(viewport.bottom);
        expect(box.left).toBeGreaterThanOrEqual(viewport.left);
        expect(box.right).toBeLessThanOrEqual(viewport.right);
      }
      if (attempt === 0) {
        await page.screenshot({ path: test.info().outputPath(`failed-export-${viewMode}.png`), fullPage: true });
      }
      // Exercise hit testing without activating the destructive reload action.
      await reload.click({ trial: true });
      await reload.focus();
      await expect(reload).toBeFocused();
      await expect(exportButton).toBeEnabled();
      await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
      await expect(page.locator("#editor-input")).toHaveValue(markdown);
      expect(await readEditorPosition()).toEqual(editorPosition);
      await expect(workspace).toHaveAttribute("data-view-mode", viewMode);
      if (viewMode === "editor") {
        // Only the fatal card is revealed; pagination keeps its hidden, measurable host.
        for (const surface of [page.locator("#canvas"), page.locator("#paged-output .pagedjs_pages")]) {
          await expect(surface).toBeHidden();
          const box = await surface.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          });
          expect(box.width).toBeGreaterThan(0);
          expect(box.height).toBeGreaterThan(0);
        }
      }
      expect(downloads, "a failed stylesheet must not yield a misleading PDF").toBe(0);
    }
    expect(rejectedStyles).toBeGreaterThanOrEqual(2);
    await page.unroute("**/assets/*.css");
    const retry = page.waitForEvent("download");
    await exportButton.click();
    await retry;
    await expect(exportButton).toBeEnabled();
    expect(downloads).toBe(1);
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
    await expect(page.locator("#error-card")).toBeHidden();
    await expect(workspace).toHaveAttribute("data-view-mode", viewMode);
    await expect(page.locator("#editor-input")).toHaveValue(markdown);
    expect(await readEditorPosition()).toEqual(editorPosition);
    await page.screenshot({ path: test.info().outputPath(`recovered-export-${viewMode}.png`), fullPage: true });
  });
}

test("missing cached CSS saves no offline PDF, cleans up and permits a restored-cache retry", async ({ page, context, baseURL }, info) => {
  test.skip(process.env.E2E_TARGET !== "preview", "This regression requires the production service worker.");
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  const foreignRequests: string[] = [];
  const ownOrigin = new URL(baseURL!).origin;
  let stylesheet = "";
  let failedStyles = 0;
  let downloads = 0;
  const evidence: Array<Record<string, unknown>> = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== ownOrigin) foreignRequests.push(request.url());
  });
  page.on("requestfailed", request => {
    if (request.url() !== stylesheet) return;
    failedStyles++;
    let frame: string | undefined;
    try { frame = request.frame().url(); } catch { /* Worker requests have no frame. */ }
    if (evidence.length < 64) evidence.push({ event: "stylesheet-error", url: request.url(), frame, error: request.failure()?.errorText });
  });
  page.on("response", response => {
    if (response.url() !== stylesheet || evidence.length >= 64) return;
    let frame: string | undefined;
    try { frame = response.request().frame().url(); } catch { /* Worker requests have no frame. */ }
    evidence.push({ event: "stylesheet-response", url: response.url(), status: response.status(), frame,
      fromServiceWorker: response.fromServiceWorker() });
  });
  page.on("download", () => { downloads++; });
  const assertOfflineSource = async (stage: string) => {
    const state = await page.evaluate(() => ({ online: navigator.onLine,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null }));
    evidence.push({ event: "source", stage, ...state });
    expect(state.online, `${stage}: capture requires the offline routing hint`).toBe(false);
    expect(state.controller, `${stage}: capture requires the existing service worker`).toBeTruthy();
  };
  try {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await context.setOffline(true);
    await page.reload();
    // Keep this extra cache-control CDP session consistent with the context
    // after navigation. Assert the browser hint and disconnected transport
    // independently; a failed fetch alone does not select the offline route.
    await session.send("Network.emulateNetworkConditions", {
      offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await assertOfflineSource("after-reload");
    expect(await page.evaluate(() => fetch(`/__offline-recovery-probe-${Date.now()}`)
      .then(response => `online-${response.status}`).catch(() => "offline"))).toBe("offline");
    const markdown = "# Offline capture recovery\n\nThe source survives missing capture CSS.\n\n```ts\nconst offline = true;\n```\n\nMath: $e^{i\\pi}+1=0$.";
    await loadMarkdownIntoApp(page, markdown, "offline-recovery.md");
    expect(await waitForPagination(page)).toBe(1);
    await page.getByRole("button", { name: "Markdown", exact: true }).click();

    // The source has already loaded its CSS. Remove only that exact app asset
    // from real CacheStorage; no route intercepts or manufactures a response.
    const removed = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('head link[rel="stylesheet"][href]')!;
      const backups: Array<{ name: string; response: Response }> = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        const response = await cache.match(link.href);
        if (response && await cache.delete(link.href)) backups.push({ name, response });
      }
      (window as Window & { __offlineStyleBackups?: typeof backups }).__offlineStyleBackups = backups;
      return { href: link.href, entries: backups.length, sourceStyled: link.sheet !== null };
    });
    stylesheet = removed.href;
    expect(removed.entries).toBeGreaterThan(0);
    expect(removed.sourceStyled).toBe(true);
    const exportButton = page.getByRole("button", { name: "Download PDF", exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await assertOfflineSource(`missing-css-${attempt + 1}`);
      await exportButton.click();
      const error = page.getByRole("alertdialog", { name: "Rendering failed" });
      await expect(error).toBeVisible();
      await expect(error).toContainText("stylesheet could not load. Try Print / Save as PDF.");
      await expect(exportButton).toBeEnabled();
      await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
      await expect(page.locator("#editor-input")).toHaveValue(markdown);
      await expect(page.locator("#workspace")).toHaveAttribute("data-view-mode", "editor");
      expect(downloads, "missing offline CSS must not yield an incomplete PDF").toBe(0);
    }
    expect(failedStyles, "both failed captures must request the missing stylesheet").toBeGreaterThanOrEqual(2);
    expect(evidence.filter(event => event.event === "stylesheet-error" && event.frame === "about:srcdoc").length,
      "both missing-CSS controls must exercise the controlled destination").toBeGreaterThanOrEqual(2);
    const restored = await page.evaluate(async href => {
      const target = window as Window & { __offlineStyleBackups?: Array<{ name: string; response: Response }> };
      let count = 0;
      for (const backup of target.__offlineStyleBackups ?? []) {
        const cache = await caches.open(backup.name);
        await cache.put(href, backup.response);
        if (await cache.match(href)) count++;
      }
      delete target.__offlineStyleBackups;
      return count;
    }, stylesheet);
    expect(restored).toBe(removed.entries);
    await assertOfflineSource("restored-cache-retry");
    const downloading = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloading;
    const path = test.info().outputPath("offline-cache-recovery.pdf");
    await download.saveAs(path);
    expect(readRasterPdf(await readFile(path))).toHaveLength(1);
    await expect(exportButton).toBeEnabled();
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
    await expect(page.locator("#error-card")).toBeHidden();
    await expect(page.locator("#editor-input")).toHaveValue(markdown);
    await expect(page.locator("#workspace")).toHaveAttribute("data-view-mode", "editor");
    expect(downloads).toBe(1);
    expect(foreignRequests).toEqual([]);
    expect(evidence.some(event => event.event === "stylesheet-response" && event.frame === "about:srcdoc" &&
      event.fromServiceWorker === true && event.status === 200), "retry CSS must come from the service worker").toBe(true);
  } finally {
    const path = info.outputPath("offline-css-recovery.json");
    await writeFile(path, JSON.stringify(evidence, null, 2));
    await info.attach("offline-css-recovery", { path, contentType: "application/json" });
    if (info.status !== info.expectedStatus) console.log("Offline CSS recovery:", JSON.stringify(evidence));
    if (!page.isClosed()) await session.detach();
  }
});
