import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { IDS, CLASSES, ATTRS, PAGEDJS } from "../src/app/dom";

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
 * The codebase convention is id = JS hook, class = visual styling: Banner.ts gives
 * #warning-banner / #error-card a matching `.warning-banner` / `.error-card` class
 * and toggles visibility via the id, so those ids are styled (if at all) by class.
 */
const JS_ONLY_IDS = new Set<string>([
  IDS.fileInput, // hidden <input>; controlled via the `hidden` attribute, not by id
  IDS.warningBanner, // styled by its `.warning-banner` class; id is the toggle hook
  IDS.errorCard, // styled by its `.error-card` class; id is the toggle hook
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
});

describe("dom-contract: Paged.js-owned class names are referenced (screen sheet styling)", () => {
  it("styles the .pagedjs_page sheet", () => {
    expect(CSS.includes(PAGEDJS.pageClass)).toBe(true);
  });
});
