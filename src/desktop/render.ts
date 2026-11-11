import { getReaderHighlighter, isSupportedLanguage } from "../render/highlight";
import type { MarkdownIt, Token } from "markdown-it";
import { createMarkdown, installMarkdownHighlighter, parsedFenceLanguages, renderMarkdownTokens } from "../render/markdown";
import { renderAllMermaid } from "../render/mermaid";
import type { Settings } from "../app/settings";
import { CLASSES, ATTRS } from "../app/dom";
import { readFrontMatter } from "../render/frontmatter";
import { frontMatterCard } from "./reader/frontmatter";
import { collectFences, installSourceMap, sourceLines, stampSourceMap } from "./reader/sourcemap";
import { decorateCopy } from "./reader/copy";

/** Continuous reading keeps natural endnotes and never invokes Paged.js. */
export async function renderReaderDocument(text: string, settings: Settings, fileName = ""): Promise<{
  document: HTMLElement;
  warnings: string[];
}> {
  const md = createMarkdown(null, settings);
  const env = {};
  const { body, frontMatter } = readFrontMatter(text);
  const tokens = md.parse(body, env);
  const lines = sourceLines(text);
  stampSourceMap(tokens, lines);
  const languages = parsedFenceLanguages(md, tokens).filter(language =>
    !["text", "plaintext", "txt", "mermaid"].includes(language) && isSupportedLanguage(language));
  // Explicit line numbers, notation directives and metadata highlighting still
  // use the existing transformers even when the fence has no syntax grammar.
  if (languages.length || needsCodeTransformers(md, tokens, settings.showLineNumbers)) {
    const highlighter = await getReaderHighlighter(languages);
    installMarkdownHighlighter(md, highlighter, settings);
  }
  installSourceMap(md);
  const result = renderMarkdownTokens(md, tokens, env);
  const document = window.document.createElement("div");
  document.className = CLASSES.doc;
  document.setAttribute(ATTRS.codeTheme, settings.codeTheme);
  document.innerHTML = result.html;
  if (frontMatter) document.prepend(frontMatterCard(frontMatter, fileName));
  const diagrams = await renderAllMermaid(document, "default");
  decorateCopy(document, { lines, fences: collectFences(tokens) }, fileName);
  const warnings = result.warnings.map(warning => warning.message);
  if (diagrams.failed) warnings.push(`${diagrams.failed} diagram(s) could not render; their source is shown.`);
  if (!text.trim()) warnings.push("This document is empty. Use Edit & PDF to add Markdown.");
  return { document, warnings };
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
