// @vitest-environment node
/**
 * Vendored SDK egress regression coverage (public/pulseboard.js, MD3).
 *
 * Execute the artifact in disposable jsdom realms on the registered HTTPS
 * origin: privacy signals forbid observed egress after opt-in, events, timers
 * and lifecycle flushes. An active control exercises the region hint and both
 * collector lanes. In-memory mutations prove guard inversions and alternate
 * sinks are detected; the shipped artifact is never edited. Static source
 * checks remain an additional review aid, not a behavioral proof.
 *
 * The deploy byte-identity check extends these checks to served bytes;
 * smoke-egress.mjs separately observes the app under Chromium automation.
 * Review any new SDK origin or sink deliberately in the same upgrade PR.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSdk } from "./helpers/pulseSdk";
import type { SdkRun } from "./helpers/pulseSdk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SDK_PATH = join(ROOT, "public", "pulseboard.js");
const sdk = readFileSync(SDK_PATH, "utf8");

/** The only absolute https origins the SDK may name. */
const ALLOWED_ORIGINS = new Set([
  "https://mdviewer-c9r.pages.dev",
  "https://pulseboard-observatory.commit-atlas.workers.dev",
]);

const COLLECTOR = "https://pulseboard-observatory.commit-atlas.workers.dev";
const PRIVACY_CASES = [
  { name: "automation", signals: { webdriver: true }, guard: "if (runtime?.navigator?.webdriver)", inverted: "if (!runtime?.navigator?.webdriver)" },
  { name: "GPC", signals: { globalPrivacyControl: true }, guard: "n?.globalPrivacyControl === true", inverted: "n?.globalPrivacyControl !== true" },
  { name: "DNT", signals: { doNotTrack: "1" }, guard: "n?.doNotTrack === '1'", inverted: "n?.doNotTrack !== '1'" },
];

function assertInert(result: SdkRun) {
  expect(result.errors).toEqual([]);
  expect(result.calls, "privacy signal must forbid every observed network sink").toEqual([]);
  expect(result.consent).toMatchObject({ counts: false, diagnostics: false, journeys: false, blocked: true });
  expect(result.accepted).toEqual([false, false, false]);
}

describe("vendored SDK egress surface", () => {
  it("names no absolute https origin outside the allow-list", () => {
    const urls = [...sdk.matchAll(/https:\/\/[A-Za-z0-9.-]+/g)].map((m) => m[0]);
    expect(urls.length).toBeGreaterThan(0);
    const offenders = [...new Set(urls)].filter((u) => !ALLOWED_ORIGINS.has(u));
    expect(offenders, `unexpected origins in public/pulseboard.js: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("sends only through runtime.fetch, never another network sink", () => {
    for (const sink of [
      "sendBeacon",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "importScripts",
      "new Image",
    ]) {
      expect(
        sdk.includes(sink),
        `public/pulseboard.js must not use ${sink} (review + allow-list first)`,
      ).toBe(false);
    }
    const fetchCalls = sdk.match(/runtime\.fetch\(/g) ?? [];
    expect(fetchCalls.length).toBe(2);
  });

  it("derives every fetch target from cfg.collector", () => {
    const lines = sdk.split("\n");
    const fetchLines = lines.filter((l) => l.includes("runtime.fetch("));
    expect(fetchLines.length).toBe(2);
    for (const line of fetchLines) {
      expect(
        /runtime\.fetch\((cfg\.collector|l\.url)/.test(line),
        `fetch target must be cfg.collector-derived: ${line.trim()}`,
      ).toBe(true);
    }
    // The l.url lane targets are built from cfg.collector + a fixed API path.
    expect(sdk).toMatch(/url:\s*cfg\.collector\s*\+\s*path/);
    expect(sdk).toMatch(/lane\('\/v1\/collect-stat\//);
    expect(sdk).toMatch(/lane\('\/v1\/product\//);
    expect(sdk).toMatch(/cfg\.collector\s*\+\s*'\/v1\/consent\//);
  });

  it.each(PRIVACY_CASES)("makes no request under $name despite opt-in, event calls and flushes", async ({ signals }) => {
    assertInert(await runSdk(sdk, signals));
  });

  it.each(PRIVACY_CASES)("honors $name even with an existing stored opt-in", async ({ signals }) => {
    assertInert(await runSdk(sdk, signals, true));
  });

  it("actively sends the region hint and both event lanes only to the collector without privacy signals", async () => {
    const result = await runSdk(sdk);
    expect(result.errors).toEqual([]);
    expect(result.accepted).toEqual([true, true, true]);
    expect(result.consent).toMatchObject({ counts: true, diagnostics: true, journeys: true, blocked: false });
    expect(new Set(result.calls.map(call => call.url))).toEqual(new Set([
      `${COLLECTOR}/v1/consent/mdviewer`, `${COLLECTOR}/v1/collect-stat/mdviewer`, `${COLLECTOR}/v1/product/mdviewer`,
    ]));
    expect(result.calls.every(call => call.sink === "fetch")).toBe(true);
  });

  it.each(PRIVACY_CASES)("rejects an in-memory SDK mutation that inverts the $name guard", async ({ signals, guard, inverted }) => {
    expect(sdk).toContain(guard);
    const result = await runSdk(sdk.replace(guard, inverted), signals);
    expect(result.errors).toEqual([]);
    expect(result.calls.length).toBeGreaterThan(0);
    expect(() => assertInert(result)).toThrow();
  });

  it.each([
    ["globalThis.fetch", "globalThis.fetch(url);", "fetch"],
    ["sendBeacon", "navigator.sendBeacon(url, 'synthetic');", "sendBeacon"],
    ["XMLHttpRequest", "const xhr = new XMLHttpRequest(); xhr.open('POST', url); xhr.send('synthetic');", "XMLHttpRequest"],
    ["WebSocket", "new WebSocket(url);", "WebSocket"],
    ["EventSource", "new EventSource(url);", "EventSource"],
    ["Worker", "new Worker(url);", "Worker"],
    ["importScripts", "importScripts(url);", "importScripts"],
    ["Image.src", "new Image().src = url;", "IMG.src"],
    ["img.setAttribute", "document.createElement('img').setAttribute('src', url);", "IMG.setAttribute(src)"],
    ["parsed image", "document.body.insertAdjacentHTML('beforeend', '<img src=\"' + url + '\">');", "IMG.inserted(src)"],
    ["nested parsed image", "document.body.insertAdjacentHTML('beforeend', '<section><div><img src=\"' + url + '\"></div></section>');", "IMG.inserted(src)"],
    ["nested parsed image removed synchronously", "document.body.insertAdjacentHTML('beforeend', '<section><img src=\"' + url + '\"></section>'); document.body.lastElementChild.firstElementChild.remove();", "IMG.removed(src)"],
    ["parsed image subtree cleared synchronously", "document.body.insertAdjacentHTML('beforeend', '<section><div><img src=\"' + url + '\"></div></section>'); document.body.lastElementChild.innerHTML = '';", "IMG.removed(src)"],
    ["detached innerHTML image", "const detached = document.createElement('section'); detached.innerHTML = '<div><img src=\"' + url + '\"></div>';", "IMG.inserted(src)"],
    ["detached insertAdjacentHTML image", "const detached = document.createElement('section'); detached.insertAdjacentHTML('beforeend', '<img src=\"' + url + '\">');", "IMG.inserted(src)"],
    ["detached outerHTML image", "const detached = document.createElement('section'); const child = document.createElement('div'); detached.append(child); child.outerHTML = '<img src=\"' + url + '\">';", "IMG.inserted(src)"],
    ["parsed image with immediately removed src", "document.body.insertAdjacentHTML('beforeend', '<img src=\"' + url + '\">'); document.body.lastElementChild.removeAttribute('src');", "IMG.previous(src)"],
    ["link.href", "const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = url; document.head.append(link);", "LINK.href"],
    ["parsed stylesheet", "document.head.insertAdjacentHTML('beforeend', '<link rel=\"stylesheet\" href=\"' + url + '\">');", "resource"],
  ])("rejects a synthetic %s bypass of the SDK's reviewed fetch sink", async (_name, attempt, sink) => {
    const leak = `(() => { const url = 'https://egress-regression.test/synthetic'; ${attempt} })();\n`;
    const result = await runSdk(leak + sdk, { webdriver: true });
    expect(result.errors).toEqual([]);
    expect(result.calls).toContainEqual({ sink, url: "https://egress-regression.test/synthetic" });
    expect(() => assertInert(result)).toThrow();
  });

  it("rejects parser-created image egress even on the allowed collector origin", async () => {
    const url = `${COLLECTOR}/synthetic-image`;
    const result = await runSdk(`document.body.insertAdjacentHTML('beforeend', '<section><img src="${url}"></section>');\n` + sdk, { webdriver: true });
    expect(result.errors).toEqual([]);
    expect(result.calls).toContainEqual({ sink: "IMG.inserted(src)", url });
    expect(() => assertInert(result)).toThrow();
  });
});
