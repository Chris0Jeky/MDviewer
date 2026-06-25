/**
 * Builds the complete stylesheet string handed to Paged.js `preview()`.
 *
 * The result is two parts concatenated:
 *   1. `print.css` (raw-imported) — the STATIC paged-media break rules that never
 *      depend on settings (break-inside:avoid, box-decoration-break:clone, orphans/
 *      widows, thead repeat, headings keep-with-next, katex-display, figures…).
 *   2. A DYNAMIC `@page` block generated from the current Settings — paper size,
 *      margin, optional running header, optional page-number counter, the @footnote
 *      float area, h1/h2 string-set for the running document title, and the
 *      settings-gated TOC `target-counter` and line-number rules.
 *
 * Keeping the dynamic half here (and the static half in print.css) means a settings
 * change only re-generates this string; the break rules are stable and cached.
 */

import type { Settings } from "../app/settings";
import { MARGIN_MM } from "../app/settings";
import { CLASSES } from "../app/dom";
import printBase from "../styles/print.css?raw";

/** Map the paper-size setting to the CSS `@page { size }` keyword. */
function pageSizeKeyword(paperSize: Settings["paperSize"]): string {
  return paperSize === "letter" ? "letter" : "A4";
}

/** Shared running-header/footer typography. */
const MARGIN_BOX_FONT = "font: 9pt/1 system-ui, sans-serif; color: #6b7280;";

/** CSS string-escape a user-provided running-header value for use in `content:`. */
function cssString(value: string): string {
  // Escape backslashes and double-quotes so the header can't break out of the string.
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildStylesheet(settings: Settings): string {
  const size = pageSizeKeyword(settings.paperSize);
  const marginMm = MARGIN_MM[settings.margins];

  const header = settings.runningHeader.trim();
  const hasHeader = header.length > 0;

  // --- Named @page margin boxes ---------------------------------------------
  const topLeft = hasHeader
    ? `  @top-left { content: "${cssString(header)}"; ${MARGIN_BOX_FONT} }\n`
    : "";

  // The right header always shows the running document title (h1/h2 string-set).
  const topRight = `  @top-right { content: string(doctitle); ${MARGIN_BOX_FONT} }\n`;

  const bottomCenter = settings.showPageNumbers
    ? `  @bottom-center { content: counter(page) " / " counter(pages); ${MARGIN_BOX_FONT} }\n`
    : "";

  // Footnote float area lives at the bottom of each page; markdown-it footnotes are
  // transformed into inline `float: footnote` spans by buildSource.ts.
  const footnoteArea =
    "  @footnote {\n" +
    "    float: bottom;\n" +
    "    border-top: 0.5pt solid #d1d5db;\n" +
    "    margin-top: 6pt;\n" +
    "    padding-top: 4pt;\n" +
    "  }\n";

  const pageBlock =
    `@page {\n` +
    `  size: ${size};\n` +
    `  margin: ${marginMm}mm;\n` +
    topLeft +
    topRight +
    bottomCenter +
    footnoteArea +
    `}\n`;

  // No header/footer chrome on the first page (title page convention).
  const firstPageBlock =
    `@page :first {\n` +
    `  @top-left { content: none; }\n` +
    `  @top-right { content: none; }\n` +
    `  @bottom-center { content: none; }\n` +
    `}\n`;

  // Running document title: every h1/h2 sets string(doctitle); @top-right reads it.
  const stringSet = `h1, h2 { string-set: doctitle content(text); }\n`;

  // --- Settings-gated content rules -----------------------------------------
  // TOC page numbers via Paged.js target-counter. Only emitted when the TOC is shown;
  // print.css carries no TOC rule so toggling the TOC off leaves the leader off too.
  const tocRule = settings.showToc
    ? `nav.${CLASSES.toc} a.${CLASSES.tocLink}::after {\n` +
      `  content: leader(". ") target-counter(attr(href url), page);\n` +
      `}\n`
    : `nav.${CLASSES.toc} a.${CLASSES.tocLink}::after { content: none; }\n`;

  // CSS-counter line numbers in code. The Shiki transformer adds `.with-line-numbers`
  // to the <pre>; here we drive the per-line counter so it works in the paged output.
  const lineNumbersRule = settings.showLineNumbers
    ? `.${CLASSES.withLineNumbers} code { counter-reset: shiki-line; }\n` +
      `.${CLASSES.withLineNumbers} code .line::before {\n` +
      `  counter-increment: shiki-line;\n` +
      `  content: counter(shiki-line);\n` +
      `  display: inline-block;\n` +
      `  width: 2.5em;\n` +
      `  margin-right: 1em;\n` +
      `  text-align: right;\n` +
      `  color: #9ca3af;\n` +
      `  -webkit-user-select: none;\n` +
      `  user-select: none;\n` +
      `}\n`
    : "";

  return (
    `${printBase}\n` +
    pageBlock +
    firstPageBlock +
    stringSet +
    tocRule +
    lineNumbersRule
  );
}
