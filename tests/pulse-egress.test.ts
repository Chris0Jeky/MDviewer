/**
 * Vendored SDK egress surface (public/pulseboard.js, MD3).
 *
 * The SDK is inert under automation by design (`navigator.webdriver` → inert),
 * so no live probe can observe its beacons. Instead this suite pins the SDK's
 * *ability* to phone anywhere: every absolute https origin in the artifact must
 * be the production origin or the first-party collector, and every network sink
 * must be a `cfg.collector`-derived fetch. The per-deploy byte-identity check
 * (docs/DEPLOYMENT.md "Last operator verification") then extends this proof to
 * production: the live bytes are these bytes. The live side —
 * scripts/smoke-egress.mjs — proves the app itself makes zero cross-origin
 * requests from a real deployment.
 *
 * If a reviewed SDK upgrade adds an origin or a sink, update the allow-lists
 * here deliberately, in the same PR, with the reason in the commit message.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SDK_PATH = join(ROOT, "public", "pulseboard.js");
const sdk = readFileSync(SDK_PATH, "utf8");

/** The only absolute https origins the SDK may name. */
const ALLOWED_ORIGINS = new Set([
  "https://mdviewer-c9r.pages.dev",
  "https://pulseboard-observatory.commit-atlas.workers.dev",
]);

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

  it("stays inert under automation, GPC and DNT", () => {
    expect(sdk).toMatch(/navigator\?\.webdriver/);
    expect(sdk).toMatch(/globalPrivacyControl/);
    expect(sdk).toMatch(/doNotTrack/);
  });
});
