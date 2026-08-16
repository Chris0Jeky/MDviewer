/**
 * head-contract — a filesystem guard over `index.html` (and the PWA manifest declared in
 * `vite.config.ts`), in the same spirit as dom-contract.test.ts.
 *
 * Two classes of bug this catches, both of which are invisible to every other test because
 * they only manifest in a browser tab or a link unfurl:
 *
 *  1. a referenced brand asset that does not exist in `public/` (a 404 favicon, an Open Graph
 *     card that renders as a blank box on every social platform that caches it);
 *  2. drift between the <title>/description a search engine reads and the og:/twitter: copy a
 *     social platform reads — the two are duplicated by necessity, so a change to one that
 *     misses the other must fail loudly.
 *
 * It also pins the ordering contract for the pre-paint theme script: it has to stay the last
 * thing in <head> so the metadata above it is parsed first and the attribute is still set
 * before first paint.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..");
const PUBLIC_DIR = join(REPO_ROOT, "public");

const INDEX_HTML = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
const VITE_CONFIG = readFileSync(join(REPO_ROOT, "vite.config.ts"), "utf8");

const doc = new DOMParser().parseFromString(INDEX_HTML, "text/html");
const head = doc.head;

/** The production origin, single-sourced from <link rel="canonical">. */
const CANONICAL = head.querySelector<HTMLLinkElement>("link[rel='canonical']")?.getAttribute("href") ?? "";

function metaContent(selector: string): string {
  return head.querySelector(selector)?.getAttribute("content")?.trim() ?? "";
}

describe("head-contract: identity and icons", () => {
  it("declares an SVG favicon (so the browser stops falling back to a 404 /favicon.ico)", () => {
    const icon = head.querySelector<HTMLLinkElement>("link[rel='icon']");
    expect(icon, "no <link rel=\"icon\"> in index.html").not.toBeNull();
    expect(icon?.getAttribute("type")).toBe("image/svg+xml");
    expect(icon?.getAttribute("href")).toBe("/favicon.svg");
  });

  it("declares an apple-touch-icon for iOS home-screen installs", () => {
    const apple = head.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
    expect(apple, "no <link rel=\"apple-touch-icon\"> in index.html").not.toBeNull();
    expect(apple?.getAttribute("href")).toMatch(/^\/icons\/.+\.png$/);
  });

  it("declares a canonical URL and a theme colour", () => {
    expect(CANONICAL).toMatch(/^https:\/\/[^/]+\/$/);
    expect(metaContent("meta[name='theme-color']")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("head-contract: social cards", () => {
  it("declares the Open Graph tags a link unfurl needs", () => {
    expect(metaContent("meta[property='og:type']")).toBe("website");
    expect(metaContent("meta[property='og:title']")).not.toBe("");
    expect(metaContent("meta[property='og:description']")).not.toBe("");
    expect(metaContent("meta[property='og:url']")).toBe(CANONICAL);
  });

  it("points og:image and twitter:image at an absolute URL on the canonical origin", () => {
    for (const selector of ["meta[property='og:image']", "meta[name='twitter:image']"]) {
      const image = metaContent(selector);
      expect(image, `${selector} is missing`).not.toBe("");
      expect(image.startsWith(CANONICAL), `${selector} must be absolute on ${CANONICAL}`).toBe(true);
    }
  });

  it("uses a large summary card", () => {
    expect(metaContent("meta[name='twitter:card']")).toBe("summary_large_image");
  });

  it("keeps og:/twitter: copy identical to <title> and <meta name=description>", () => {
    const title = doc.title.trim();
    const description = metaContent("meta[name='description']");
    expect(title).not.toBe("");
    expect(description).not.toBe("");

    expect(metaContent("meta[property='og:title']")).toBe(title);
    expect(metaContent("meta[name='twitter:title']")).toBe(title);
    expect(metaContent("meta[property='og:description']")).toBe(description);
    expect(metaContent("meta[name='twitter:description']")).toBe(description);
  });

  it("keeps the PWA manifest description identical to <meta name=description>", () => {
    // The manifest is generated from vite.config.ts, which cannot import index.html, so the
    // string is necessarily duplicated. This is the assertion that makes that duplication safe.
    const declared = /const DESCRIPTION =\s*"((?:[^"\\]|\\.)*)"/.exec(VITE_CONFIG)?.[1];
    expect(declared, "vite.config.ts no longer declares a DESCRIPTION constant").toBeDefined();
    expect(declared).toBe(metaContent("meta[name='description']"));
  });
});

describe("head-contract: every referenced brand asset exists in public/", () => {
  // Scan both files: index.html carries the favicon/apple-touch/og:image references and
  // vite.config.ts carries the PWA manifest's icon list. A manifest icon that 404s makes the
  // app silently un-installable, which no runtime test would notice.
  const ASSET_PATTERN = /\/(?:favicon\.svg|og-image\.png|icons\/[\w.-]+\.png)/g;
  const referenced = [
    ...new Set([...INDEX_HTML.matchAll(ASSET_PATTERN), ...VITE_CONFIG.matchAll(ASSET_PATTERN)].map((m) => m[0])),
  ].sort();

  it("references at least the favicon, the OG card and the apple-touch icon", () => {
    expect(referenced).toContain("/favicon.svg");
    expect(referenced).toContain("/og-image.png");
    expect(referenced.some((path) => path.startsWith("/icons/"))).toBe(true);
  });

  it("declares the install-icon set an installable PWA needs", () => {
    // 192 and 512 are the sizes Chrome's installability check looks for, and a maskable
    // variant is what keeps Android from cropping the sheet out of the mark.
    expect(referenced).toContain("/icons/icon-192.png");
    expect(referenced).toContain("/icons/icon-512.png");
    expect(VITE_CONFIG).toMatch(/purpose:\s*"maskable"/);
  });

  for (const path of referenced) {
    it(`public${path} exists`, () => {
      expect(
        existsSync(join(PUBLIC_DIR, path.replace(/^\//, ""))),
        `public${path} is referenced but missing — run \`node scripts/generate-icons.mjs\``,
      ).toBe(true);
    });
  }
});

describe("head-contract: the pre-paint theme script stays last in <head>", () => {
  it("is the final element of <head>", () => {
    const last = head.lastElementChild;
    expect(last?.tagName.toLowerCase()).toBe("script");
    expect(last?.textContent ?? "").toContain("data-app-theme");
  });
});
