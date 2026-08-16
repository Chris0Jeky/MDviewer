/**
 * Regenerate every raster brand asset from the single source artwork, `public/favicon.svg`.
 *
 *   node scripts/generate-icons.mjs
 *
 * Why a script and not a design tool: the PNGs are committed (a browser cannot rasterise an
 * SVG into a PWA install icon or an Open Graph card), so without a reproducible generator the
 * favicon and the manifest icons drift apart the first time the mark is tweaked. Editing
 * `public/favicon.svg` and re-running this script is the whole workflow.
 *
 * Why Playwright: it is already a devDependency with a pinned Chromium, so image generation
 * adds no new dependency and no native toolchain. Chromium rasterises the same SVG the browser
 * ships, which is exactly the fidelity we want.
 *
 * Determinism caveat: PNG bytes depend on the pinned Chromium build, and the Open Graph card
 * renders text with a system font stack, so its glyphs follow the generating machine's fonts
 * (Segoe UI on Windows). Re-running on a different machine or after a Playwright bump can
 * produce a byte-different — but visually equivalent — file. Only commit a regenerated asset
 * when the artwork actually changed; a pure-noise diff is not worth the review.
 */

import { chromium } from "@playwright/test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(REPO_ROOT, "public");
const SOURCE_SVG = join(PUBLIC_DIR, "favicon.svg");

/** App accent (`--accent` in src/styles/app.css, light theme) — the favicon tile colour. */
const ACCENT = "#2563eb";
/** Open Graph card surface, matching the light-theme `--bg-app` / `--fg-*` tokens. */
const OG_BG = "#f3f4f6";
const OG_FG_STRONG = "#111827";
const OG_FG_MUTED = "#4b5563";
const OG_BORDER = "#d1d5db";

/**
 * Every asset this script owns. `render` returns the body markup for a page already sized to
 * `width` x `height`; `opaque` decides whether the PNG keeps an alpha channel.
 *
 * - the `any`-purpose icons keep the artwork's rounded corners and a transparent background,
 *   so the platform draws the mark as authored;
 * - the maskable icon is full-bleed accent with the artwork inside the 80% safe zone, so an
 *   aggressive Android mask (circle, squircle, teardrop) can never clip the sheet;
 * - the Apple touch icon is opaque because iOS composites it onto white and rounds it itself.
 */
const TARGETS = [
  {
    file: join(PUBLIC_DIR, "icons", "icon-192.png"),
    width: 192,
    height: 192,
    opaque: false,
    render: (svg) => tile(svg, { scale: 1 }),
  },
  {
    file: join(PUBLIC_DIR, "icons", "icon-512.png"),
    width: 512,
    height: 512,
    opaque: false,
    render: (svg) => tile(svg, { scale: 1 }),
  },
  {
    file: join(PUBLIC_DIR, "icons", "maskable-512.png"),
    width: 512,
    height: 512,
    opaque: true,
    render: (svg) => tile(svg, { scale: 0.78, background: ACCENT }),
  },
  {
    file: join(PUBLIC_DIR, "icons", "apple-touch-icon.png"),
    width: 180,
    height: 180,
    opaque: true,
    render: (svg) => tile(svg, { scale: 0.86, background: ACCENT }),
  },
  {
    file: join(PUBLIC_DIR, "og-image.png"),
    width: 1200,
    height: 630,
    opaque: true,
    render: (svg) => openGraphCard(svg),
  },
];

/** Centre the artwork on an optional solid background, scaled to `scale` of the shorter side. */
function tile(svg, { scale, background = "transparent" }) {
  return `<div style="
      width:100%;height:100%;background:${background};
      display:flex;align-items:center;justify-content:center;
    ">
      <div class="mark" style="width:${scale * 100}%;height:${scale * 100}%">${svg}</div>
    </div>`;
}

/** The 1200x630 social card: mark, product name, and the same promise as the meta description. */
function openGraphCard(svg) {
  return `<div style="
      width:100%;height:100%;background:${OG_BG};color:${OG_FG_STRONG};
      display:flex;flex-direction:column;justify-content:center;gap:34px;
      padding:0 96px;box-sizing:border-box;
      font-family:'Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;
      border-bottom:14px solid ${ACCENT};
    ">
      <div class="mark" style="width:168px;height:168px">${svg}</div>
      <div>
        <div style="font-size:92px;font-weight:700;letter-spacing:-0.025em;line-height:1">MDviewer</div>
        <div style="font-size:40px;font-weight:600;color:${ACCENT};margin-top:18px;line-height:1.25">
          Markdown &rarr; page-break-safe PDF
        </div>
      </div>
      <div style="
        font-size:30px;color:${OG_FG_MUTED};line-height:1.45;max-width:900px;
        border-top:2px solid ${OG_BORDER};padding-top:26px;
      ">
        No code block, table, figure or callout is ever sliced across a page.
        Runs entirely in your browser &mdash; nothing is uploaded.
      </div>
    </div>`;
}

function pageHtml(body, width, height) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    html,body{margin:0;padding:0;background:transparent}
    body{width:${width}px;height:${height}px;overflow:hidden}
    /* The artwork is inlined as a live <svg> (not an <img src="data:...">): Chromium refuses to
       decode() an SVG image, and inline markup also lets the wrapper drive the size directly. */
    .mark > svg{width:100%;height:100%;display:block}
  </style></head><body>${body}</body></html>`;
}

async function main() {
  const svg = await readFile(SOURCE_SVG, "utf8");
  const browser = await chromium.launch();
  try {
    for (const target of TARGETS) {
      const page = await browser.newPage({
        viewport: { width: target.width, height: target.height },
        deviceScaleFactor: 1,
      });
      await page.setContent(pageHtml(target.render(svg), target.width, target.height), {
        waitUntil: "load",
      });
      // The Open Graph card sets type in a system font stack; screenshotting before the font
      // is resolved would bake in a fallback face.
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const buffer = await page.screenshot({ type: "png", omitBackground: !target.opaque });
      await mkdir(dirname(target.file), { recursive: true });
      await writeFile(target.file, buffer);
      await page.close();

      const { size } = await stat(target.file);
      const name = relative(REPO_ROOT, target.file).replaceAll("\\", "/");
      console.log(`${name.padEnd(34)} ${target.width}x${target.height}  ${(size / 1024).toFixed(1)} kB`);
    }
  } finally {
    await browser.close();
  }
}

await main();
