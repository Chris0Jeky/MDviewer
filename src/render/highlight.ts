/**
 * Shiki 4.x highlighter — fine-grained singleton.
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
 * Common grammars kept off the startup path. Explicit subpath imports give Vite a
 * bounded set of lazy chunks instead of glob-bundling the entire Shiki catalogue.
 */
const LAZY_LANGUAGE_LOADERS = {
  csharp: () => import("@shikijs/langs/csharp"),
  php: () => import("@shikijs/langs/php"),
  ruby: () => import("@shikijs/langs/ruby"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  swift: () => import("@shikijs/langs/swift"),
  scala: () => import("@shikijs/langs/scala"),
  powershell: () => import("@shikijs/langs/powershell"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  toml: () => import("@shikijs/langs/toml"),
  xml: () => import("@shikijs/langs/xml"),
  jsx: () => import("@shikijs/langs/jsx"),
  tsx: () => import("@shikijs/langs/tsx"),
  vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"),
  graphql: () => import("@shikijs/langs/graphql"),
  r: () => import("@shikijs/langs/r"),
  latex: () => import("@shikijs/langs/latex"),
  makefile: () => import("@shikijs/langs/makefile"),
  terraform: () => import("@shikijs/langs/terraform"),
  nginx: () => import("@shikijs/langs/nginx"),
  ini: () => import("@shikijs/langs/ini"),
} as const;

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  md: "markdown",
  rs: "rust",
  yml: "yaml",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  "c#": "csharp",
  rb: "ruby",
  kt: "kotlin",
  ps1: "powershell",
  docker: "dockerfile",
  gql: "graphql",
  tex: "latex",
  make: "makefile",
  tf: "terraform",
  hcl: "terraform",
};

const BASE_LANGUAGE_IDS = new Set([
  "typescript", "javascript", "python", "bash", "json", "markdown", "html", "css",
  "rust", "go", "java", "c", "cpp", "sql", "yaml", "diff", "mermaid",
  "text", "plaintext", "txt", "",
]);

function normalizeLanguageId(lang: string): string {
  const id = lang.toLowerCase().replace(/^language-/, "");
  return LANGUAGE_ALIASES[id] ?? id;
}

export function isSupportedLanguage(lang: string): boolean {
  const id = normalizeLanguageId(lang);
  return BASE_LANGUAGE_IDS.has(id) || id in LAZY_LANGUAGE_LOADERS;
}

/** Return distinct fenced-code language ids in source order. */
export function findFenceLanguages(src: string): string[] {
  const seen = new Set<string>();
  const languages: string[] = [];
  const fenceRe = /^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\s`{]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(src)) !== null) {
    const id = normalizeLanguageId(match[1] ?? "");
    if (id && !seen.has(id)) {
      seen.add(id);
      languages.push(id);
    }
  }
  return languages;
}

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
  const id = normalizeLanguageId(lang);
  if (!id || hl.getLoadedLanguages().includes(id)) return;
  const loader = LAZY_LANGUAGE_LOADERS[id as keyof typeof LAZY_LANGUAGE_LOADERS];
  if (loader) await hl.loadLanguage(loader());
}

/** Load every supported fenced language before markdown-it's synchronous render. */
export async function ensureMarkdownLanguages(
  hl: HighlighterCore,
  src: string,
): Promise<void> {
  for (const lang of findFenceLanguages(src)) await ensureLang(hl, lang);
}
