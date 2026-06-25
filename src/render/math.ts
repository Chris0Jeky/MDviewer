/**
 * KaTeX wiring for markdown-it.
 *
 * `@vscode/markdown-it-katex` renders math synchronously during `md.render()`, so this
 * must be applied while building the MarkdownIt instance (see `createMarkdown`). We pass
 * OUR pinned `katex` instance so the plugin and the bundled fonts/CSS stay version-locked,
 * and `throwOnError: false` so a single bad expression renders inline in red instead of
 * aborting the whole document. The KaTeX stylesheet import lives here (exactly once) so the
 * fonts ship with the bundle; pagination later waits on `document.fonts.ready`.
 */

import type MarkdownIt from "markdown-it";
import mk from "@vscode/markdown-it-katex";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * The declared option surface of `@vscode/markdown-it-katex` only types a subset of the
 * options that flow through to KaTeX at render time. We pass the full runtime option set
 * (errorColor / strict / output / trust / macros are honoured by KaTeX itself), so we
 * describe that wider shape locally and apply it via the plugin's option parameter.
 */
interface KatexPluginOptions {
  katex: typeof katex;
  throwOnError: boolean;
  errorColor: string;
  strict: "ignore" | "warn" | "error" | boolean;
  output: "html" | "mathml" | "htmlAndMathml";
  trust: boolean;
  macros: Record<string, string>;
}

const KATEX_OPTIONS: KatexPluginOptions = {
  katex,
  throwOnError: false, // bad TeX renders red inline instead of aborting the whole doc
  errorColor: "#cc0000",
  strict: "ignore",
  output: "html",
  trust: false,
  macros: {
    "\\R": "\\mathbb{R}",
    "\\eps": "\\varepsilon",
  },
};

/**
 * Apply the KaTeX plugin to a MarkdownIt instance. Handles both the ESM default-export
 * and interop-wrapped (`{ default }`) shapes the plugin can present under Vite.
 */
export function registerKatex(md: MarkdownIt): void {
  const plugin = (mk as unknown as { default?: typeof mk }).default ?? mk;
  md.use(plugin as Parameters<MarkdownIt["use"]>[0], KATEX_OPTIONS);
}
