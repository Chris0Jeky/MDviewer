/**
 * The offline guarantee.
 *
 * A service worker that precaches only the entry chunk produces an app that *looks* like it
 * works offline: the shell paints, the empty state appears, and then the first Print, the
 * first fenced code block or the first equation fails, because Paged.js, Mermaid, the Shiki
 * grammars, jsPDF and the KaTeX fonts are all dynamically imported on demand. That failure
 * mode is invisible to every other test in the suite.
 *
 * So this spec does not assert "the page loaded". It drives a real document through the full
 * render+paginate pipeline with the network cut, which can only succeed if the lazily
 * imported chunks and the font files were genuinely precached.
 *
 * It runs against the built bundle only — `dist/sw.js` does not exist in dev, where the PWA
 * plugin is deliberately disabled so hot module replacement is never shadowed by a worker:
 *
 *   npm run build
 *   E2E_TARGET=preview E2E_PORT=5283 npx playwright test tests/e2e/offline.spec.ts
 */
import { test, expect } from "@playwright/test";
import { waitForPagination } from "../helpers/pagedDom";

const IS_PREVIEW = process.env.E2E_TARGET === "preview";

test.describe("offline: the built app works with the network cut", () => {
  test.skip(
    !IS_PREVIEW,
    "The service worker is only emitted by `vite build` — run with E2E_TARGET=preview after `npm run build`.",
  );

  test("paginates a document with no network access", async ({ page, context, baseURL }) => {
    // Watch every request the app makes, so the local-first claim is checked on the way past
    // rather than assumed. Anything cross-origin is a contract breach regardless of whether
    // this test would otherwise pass.
    const ownOrigin = new URL(baseURL!).origin;
    const foreignRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.origin !== ownOrigin) {
        foreignRequests.push(request.url());
      }
    });

    await page.goto("/");

    // `navigator.serviceWorker.ready` resolves once the registration has an ACTIVE worker.
    // Activation only happens after install succeeds, and install is held open by Workbox's
    // precaching — so this is also the signal that the precache is fully populated.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

    await context.setOffline(true);
    await page.reload();

    // A navigation to an in-scope URL is handled by the active worker even though the first
    // load was uncontrolled, so this page is served entirely from the precache.
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: 10_000,
      })
      .toBe(true);
    await expect(page.locator("#app")).toBeVisible();

    // The bundled sample is a string constant in the entry chunk, but rendering it pulls in
    // Shiki grammars, KaTeX (fonts included), Mermaid and finally Paged.js — the four lazy
    // paths that a shell-only precache would break.
    await page.evaluate(() => window.__mdviewer!.loadSample());
    const pageCount = await waitForPagination(page);
    expect(pageCount, "no .pagedjs_page sheets offline — the Paged.js chunk was not precached").toBeGreaterThan(0);

    const host = page.locator("#paged-output");
    await expect(host.locator(".pagedjs_page").first()).toBeVisible();
    // Syntax highlighting proves the curated Shiki grammar chunks resolved offline.
    await expect(host.locator(".shiki").first()).toBeVisible();
    // KaTeX proves both its chunk and its woff2 faces are in the precache.
    await expect(host.locator(".katex").first()).toBeVisible();
    // Mermaid renders to SVG asynchronously through its own large chunk graph.
    await expect(host.locator("figure.mermaid-figure svg").first()).toBeVisible();

    expect(foreignRequests, "MDviewer must never request a cross-origin URL").toEqual([]);
  });
});
