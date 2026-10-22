import { ensureLang, getHighlighter, isSupportedLanguage } from "../render/highlight";
import type { Token } from "markdown-it";
import { createMarkdown, installMarkdownHighlighter, parsedFenceLanguages, renderMarkdownTokens } from "../render/markdown";
import { renderAllMermaid } from "../render/mermaid";
import type { Settings } from "../app/settings";
import { CLASSES, ATTRS } from "../app/dom";

/** Continuous reading keeps natural endnotes and never invokes Paged.js. */
export async function renderReaderDocument(text: string, settings: Settings): Promise<{
  document: HTMLElement;
  warnings: string[];
}> {
  const md = createMarkdown(null, settings);
  const env = {};
  const tokens = md.parse(text, env);
  const languages = parsedFenceLanguages(tokens).filter(language =>
    !["text", "plaintext", "txt", "mermaid"].includes(language) && isSupportedLanguage(language));
  // Explicit line numbers, notation directives and metadata highlighting still
  // use the existing transformers even when the fence has no syntax grammar.
  if (languages.length || needsCodeTransformers(tokens, settings.showLineNumbers)) {
    const highlighter = await getHighlighter();
    for (const language of languages) await ensureLang(highlighter, language);
    installMarkdownHighlighter(md, highlighter, settings);
  }
  const result = renderMarkdownTokens(md, tokens, env);
  const document = window.document.createElement("div");
  document.className = CLASSES.doc;
  document.setAttribute(ATTRS.codeTheme, settings.codeTheme);
  document.innerHTML = result.html;
  const diagrams = await renderAllMermaid(document, "default");
  const warnings = result.warnings.map(warning => warning.message);
  if (diagrams.failed) warnings.push(`${diagrams.failed} diagram(s) could not render; their source is shown.`);
  if (!text.trim()) warnings.push("This document is empty. Use Edit & PDF to add Markdown.");
  return { document, warnings };
}

function needsCodeTransformers(tokens: Token[], lineNumbers: boolean): boolean {
  return tokens.some(token => {
    const language = token.info.trim().split(/\s+/, 1)[0]?.toLowerCase().replace(/^language-/, "");
    return (token.type === "fence" && language !== "mermaid"
      && (lineNumbers || token.content.includes("[!code") || /\S\s+\S/.test(token.info.trim())))
      || !!(token.children && needsCodeTransformers(token.children, lineNumbers));
  });
}
