/**
 * Shiki 4.x highlighter — fine-grained singleton.
 *
 * We use the `shiki/core` API so Vite code-splits each language/theme into its own
 * lazily-loaded chunk: only the langs and themes we ship are bundled, and the heavy
 * Oniguruma WASM grammar engine loads once. The reader prepares only requested
 * grammars; getHighlighter() keeps the complete eager workspace contract. Both
 * share one instance so md.render() stays synchronous via fromHighlighter.
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
let preparingWorkspace: Promise<HighlighterCore> | null = null;
const loadingLanguages = new WeakMap<HighlighterCore, Map<string, Promise<void>>>();

/**
 * Explicit imports bound the bundle and let the reader load only the requested
 * grammar modules, including the embedded grammars each module supplies.
 */
const LANGUAGE_LOADERS = {
  typescript: () => import("@shikijs/langs/typescript"),
  javascript: () => import("@shikijs/langs/javascript"),
  python: () => import("@shikijs/langs/python"),
  bash: () => import("@shikijs/langs/bash"),
  json: () => import("@shikijs/langs/json"),
  markdown: () => import("@shikijs/langs/markdown"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  sql: () => import("@shikijs/langs/sql"),
  yaml: () => import("@shikijs/langs/yaml"),
  diff: () => import("@shikijs/langs/diff"),
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
type LanguageId = keyof typeof LANGUAGE_LOADERS;
type LanguageInput = Parameters<HighlighterCore["loadLanguage"]>[number];

const WORKSPACE_LANGUAGE_IDS = [
  "typescript", "javascript", "python", "bash", "json", "markdown", "html", "css",
  "rust", "go", "java", "c", "cpp", "sql", "yaml", "diff",
] as const satisfies readonly LanguageId[];

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

const SPECIAL_LANGUAGE_IDS = new Set(["mermaid", "text", "plaintext", "txt", ""]);

function normalizeLanguageId(lang: string): string {
  const id = lang.toLowerCase().replace(/^language-/, "");
  // Fence labels are untrusted strings, never Object.prototype property names.
  return Object.hasOwn(LANGUAGE_ALIASES, id) ? LANGUAGE_ALIASES[id]! : id;
}

export function isSupportedLanguage(lang: string): boolean {
  const id = normalizeLanguageId(lang);
  return SPECIAL_LANGUAGE_IDS.has(id) || Object.hasOwn(LANGUAGE_LOADERS, id);
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
 * Eager workspace contract: every common grammar and every theme is ready before
 * resolving, including when a reader created the engine first. Keep this readiness
 * promise separate from engine creation and retry after a failed preparation.
 */
export function getHighlighter(): Promise<HighlighterCore> {
  if (preparingWorkspace) return preparingWorkspace;
  preparingWorkspace = prepareLanguages(WORKSPACE_LANGUAGE_IDS).catch(error => {
    preparingWorkspace = null;
    throw error;
  });
  return preparingWorkspace;
}

/** Reader-only preparation; plaintext transformers can request no grammars. */
export function getReaderHighlighter(languages: readonly string[]): Promise<HighlighterCore> {
  const ids = [...new Set(languages.map(normalizeLanguageId))]
    .filter((id): id is LanguageId => Object.hasOwn(LANGUAGE_LOADERS, id));
  return prepareLanguages(ids, true);
}

async function prepareLanguages(
  languages: readonly LanguageId[],
  preserveOptionalEmbeds = false,
): Promise<HighlighterCore> {
  // Start grammar imports alongside engine/theme creation, preserving the eager
  // workspace's parallel asset preparation. Native module imports remain cached.
  const [hl, grammars] = await Promise.all([
    getCoreHighlighter(),
    Promise.all(languages.map(id => LANGUAGE_LOADERS[id]())),
  ]);
  // Optional embeds are not included in a grammar's module. Keep their previous
  // common-language colors (including transitive grammar members) without a new
  // embed resolver. Workspace preparation does not take this reader-only path,
  // so its own Markdown grammar cannot wait on the workspace promise itself.
  if (preserveOptionalEmbeds && grammars.some(module =>
    module.default.some(grammar => grammar.embeddedLangsLazy?.length))) {
    await getHighlighter();
  }
  await Promise.all(languages.map((id, index) => loadLanguage(hl, id, () => grammars[index]!)));
  return hl;
}

function getCoreHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return Promise.resolve(highlighter);
  if (creating) return creating;
  creating = create().catch((err) => {
    creating = null;
    throw err;
  });
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
    langs: [],
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
  if (!Object.hasOwn(LANGUAGE_LOADERS, id)) return;
  await loadLanguage(hl, id, LANGUAGE_LOADERS[id as LanguageId]);
}

function loadLanguage(hl: HighlighterCore, id: string, input: () => LanguageInput): Promise<void> {
  if (hl.getLoadedLanguages().includes(id)) return Promise.resolve();
  let loading = loadingLanguages.get(hl);
  if (!loading) {
    loading = new Map();
    loadingLanguages.set(hl, loading);
  }
  const pending = loading.get(id);
  if (pending) return pending;
  const work = Promise.resolve().then(() => hl.loadLanguage(input())).finally(() => loading.delete(id));
  loading.set(id, work);
  return work;
}

/** Load every supported fenced language before markdown-it's synchronous render. */
export async function ensureMarkdownLanguages(
  hl: HighlighterCore,
  src: string,
): Promise<void> {
  for (const lang of findFenceLanguages(src)) await ensureLang(hl, lang);
}
