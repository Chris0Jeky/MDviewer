import { describe, it, expect } from "vitest";
import {
  CODE_THEME_PAIRS,
  getHighlighter,
  ensureLang,
} from "../src/render/highlight";
import type { CodeThemeId } from "../src/app/settings";

/** The six theme ids the Settings type allows. */
const THEME_IDS: CodeThemeId[] = ["github", "vscode", "nord", "min", "one", "catppuccin"];

describe("highlight: CODE_THEME_PAIRS shape", () => {
  it("has exactly one entry per CodeThemeId", () => {
    expect(Object.keys(CODE_THEME_PAIRS).sort()).toEqual([...THEME_IDS].sort());
  });

  it("every entry has a non-empty light and dark theme name", () => {
    for (const id of THEME_IDS) {
      const pair = CODE_THEME_PAIRS[id];
      expect(pair, `pair for ${id}`).toBeDefined();
      expect(typeof pair.light).toBe("string");
      expect(typeof pair.dark).toBe("string");
      expect(pair.light.length).toBeGreaterThan(0);
      expect(pair.dark.length).toBeGreaterThan(0);
    }
  });

  it("maps to the documented Shiki theme names", () => {
    expect(CODE_THEME_PAIRS.github).toEqual({ light: "github-light", dark: "github-dark" });
    expect(CODE_THEME_PAIRS.vscode).toEqual({ light: "light-plus", dark: "dark-plus" });
    expect(CODE_THEME_PAIRS.one).toEqual({ light: "one-light", dark: "one-dark-pro" });
    expect(CODE_THEME_PAIRS.catppuccin).toEqual({
      light: "catppuccin-latte",
      dark: "catppuccin-mocha",
    });
  });
});

// getHighlighter loads Oniguruma WASM + theme/lang grammars; allow a generous budget.
describe("highlight: getHighlighter singleton", () => {
  it("returns the SAME instance across calls (singleton identity)", async () => {
    const a = await getHighlighter();
    const b = await getHighlighter();
    expect(a).toBe(b);
  }, 30_000);

  it("loads at least the baseline themes used by CODE_THEME_PAIRS", async () => {
    const hl = await getHighlighter();
    const loaded = hl.getLoadedThemes();
    // Every theme named in the pairs must be available to render dual-theme code.
    const needed = new Set<string>();
    for (const id of THEME_IDS) {
      needed.add(CODE_THEME_PAIRS[id].light);
      needed.add(CODE_THEME_PAIRS[id].dark);
    }
    for (const theme of needed) {
      expect(loaded, `theme ${theme} loaded`).toContain(theme);
    }
  }, 30_000);

  it("can tokenize a snippet to themed HTML with the github pair", async () => {
    const hl = await getHighlighter();
    await ensureLang(hl, "typescript");
    const html = hl.codeToHtml("const x: number = 1;", {
      lang: "typescript",
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: "light",
    });
    expect(html).toContain("<pre");
    expect(html).toContain("class=\"shiki");
    // dual-theme emits the dark variable for the screen-dark flip
    expect(html).toMatch(/--shiki-dark/);
  }, 30_000);
});

describe("highlight: ensureLang", () => {
  it("is idempotent for an already-loaded language", async () => {
    const hl = await getHighlighter();
    await ensureLang(hl, "typescript");
    const before = hl.getLoadedLanguages().length;
    await ensureLang(hl, "typescript");
    expect(hl.getLoadedLanguages().length).toBe(before);
  }, 30_000);

  it("does not throw for an unknown language id", async () => {
    const hl = await getHighlighter();
    await expect(ensureLang(hl, "totally-not-a-language")).resolves.toBeUndefined();
  }, 30_000);
});
