import { ensureMarkdownLanguages, getHighlighter } from "../render/highlight";
import { createMarkdown, renderMarkdown } from "../render/markdown";
import { renderAllMermaid } from "../render/mermaid";
import type { Settings } from "../app/settings";
import { CLASSES, ATTRS } from "../app/dom";

/** Continuous reading keeps natural endnotes and never invokes Paged.js. */
export async function renderReaderDocument(text: string, settings: Settings): Promise<{
  document: HTMLElement;
  warnings: string[];
}> {
  const highlighter = await getHighlighter();
  await ensureMarkdownLanguages(highlighter, text);
  const result = renderMarkdown(createMarkdown(highlighter, settings), text);
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
