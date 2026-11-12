import { getReaderHighlighter, isSupportedLanguage } from "../render/highlight";
import type { MarkdownIt, Token } from "markdown-it";
import { createMarkdown, installMarkdownHighlighter, parsedFenceLanguages, renderMarkdownTokens } from "../render/markdown";
import { renderAllMermaid } from "../render/mermaid";
import { sanitizeRenderedHtml } from "../render/sanitize";
import type { Settings } from "../app/settings";
import { CLASSES, ATTRS } from "../app/dom";
import { readFrontMatter } from "../render/frontmatter";
import { frontMatterCard } from "./reader/frontmatter";
import { collectFences, installSourceMap, sourceLines, stampSourceMap } from "./reader/sourcemap";
import { decorateCopy } from "./reader/copy";
import { parseActionable } from "../render/actionable";
import { chipRow, markFields } from "./reader/actionable";
import { decorateControls } from "./reader/controls";

/**
 * Continuous reading keeps natural endnotes and never invokes Paged.js.
 *
 * Text first: with `paint`, the parsed document is handed over at once with fences as
 * plain-text placeholders that share the highlighted block's box metrics; highlighted
 * code then replaces each placeholder in place, and Mermaid renders last. `paint` returns
 * the live root (or null when this render is obsolete). Without `paint` the returned
 * document is complete.
 */
export async function renderReaderDocument(
  text: string,
  settings: Settings,
  fileName = "",
  paint?: (document: HTMLElement) => HTMLElement | null,
  /** A data document's readable view: actionable controls and the front matter card stay off. */
  options: { data?: boolean } = {},
): Promise<{ document: HTMLElement; warnings: string[] }> {
  const md = createMarkdown(null, settings);
  const env = {};
  const { body, frontMatter } = readFrontMatter(text);
  const tokens = md.parse(body, env);
  const lines = sourceLines(text);
  stampSourceMap(tokens, lines);
  // Before rendering: Shiki's notation transformers rewrite fence content in place.
  const source = { lines, fences: collectFences(tokens) };
  // Actionable Markdown (static in A1): reuse this parse; fields get labels before rendering.
  const actionable = options.data ? parseActionable("") : parseActionable(text, tokens);
  if (tokens[0] && !options.data) markFields(tokens, actionable, tokens[0].constructor as Parameters<typeof markFields>[2]);
  const languages = parsedFenceLanguages(md, tokens).filter(language =>
    !["text", "plaintext", "txt", "mermaid"].includes(language) && isSupportedLanguage(language));
  // Explicit line numbers, notation directives and metadata highlighting still
  // use the existing transformers even when the fence has no syntax grammar.
  // A data view keeps fence text literal: notation directives never trigger a transformer.
  const highlight = languages.length > 0 || (options.data ? settings.showLineNumbers : needsCodeTransformers(md, tokens, settings.showLineNumbers));
  if (highlight) {
    const lineNumbers = settings.showLineNumbers ? ` ${CLASSES.withLineNumbers}` : "";
    // Shiki's own line structure (inline-block .line spans), so the swap keeps every height.
    // The info string rides on the placeholder: block patching keys on this markup, so a
    // changed language or metadata (`ts {1}` -> `ts {2}`) re-highlights an unchanged body.
    md.options.highlight = (code, lang, attrs) => `<pre class="shiki ${PENDING}${lineNumbers}" data-fence="${
      md.utils.escapeHtml(`${lang} ${attrs}`.trim())}"><code>${code.replace(/\n$/, "").split("\n")
      .map(line => `<span class="line">${md.utils.escapeHtml(line)}</span>`).join("\n")}</code></pre>`;
  }
  installSourceMap(md);
  const result = renderMarkdownTokens(md, tokens, env);
  const document = window.document.createElement("div");
  document.className = CLASSES.doc;
  document.setAttribute(ATTRS.codeTheme, settings.codeTheme);
  document.innerHTML = result.html;
  if (!options.data && (frontMatter || actionable.problems.length)) document.prepend(frontMatterCard(frontMatter, fileName, actionable.problems));
  const chips = chipRow(actionable);
  if (chips) document.prepend(chips);
  // Before Mermaid: a diagram replaces its <pre> inside the stamped wrapper, keeping copy.
  decorateCopy(document, source, fileName);
  decorateControls(document, actionable);
  const warnings = result.warnings.map(warning => warning.message);
  if (!text.trim()) warnings.push("This document is empty. Press Ctrl+E to write in it.");

  const root = paint ? paint(document) : document;
  if (!root) return { document, warnings };
  // Let the text reach the screen before grammar and engine loading compete for the thread.
  // A hidden or minimized window draws no frames, so a timeout bounds the wait.
  if (paint && window.requestAnimationFrame) {
    await new Promise<void>(resolve => {
      const done = (): void => { clearTimeout(fallback); resolve(); };
      const fallback = setTimeout(done, 100);
      window.requestAnimationFrame(() => setTimeout(() => {
        performance.mark("mdv:reader-text"); // after the frame that first shows the text
        done();
      }));
    });
  }
  const reason = (error: unknown): string => error instanceof Error ? error.message : String(error);
  // The text is already on screen: an upgrade failure is a warning, never a failed render.
  if (highlight) {
    try {
      installMarkdownHighlighter(md, await getReaderHighlighter(languages), settings, options.data);
      upgradeCode(md, tokens, env, root);
    } catch (error) {
      warnings.push(`Code highlighting is unavailable: ${reason(error)}`);
    }
  }
  try {
    const diagrams = await renderAllMermaid(root, "default");
    if (diagrams.failed) warnings.push(`${diagrams.failed} diagram(s) could not render; their source is shown.`);
  } catch (error) {
    warnings.push(`Diagrams are unavailable: ${reason(error)}`);
  }
  performance.mark("mdv:reader-rich");
  return { document: root, warnings };
}

const PENDING = "reader-pending";

/** Replace each placeholder still inside `root` (a superseded render's root is emptied). */
function upgradeCode(md: MarkdownIt, tokens: Token[], env: Parameters<MarkdownIt["parse"]>[1], root: HTMLElement): void {
  const byLine = new Map<string, number>();
  tokens.forEach((token, index) => { if (token.type === "fence") byLine.set(String(token.attrGet("data-src") ?? ""), index); });
  const fence = md.renderer.rules.fence!;
  const work: Array<{ pending: HTMLElement; html: string }> = [];
  for (const pending of root.querySelectorAll<HTMLElement>(`pre.${PENDING}`)) {
    const index = byLine.get(pending.getAttribute("data-src") ?? "");
    if (index !== undefined) work.push({ pending, html: fence(tokens, index, md.options, env, md.renderer) });
  }
  // One sanitizer pass for every block (S9: thousands of separate passes cost more than the
  // highlighting). Each block keeps its own wrapper; one that does not survive intact is
  // sanitized on its own, exactly as before.
  const template = window.document.createElement("template");
  template.innerHTML = sanitizeRenderedHtml(work.map((item, i) => `<div data-upgrade="${i}">${item.html}</div>`).join("")).html;
  const wrappers = [...template.content.children];
  work.forEach((item, i) => {
    const wrapper = wrappers[i];
    let highlighted = wrapper?.getAttribute("data-upgrade") === String(i) && wrapper.childElementCount === 1 ? wrapper.firstElementChild : null;
    if (!highlighted) {
      const single = window.document.createElement("template");
      single.innerHTML = sanitizeRenderedHtml(item.html).html;
      highlighted = single.content.firstElementChild;
    }
    if (highlighted) item.pending.replaceWith(highlighted);
  });
}

function needsCodeTransformers(md: MarkdownIt, tokens: Token[], lineNumbers: boolean): boolean {
  return tokens.some(token => {
    const info = md.utils.unescapeAll(token.info).trim();
    const language = info.split(/\s+/, 1)[0]?.toLowerCase().replace(/^language-/, "");
    return (token.type === "fence" && language !== "mermaid"
      && (lineNumbers || /\[!code/i.test(token.content) || /\S\s+\S/.test(info)))
      || !!(token.children && needsCodeTransformers(md, token.children, lineNumbers));
  });
}
