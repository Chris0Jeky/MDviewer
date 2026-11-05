import { test, expect, type Page } from "@playwright/test";

async function probeControlledFrame(page: Page) {
  return page.evaluate(async () => {
    const links = [...document.querySelectorAll<HTMLLinkElement>('head link[rel~="stylesheet"]')]
      .filter(link => !link.disabled && !link.relList.contains("alternate") && link.hasAttribute("href"));
    const result: {
      sourceController: string | null;
      sourceStyles: Array<{ href: string; sheet: boolean }>;
      states: Array<{ stage: string; url: string; controller: string | null }>;
      styles: Array<{ href: string; outcome: string; sheet: boolean }>;
      fonts: string[];
      error?: string;
    } = {
      sourceController: navigator.serviceWorker.controller?.scriptURL ?? null,
      sourceStyles: links.map(link => ({ href: link.href, sheet: link.sheet !== null })),
      states: [], styles: [], fonts: [],
    };
    const bounded = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} exceeded 5 seconds`)), 5_000);
        })]);
      } finally { clearTimeout(timer); }
    };
    const frame = document.createElement("iframe");
    frame.dataset.offlineFrameProof = "true";
    frame.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;width:1400px;height:1500px";
    frame.srcdoc = "<!doctype html><html><head></head><body></body></html>";
    const loaded = new Promise<void>((resolve, reject) => {
      frame.onload = () => { if (frame.contentDocument?.URL === "about:srcdoc") resolve(); };
      frame.onerror = () => reject(new Error("srcdoc frame failed to load"));
    });
    try {
      document.body.appendChild(frame);
      await bounded(loaded, "srcdoc navigation");
      const doc = frame.contentDocument!;
      const state = (stage: string) => result.states.push({ stage, url: doc.URL,
        controller: doc.defaultView!.navigator.serviceWorker.controller?.scriptURL ?? null });
      state("frame-loaded");

      // Model the onclone handoff without loading any CSS in an uncontrolled
      // staging frame. The detached document contains only known app CSS links
      // and a fixed font probe; no renderer or PDF assertion is substituted.
      const staged = document.implementation.createHTMLDocument();
      const base = staged.createElement("base");
      base.href = document.baseURI;
      staged.head.appendChild(base);
      const settled = links.map(source => {
        const link = source.cloneNode(false) as HTMLLinkElement;
        const promise = new Promise<void>(resolve => {
          for (const outcome of ["load", "error"] as const) link.addEventListener(outcome, () => {
            result.styles.push({ href: link.href, outcome, sheet: link.sheet !== null });
            resolve();
          }, { once: true });
        });
        staged.head.appendChild(link);
        return promise;
      });
      const math = staged.createElement("span");
      math.className = "katex";
      math.textContent = "x";
      staged.body.appendChild(math);
      doc.replaceChild(doc.adoptNode(staged.documentElement), doc.documentElement);
      state("after-adopt");
      await bounded(Promise.all(settled), "stylesheet outcomes");
      state("after-styles");
      if (result.styles.length > 0 && result.styles.every(style => style.outcome === "load")) {
        const fonts = await bounded(doc.fonts.load("16px KaTeX_Main", "x"), "KaTeX font load");
        await bounded(doc.fonts.ready, "font readiness");
        result.fonts = fonts.map(font => font.status);
        state("after-fonts");
      }
    } catch (error) { result.error = String(error); }
    finally {
      frame.onload = null;
      frame.onerror = null;
      frame.remove();
    }
    return result;
  });
}

test("controlled srcdoc loads offline app CSS and fonts and detects a missing cached stylesheet", async ({ page, context }, info) => {
  test.skip(process.env.E2E_TARGET !== "preview", "This proof requires the production service worker.");
  const requests: Array<Record<string, unknown>> = [];
  page.on("response", response => {
    if (requests.length >= 128 || !["stylesheet", "font"].includes(response.request().resourceType())) return;
    let frame: string | undefined;
    try { frame = response.request().frame().url(); } catch { /* Service-worker requests have no frame. */ }
    requests.push({ url: response.url(), status: response.status(), frame, fromServiceWorker: response.fromServiceWorker() });
  });
  page.on("requestfailed", request => {
    if (requests.length < 128) requests.push({ url: request.url(), error: request.failure()?.errorText });
  });
  // Disable the HTTP/memory cache so the missing-CacheStorage control cannot
  // accidentally reuse CSS from the positive probe. Service-worker CacheStorage
  // remains real and is the only available source after the network is cut.
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  const evidence: Record<string, unknown> = { requests };
  try {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await context.setOffline(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    expect(await page.evaluate(() => fetch(`/__offline-frame-probe-${Date.now()}`)
      .then(response => `online-${response.status}`).catch(() => "offline"))).toBe("offline");

    const positive = await probeControlledFrame(page);
    evidence.positive = positive;
    expect(positive.error, JSON.stringify(positive)).toBeUndefined();
    expect(positive.sourceController).toBeTruthy();
    expect(positive.sourceStyles.length).toBeGreaterThan(0);
    expect(positive.states.map(state => state.controller)).toEqual(positive.states.map(() => positive.sourceController));
    expect(positive.states.every(state => state.url === "about:srcdoc")).toBe(true);
    expect(positive.styles).toHaveLength(positive.sourceStyles.length);
    expect(positive.styles.every(style => style.outcome === "load" && style.sheet)).toBe(true);
    expect(positive.fonts.length).toBeGreaterThan(0);
    expect(positive.fonts.every(status => status === "loaded")).toBe(true);
    expect(requests.some(request => request.url === positive.sourceStyles[0]!.href &&
      request.frame === "about:srcdoc" && request.fromServiceWorker === true)).toBe(true);

    const href = positive.sourceStyles[0]!.href;
    const deleted = await page.evaluate(async href => {
      let count = 0;
      for (const name of await caches.keys()) {
        if (await (await caches.open(name)).delete(href)) count++;
      }
      return count;
    }, href);
    evidence.deleted = { href, entries: deleted };
    expect(deleted, "remove the exact cached stylesheet after the source is styled").toBeGreaterThan(0);
    const negative = await probeControlledFrame(page);
    evidence.negative = negative;
    expect(negative.error, JSON.stringify(negative)).toBeUndefined();
    expect(negative.sourceStyles.every(style => style.sheet)).toBe(true);
    expect(negative.states.map(state => state.controller)).toEqual(negative.states.map(() => positive.sourceController));
    expect(negative.styles.find(style => style.href === href)?.outcome).toBe("error");
    await expect(page.locator("iframe[data-offline-frame-proof]")).toHaveCount(0);
  } finally {
    await info.attach("controlled-srcdoc-proof", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    console.log("Controlled srcdoc proof:", JSON.stringify(evidence));
    await session.detach();
  }
});
