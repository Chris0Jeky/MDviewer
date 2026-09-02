/**
 * The MarkdownIt factory — assembles the full plugin stack and Shiki/KaTeX wiring.
 *
 * Plugin order is load-bearing: `attrs` and `anchor` run BEFORE `toc-done-right`, and all
 * three share one `SLUGIFY` so the auto-TOC links resolve to the exact heading ids `anchor`
 * emitted. Shiki is wired via `fromHighlighter` so `md.render()` stays synchronous (the
 * highlighter was awaited once, upstream). KaTeX is applied via `registerKatex` (math.ts).
 *
 * `renderMarkdown` runs the render and then does a best-effort scan of the produced HTML
 * for KaTeX error markers and unknown code-fence languages, surfacing them as warnings the
 * UI can aggregate into a banner without aborting the export.
 */

import MarkdownItCtor, { type MarkdownIt, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import anchor from "markdown-it-anchor";
import tocDoneRight from "markdown-it-toc-done-right";
import container from "markdown-it-container";
import attrs from "markdown-it-attrs";
import taskLists from "markdown-it-task-lists";
import { fromHighlighter } from "@shikijs/markdown-it/core";
import {
  transformerNotationHighlight,
  transformerNotationDiff,
  transformerMetaHighlight,
} from "@shikijs/transformers";
import type { ShikiTransformer, BundledLanguage } from "shiki";
import type { HighlighterCore } from "shiki/core";
import type { Settings } from "../app/settings";
import { CLASSES } from "../app/dom";
import { CODE_THEME_PAIRS, isSupportedLanguage } from "./highlight";
import { registerKatex, tagKatexErrors } from "./math";
import { sanitizeRenderedHtml } from "./sanitize";

export interface RenderWarning {
  /**
   * `content` covers document-level notices that are not a rendering failure — currently
   * only "the document is empty". It exists so such notices never have to masquerade as a
   * security/lang warning in the banner's aggregate summary.
   */
  kind: "math" | "diagram" | "lang" | "security" | "content";
  message: string;
}

/**
 * Slugify shared across anchor, toc-done-right, and our synthesized TOC fallback so every
 * heading id and every link target are produced by the identical function — the only way to
 * guarantee they match. Trims, lowercases, collapses whitespace to hyphens, drops anything
 * outside `[\w-]`, and percent-encodes the result so non-ASCII headings stay valid in `href`.
 */
export const SLUGIFY: (s: string) => string = (s: string): string => {
  const base = String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
  // A CSS id selector (used by Paged.js `target-counter` for the TOC and by our own
  // resolvers) must not start with a digit or hyphen. Numbered headings like
  // "## 1. Introduction" would otherwise produce "#1-introduction", an invalid selector
  // that throws mid-pagination. Prefix those — and empty slugs — to stay query-safe.
  const safe = base && /^[a-z_]/.test(base) ? base : `sec-${base}`;
  return encodeURIComponent(safe);
};

/** Container-callout flavours; each becomes a `:::name` fenced block. */
const CALLOUTS = ["note", "tip", "warning", "danger"] as const;

/**
 * The plugin shape `md.use()` accepts. markdown-it 15 ships its own typings and, unlike the
 * old `@types/markdown-it`, no longer exports `PluginSimple`/`PluginWithParams`, so we name
 * that shape here for the one call site that has to cast into it.
 */
type MarkdownItPlugin<Params extends unknown[] = unknown[]> = (
  md: MarkdownIt,
  ...params: Params
) => void;

/** Line-numbers transformer: marks the `<pre>` so the CSS counter (shiki.css) activates. */
function lineNumbers(): ShikiTransformer {
  return {
    name: "line-numbers",
    pre(node) {
      this.addClassToHast(node, CLASSES.withLineNumbers);
    },
  };
}

/**
 * Build a fully-configured MarkdownIt for the given highlighter + settings. The Shiki theme
 * pair and the line-numbers transformer are settings-dependent, so a fresh instance is built
 * whenever the code theme or line-number toggle changes.
 */
export function createMarkdown(hl: HighlighterCore, settings: Settings): MarkdownIt {
  const md = new MarkdownItCtor({
    html: true, // required: KaTeX / Mermaid produce raw HTML
    linkify: true,
    typographer: true,
    langPrefix: "language-",
  });

  md.use(attrs, { leftDelimiter: "{", rightDelimiter: "}" })
    .use(anchor, {
      slugify: SLUGIFY,
      permalink: anchor.permalink.headerLink({ safariReaderFix: true }),
      level: [1, 2, 3, 4],
    })
    .use(tocDoneRight, {
      slugify: SLUGIFY,
      level: [1, 2, 3],
      listType: "ul",
      containerClass: CLASSES.toc,
    })
    .use(footnote)
    .use(taskLists, { enabled: true, label: true });

  for (const name of CALLOUTS) {
    // @types/markdown-it-container bundles its own (older) markdown-it types, so the
    // plugin's `md` parameter is nominally a different MarkdownIt — cast to our plugin type.
    md.use(container as unknown as MarkdownItPlugin, name, {
      render(tokens: Token[], idx: number): string {
        const t = tokens[idx];
        if (t && t.nesting === 1) {
          const info = t.info.trim().slice(name.length).trim();
          const title = info || name[0]!.toUpperCase() + name.slice(1);
          return `<div class="${CLASSES.callout} ${CLASSES.callout}-${name}"><p class="${CLASSES.calloutTitle}">${md.utils.escapeHtml(
            title,
          )}</p>\n`;
        }
        return "</div>\n";
      },
    });
  }

  registerKatex(md);

  const pair = CODE_THEME_PAIRS[settings.codeTheme];
  const transformers: ShikiTransformer[] = [
    transformerNotationHighlight(),
    transformerNotationDiff(),
    transformerMetaHighlight(),
  ];
  if (settings.showLineNumbers) transformers.push(lineNumbers());

  md.use(
    // HighlighterCore is HighlighterGeneric<never,never>; fromHighlighter wants <any,any>.
    // The instance is compatible at runtime — cast to the expected parameter type.
    fromHighlighter(hl as Parameters<typeof fromHighlighter>[0], {
      themes: { light: pair.light, dark: pair.dark },
      defaultColor: "light", // inline light color → vector PDF is correct with zero extra CSS
      cssVariablePrefix: "--shiki-",
      transformers,
      // Unknown languages fall back to plain text instead of throwing. "text" is a
      // Shiki special language (always available); the option type only lists real
      // grammars, so cast.
      fallbackLanguage: "text" as unknown as BundledLanguage,
    }),
  );

  // Shiki owns the fence rule, but Mermaid fences are diagram source rather than
  // highlighted code. Override after installing Shiki and delegate every other
  // language back to its renderer so renderAllMermaid can find the canonical class.
  const shikiFence = md.renderer.rules.fence;
  if (!shikiFence) throw new Error("Shiki did not register a Markdown fence renderer");
  md.renderer.rules.fence = (tokens, idx, options, env, self): string => {
    const token = tokens[idx];
    const language = (token?.info.trim().split(/\s+/, 1)[0] ?? "")
      .toLowerCase()
      .replace(/^language-/, "");
    if (language === "mermaid") {
      return `<pre><code class="language-mermaid">${md.utils.escapeHtml(token?.content ?? "")}</code></pre>\n`;
    }
    return shikiFence(tokens, idx, options, env, self);
  };

  return md;
}

/**
 * Render markdown to HTML and collect best-effort warnings.
 *
 * markdown-it + the plugins render synchronously and swallow recoverable errors (KaTeX with
 * `throwOnError:false`, Shiki with a text fallback), so we recover warnings by scanning: the
 * source for code-fence language ids we do not bundle, and the rendered HTML for KaTeX's
 * error markers. Each distinct issue is reported once.
 */
export function renderMarkdown(
  md: MarkdownIt,
  src: string,
): { html: string; warnings: RenderWarning[] } {
  const rawHtml = md.render(src);
  const sanitized = sanitizeRenderedHtml(rawHtml);
  // Normalise KaTeX's two failure shapes into one detectable marker (class + title) before
  // anything reads the output. Purely additive markup: no layout step is affected.
  const math = tagKatexErrors(sanitized.html);
  const warnings: RenderWarning[] = [];

  if (sanitized.removedCount > 0) {
    warnings.push({
      kind: "security",
      message: `Blocked ${sanitized.removedCount} unsafe HTML ${
        sanitized.removedCount === 1 ? "item" : "items"
      } or remote-resource ${sanitized.removedCount === 1 ? "reference" : "references"}.`,
    });
  }

  // Unknown fenced-code languages: Shiki silently falls back to plain text. Scan the raw
  // source for ``` / ~~~ fences with an info string whose first token we do not ship.
  const seenLangs = new Set<string>();
  const fenceRe = /^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\s`{]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(src)) !== null) {
    const lang = (m[1] ?? "").toLowerCase().replace(/^language-/, "");
    if (lang && !isSupportedLanguage(lang) && !seenLangs.has(lang)) {
      seenLangs.add(lang);
      warnings.push({
        kind: "lang",
        message: `Code language "${lang}" is not bundled; rendered as plain text.`,
      });
    }
  }

  // KaTeX errors: detect the class `tagKatexErrors` just guaranteed, never a colour
  // literal — the old hex string-match broke silently on an errorColor change and
  // false-positived on any user HTML that happened to contain the same hex.
  if (math.count > 0) {
    warnings.push({
      kind: "math",
      message:
        math.count === 1
          ? "One math expression could not be parsed and is shown in red."
          : `${math.count} math expressions could not be parsed and are shown in red.`,
    });
  }

  return { html: math.html, warnings };
}
