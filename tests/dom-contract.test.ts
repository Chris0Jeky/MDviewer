import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { IDS, CLASSES, ATTRS, PAGEDJS, SPLIT_RATIO_VAR } from "../src/app/dom";

const here = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = join(here, "..", "src", "styles");

/** Concatenate every stylesheet under src/styles (recursively) into one string. */
function readAllCss(): string {
  if (!existsSync(STYLES_DIR)) return "";
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) parts.push(readFileSync(full, "utf8"));
    }
  };
  walk(STYLES_DIR);
  return parts.join("\n");
}

const CSS = readAllCss();

/**
 * Names that are intentionally JS-only behavioral hooks (queried/toggled in code,
 * never styled BY THIS SELECTOR). Excluding these keeps the drift guard meaningful:
 * anything NOT on this list must be referenced by at least one stylesheet selector.
 *
 * #warning-banner / #error-card used to sit here on the assumption that their
 * `.warning-banner` / `.error-card` classes carried the styling. Neither class had a
 * single rule in any stylesheet, so both surfaces rendered as unstyled text a full
 * canvas-height below the fold and rejected files failed silently (BUG-6). The
 * exemptions are gone: both must now be reachable from the CSS.
 */
const JS_ONLY_IDS = new Set<string>([
  IDS.fileInput, // hidden <input>; controlled via the `hidden` attribute, not by id
]);

const JS_ONLY_CLASSES = new Set<string>([
  CLASSES.landscape, // applied dynamically to wide blocks; print-only behavior
]);

describe("dom-contract: stylesheets exist", () => {
  it("src/styles contains at least one .css file", () => {
    expect(CSS.length, "no CSS found under src/styles — has the styles layer been written?").toBeGreaterThan(
      0,
    );
  });
});

describe("dom-contract: every styled DOM id appears in the CSS", () => {
  for (const [key, id] of Object.entries(IDS)) {
    const expectStyled = !JS_ONLY_IDS.has(id);
    it(`#${id} (IDS.${key})${expectStyled ? "" : " [js-only, skipped]"}`, () => {
      if (!expectStyled) return;
      expect(CSS.includes(`#${id}`), `selector #${id} missing from src/styles/*.css`).toBe(true);
    });
  }
});

describe("dom-contract: every styled class appears in the CSS", () => {
  for (const [key, cls] of Object.entries(CLASSES)) {
    const expectStyled = !JS_ONLY_CLASSES.has(cls);
    it(`.${cls} (CLASSES.${key})${expectStyled ? "" : " [js-only, skipped]"}`, () => {
      if (!expectStyled) return;
      expect(CSS.includes(`.${cls}`), `selector .${cls} missing from src/styles/*.css`).toBe(true);
    });
  }
});

describe("dom-contract: data attributes the CSS keys off appear in the CSS", () => {
  // appTheme drives chrome theming via attribute selectors on <html>. codeTheme is
  // set on .doc by App.ts but the code light/dark flip is driven by prefers-color-scheme
  // + --shiki-* variables (see shiki.css), so the CSS intentionally does not key off
  // [data-code-theme]; it is therefore treated as a JS-set, non-styling attribute.
  it("uses the app-theme attribute selector", () => {
    expect(CSS.includes(ATTRS.appTheme)).toBe(true);
  });

  // The workspace layout is pure CSS state: App only writes these two attributes, so
  // a rename that misses editor.css would silently strand a pane.
  it("uses the view-mode attribute selector", () => {
    expect(CSS.includes(ATTRS.viewMode)).toBe(true);
    for (const mode of ["editor", "split", "preview"]) {
      expect(
        CSS.includes(`[${ATTRS.viewMode}="${mode}"]`),
        `no rule for ${ATTRS.viewMode}="${mode}"`,
      ).toBe(true);
    }
  });

  it("uses the editor highlight-state attribute selector", () => {
    expect(CSS.includes(`[${ATTRS.highlightState}="off"]`)).toBe(true);
  });

  it("declares the split-ratio custom property the App writes", () => {
    expect(CSS.includes(SPLIT_RATIO_VAR)).toBe(true);
  });
});

/**
 * The primary export is `window.print()` over this same live document, so anything
 * that is screen-only chrome must be removed by an @media print rule. The editing
 * surface is the newest such chrome, and leaking it would put a textarea on paper.
 */
describe("dom-contract: screen-only chrome is suppressed in print", () => {
  const printBlocks = CSS.match(/@media\s+print\s*\{[\s\S]*?\n\}/g) ?? [];
  const printCss = printBlocks.join("\n");

  it("at least one @media print block exists", () => {
    expect(printBlocks.length).toBeGreaterThan(0);
  });

  for (const id of [IDS.editorPane, IDS.splitHandle, IDS.toolbar] as const) {
    it(`hides #${id} when printing`, () => {
      expect(
        new RegExp(`#${id}\\b[^{]*\\{[^}]*display:\\s*none`).test(printCss),
        `#${id} is not display:none inside an @media print block`,
      ).toBe(true);
    });
  }
});

describe("dom-contract: Paged.js-owned class names are referenced (screen sheet styling)", () => {
  it("styles the .pagedjs_page sheet", () => {
    expect(CSS.includes(PAGEDJS.pageClass)).toBe(true);
  });
});
