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

import type { MarkdownIt } from "markdown-it";
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

/**
 * The single source of truth for the colour KaTeX paints failed math in.
 *
 * KaTeX marks failures two different ways and only one of them is self-describing:
 *   - a hard PARSE error (`$\sqrt{$`) produces `<span class="katex-error" title="…">`;
 *   - an unknown control sequence under `strict: "ignore"` (`$\notacommand{x}$`, the
 *     katex 0.18 behaviour) produces an ordinary `<span style="color:…">` with no class
 *     and no title at all.
 * Both paint with `errorColor`, so that colour — not a hard-coded literal — is what
 * `tagKatexErrors` matches on to give the two cases one uniform, detectable marker.
 */
export const KATEX_ERROR_COLOR = "#cc0000";

/** Tooltip added to error spans that KaTeX left unexplained. */
export const KATEX_ERROR_HINT = "Invalid math expression — shown as literal source.";

const KATEX_OPTIONS: KatexPluginOptions = {
  katex,
  throwOnError: false, // bad TeX renders red inline instead of aborting the whole doc
  errorColor: KATEX_ERROR_COLOR,
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

/** Normalise a CSS colour through the CSSOM so `#cc0000` and `rgb(204, 0, 0)` compare equal. */
function normalizeColor(value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  return probe.style.color;
}

/**
 * Post-process rendered HTML so every KaTeX failure carries `class="katex-error"` and a
 * `title`, whichever of the two failure shapes KaTeX produced.
 *
 * Runs on the SANITIZED markup, before the pagination source is built, so it changes no
 * layout-affecting step of the render order — it only adds a class and an attribute.
 *
 * Detection is by inline colour (compared through the CSSOM, so the literal hex never has
 * to be duplicated) and is scoped to descendants of `.katex`, so a user's own red HTML can
 * never be mistaken for broken math. Only the OUTERMOST coloured span in a nest is tagged,
 * so the affordance is drawn once.
 *
 * @returns the rewritten HTML and how many distinct expressions were tagged.
 */
export function tagKatexErrors(html: string): { html: string; count: number } {
  if (!html.includes("katex")) return { html, count: 0 };

  const template = document.createElement("template");
  template.innerHTML = html;

  const errorColor = normalizeColor(KATEX_ERROR_COLOR);
  let count = 0;

  const candidates = Array.from(
    template.content.querySelectorAll<HTMLElement>(".katex-error, .katex span[style*='color']"),
  );

  for (const element of candidates) {
    const isParseError = element.classList.contains("katex-error");
    if (!isParseError && normalizeColor(element.style.color) !== errorColor) continue;
    // Nested coloured spans belong to the same failed expression — tag the outermost only.
    if (element.parentElement?.closest(".katex-error")) continue;

    element.classList.add("katex-error");
    // A parse error already carries KaTeX's own message; only fill in the silent case.
    if (!element.getAttribute("title")) element.setAttribute("title", KATEX_ERROR_HINT);
    count += 1;
  }

  return { html: count > 0 ? template.innerHTML : html, count };
}
