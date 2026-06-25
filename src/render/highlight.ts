/**
 * Shiki 3.x highlighter — fine-grained singleton.
 *
 * We use the `shiki/core` API so Vite code-splits each language/theme into its own
 * lazily-loaded chunk: only the langs and themes we ship are bundled, and the heavy
 * Oniguruma WASM grammar engine loads once. The highlighter is created exactly once
 * (`getHighlighter()` returns the same promise/instance forever) and reused across
 * every render so `md.render()` can stay synchronous via `fromHighlighter`.
 */

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import type { CodeThemeId } from "../app/settings";

export interface CodeThemePair {
  light: string;
  dark: string;
}

/**
 * The six selectable code-theme families, each a Shiki { light, dark } pair. The
 * names match the bundled `@shikijs/themes/*` modules imported in `create()` below;
 * if you add a pair here you must also add its theme imports there.
 */
export const CODE_THEME_PAIRS: Record<CodeThemeId, CodeThemePair> = {
  github: { light: "github-light", dark: "github-dark" },
  vscode: { light: "light-plus", dark: "dark-plus" },
  nord: { light: "nord", dark: "nord" },
  min: { light: "min-light", dark: "min-dark" },
  one: { light: "one-light", dark: "one-dark-pro" },
  catppuccin: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
};

let highlighter: HighlighterCore | null = null;
let creating: Promise<HighlighterCore> | null = null;

/**
 * Returns the shared highlighter, creating it on first call. Concurrent callers during
 * the initial async creation share one in-flight promise (no duplicate WASM loads).
 */
export function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return Promise.resolve(highlighter);
  if (creating) return creating;
  creating = create();
  return creating;
}

async function create(): Promise<HighlighterCore> {
  const hl = await createHighlighterCore({
    themes: [
      import("@shikijs/themes/github-light"),
      import("@shikijs/themes/github-dark"),
      import("@shikijs/themes/light-plus"),
      import("@shikijs/themes/dark-plus"),
      import("@shikijs/themes/nord"),
      import("@shikijs/themes/min-light"),
      import("@shikijs/themes/min-dark"),
      import("@shikijs/themes/one-light"),
      import("@shikijs/themes/one-dark-pro"),
      import("@shikijs/themes/catppuccin-latte"),
      import("@shikijs/themes/catppuccin-mocha"),
    ],
    langs: [
      import("@shikijs/langs/typescript"),
      import("@shikijs/langs/javascript"),
      import("@shikijs/langs/python"),
      import("@shikijs/langs/bash"),
      import("@shikijs/langs/json"),
      import("@shikijs/langs/markdown"),
      import("@shikijs/langs/html"),
      import("@shikijs/langs/css"),
      import("@shikijs/langs/rust"),
      import("@shikijs/langs/go"),
      import("@shikijs/langs/java"),
      import("@shikijs/langs/c"),
      import("@shikijs/langs/cpp"),
      import("@shikijs/langs/sql"),
      import("@shikijs/langs/yaml"),
      import("@shikijs/langs/diff"),
    ],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
  highlighter = hl;
  creating = null;
  return hl;
}

/**
 * Ensure a language grammar is loaded before highlighting a block that requests it.
 * Already-loaded languages return immediately. Unknown / unbundled language ids are a
 * no-op (the caller falls back to plain `text`), so this never throws on bad input.
 */
export async function ensureLang(hl: HighlighterCore, lang: string): Promise<void> {
  if (!lang) return;
  if (hl.getLoadedLanguages().includes(lang)) return;
  const langs = (await import("@shikijs/langs")) as Record<string, unknown>;
  const loader = langs[lang];
  if (typeof loader === "function") {
    const loaded = await (loader as () => Promise<never>)();
    await hl.loadLanguage(loaded);
  }
}
