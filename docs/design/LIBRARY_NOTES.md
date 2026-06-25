# Library Integration Notes (verified against installed versions)

Copy-pasteable, version-correct integration recipes for MDviewer's stack. Verified
against: `markdown-it@14.2.0`, `shiki@4.3.0` (+ `@shikijs/*@4.3.0`),
`@vscode/markdown-it-katex@1.1.2`, `katex@0.17.0`, `mermaid@11.16.0`, `pagedjs@0.4.3`,
`jspdf@4.2.1`, `html2canvas-pro@1.6.7`. Read alongside
[`IMPLEMENTATION_SPEC.md`](./IMPLEMENTATION_SPEC.md).

## TypeScript constraints (the build is strict)

`strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`,
`isolatedModules`, `noEmit` (Vite bundles). Therefore:
- Use `import type { X } from "..."` for type-only imports (verbatimModuleSyntax).
- Array/record indexing yields `T | undefined` — guard it.
- Prefix intentionally-unused params with `_`.
- Import without file extensions; ESM only; no CommonJS `require`.
- Avoid `any` (ESLint warns). Prefer `unknown` + narrowing.
- `import css from "./x.css?raw"` is typed `string` via `vite/client`.

## 1. markdown-it stack (`src/render/markdown.ts`, `math.ts`)

Plugin order matters: `attrs` and `anchor` BEFORE `toc-done-right`; share one `slugify`
so TOC links match heading ids exactly.

```ts
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import anchor from "markdown-it-anchor";
import tocDoneRight from "markdown-it-toc-done-right";
import container from "markdown-it-container";
import attrs from "markdown-it-attrs";
import taskLists from "markdown-it-task-lists";

export const SLUGIFY = (s: string): string =>
  encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, ""));

const CALLOUTS = ["note", "tip", "warning", "danger"] as const;

// In createMarkdown():
const md = new MarkdownIt({ html: true, linkify: true, typographer: true, langPrefix: "language-" });
md.use(attrs, { leftDelimiter: "{", rightDelimiter: "}" })
  .use(anchor, { slugify: SLUGIFY, permalink: anchor.permalink.headerLink({ safariReaderFix: true }), level: [1, 2, 3, 4] })
  .use(tocDoneRight, { slugify: SLUGIFY, level: [1, 2, 3], listType: "ul", containerClass: "toc" })
  .use(footnote)
  .use(taskLists, { enabled: true, label: true });
for (const name of CALLOUTS) {
  md.use(container, name, {
    render(tokens, idx) {
      const t = tokens[idx];
      if (t && t.nesting === 1) {
        const info = t.info.trim().slice(name.length).trim();
        const title = info || name[0]!.toUpperCase() + name.slice(1);
        return `<div class="callout callout-${name}"><p class="callout-title">${md.utils.escapeHtml(title)}</p>\n`;
      }
      return "</div>\n";
    },
  });
}
```

Notes: `html:true` is required (KaTeX/Mermaid raw HTML). TOC: `[[toc]]` in source expands to
`<ul class="toc">`; it has NO page numbers — those come from Paged.js `target-counter` later.
markdown-it-footnote emits an end-of-document `<section class="footnotes">`; `buildSource.ts`
transforms that into inline `float:footnote` spans so notes sit at the page bottom.

## 2. KaTeX (`src/render/math.ts`)

```ts
import mk from "@vscode/markdown-it-katex";
import katex from "katex";
import "katex/dist/katex.min.css"; // MANDATORY — bundles the KaTeX fonts via Vite

// In createMarkdown(): use OUR pinned katex instance.
md.use((mk as unknown as { default?: typeof mk }).default ?? mk, {
  katex,
  throwOnError: false, // bad TeX renders red inline instead of aborting the whole doc
  errorColor: "#cc0000",
  strict: "ignore",
  output: "html",
  trust: false,
  macros: { "\\R": "\\mathbb{R}", "\\eps": "\\varepsilon" },
});
```

Synchronous (renders during `md.render`). Block math → `<span class="katex-display">`.
Height depends on fonts → `await document.fonts.ready` before pagination.

## 3. Shiki 4.x (`src/render/highlight.ts`, `markdown.ts`)

Fine-grained bundle: dynamic-import only the langs/themes you ship so Vite code-splits them.
Highlighter is async — `await getHighlighter()` ONCE before `md.render`.

```ts
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

let _hl: HighlighterCore | null = null;
export function getHighlighter(): Promise<HighlighterCore> {
  return (_hl ? Promise.resolve(_hl) : create());
}
async function create(): Promise<HighlighterCore> {
  _hl = await createHighlighterCore({
    themes: [
      import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark"),
      import("@shikijs/themes/light-plus"), import("@shikijs/themes/dark-plus"),
      import("@shikijs/themes/nord"),
      import("@shikijs/themes/min-light"), import("@shikijs/themes/min-dark"),
      import("@shikijs/themes/one-light"), import("@shikijs/themes/one-dark-pro"),
      import("@shikijs/themes/catppuccin-latte"), import("@shikijs/themes/catppuccin-mocha"),
    ],
    langs: [
      import("@shikijs/langs/typescript"), import("@shikijs/langs/javascript"),
      import("@shikijs/langs/python"), import("@shikijs/langs/bash"),
      import("@shikijs/langs/json"), import("@shikijs/langs/markdown"),
      import("@shikijs/langs/html"), import("@shikijs/langs/css"),
      import("@shikijs/langs/rust"), import("@shikijs/langs/go"),
      import("@shikijs/langs/java"), import("@shikijs/langs/c"),
      import("@shikijs/langs/cpp"), import("@shikijs/langs/sql"),
      import("@shikijs/langs/yaml"), import("@shikijs/langs/diff"),
    ],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
  return _hl;
}
export async function ensureLang(hl: HighlighterCore, lang: string): Promise<void> {
  if (hl.getLoadedLanguages().includes(lang)) return;
  const langs = await import("@shikijs/langs");
  const loader = (langs as Record<string, unknown>)[lang];
  if (loader) await hl.loadLanguage(await (loader as () => Promise<never>)());
}

export const CODE_THEME_PAIRS = {
  github: { light: "github-light", dark: "github-dark" },
  vscode: { light: "light-plus", dark: "dark-plus" },
  nord: { light: "nord", dark: "nord" },
  min: { light: "min-light", dark: "min-dark" },
  one: { light: "one-light", dark: "one-dark-pro" },
  catppuccin: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
} as const;
```

Wire into markdown-it with the bring-your-own-highlighter entry (so render() is sync):

```ts
import { fromHighlighter } from "@shikijs/markdown-it/core";
import { transformerNotationHighlight, transformerNotationDiff, transformerMetaHighlight } from "@shikijs/transformers";
import type { ShikiTransformer } from "shiki";

const pair = CODE_THEME_PAIRS[settings.codeTheme];
md.use(fromHighlighter(hl, {
  themes: { light: pair.light, dark: pair.dark },
  defaultColor: "light", // inline light color → vector PDF correct with zero extra CSS
  cssVariablePrefix: "--shiki-",
  transformers: [
    transformerNotationHighlight(), transformerNotationDiff(), transformerMetaHighlight(),
    ...(settings.showLineNumbers ? [lineNumbers()] : []),
  ],
}));
function lineNumbers(): ShikiTransformer {
  return { name: "line-numbers", pre(node) { this.addClassToHast(node, "with-line-numbers"); } };
}
```

Unknown language → fall back to `lang:"text"` (no throw). Dual theme: light inline + `--shiki-dark`
var; `@media print` forces light (see `src/styles/shiki.css`).

## 4. Mermaid (`src/render/mermaid.ts`)

Async; must finish BEFORE pagination. Fixed-size SVG (`useMaxWidth:false`) so Paged.js measures right.

```ts
import { CLASSES } from "../app/dom";
export type MermaidTheme = "default" | "dark" | "neutral" | "forest" | "base";
let initialized = false;
export async function renderAllMermaid(root: ParentNode, theme: MermaidTheme = "default") {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid, code.language-mermaid, .mermaid"));
  if (blocks.length === 0) return { rendered: 0, failed: 0 };
  const mermaid = (await import("mermaid")).default;
  if (!initialized) { mermaid.initialize({ startOnLoad: false, theme, securityLevel: "strict", flowchart: { useMaxWidth: false } }); initialized = true; }
  let rendered = 0, failed = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const host = block.tagName === "CODE" ? (block.closest("pre") ?? block) : block;
    const code = block.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mmd-${i}`, code);
      const figure = document.createElement("figure");
      figure.className = CLASSES.mermaidFigure;
      figure.innerHTML = svg;
      host.replaceWith(figure);
      rendered++;
    } catch (err) {
      const fig = document.createElement("figure");
      fig.className = CLASSES.mermaidFigure;
      fig.innerHTML = `<div class="diagram-error">⚠ Diagram failed to render</div><pre><code>${code.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</code></pre>`;
      host.replaceWith(fig);
      failed++;
    }
  }
  return { rendered, failed };
}
```

## 5. Paged.js (`src/paginate/*`)

No types (we ship `pagedjs.d.ts`). Register handlers ONCE; fresh `Previewer` per run; tear down
prior `.pagedjs_pages` AND `style[data-pagedjs-inserted-styles]` before re-running.

```ts
import { Previewer, Handler, registerHandlers, type PagedFlow } from "pagedjs";
import { PAGEDJS } from "../app/dom";

export function teardownPagination(host: HTMLElement): void {
  host.querySelectorAll(`.${PAGEDJS.pagesClass}`).forEach((n) => n.remove());
  document.querySelectorAll(PAGEDJS.insertedStylesSelector).forEach((s) => s.remove());
  host.replaceChildren();
}
export async function paginate(source: DocumentFragment, css: string, host: HTMLElement): Promise<PagedFlow> {
  teardownPagination(host);
  const blobUrl = URL.createObjectURL(new Blob([css], { type: "text/css" }));
  try {
    const previewer = new Previewer();
    return await previewer.preview(source, [blobUrl], host);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
```

Handler (register once via `registerHandlersOnce`):

```ts
class MDViewerHandler extends Handler {
  afterParsed(parsed: ParentNode) { shrinkToFit(parsed, getArea()); }
  afterRendered() { fillTocPageNumbers(host); }
}
registerHandlers(MDViewerHandler); // once at module init
```

`measurePageArea` (px at 96dpi): `MM = 96/25.4`, `IN = 96`; A4 = 210×297mm, Letter = 8.5×11in;
printable = size − margins. `SHRINK_LIMIT = 1.15`.

### @page CSS (generated by `buildStylesheet(settings)`, passed to `preview()`)

```css
@page {
  size: A4;               /* or: letter — from settings.paperSize */
  margin: 20mm;           /* from MARGIN_MM[settings.margins] */
  @top-left  { content: "Running header"; font: 9pt/1 system-ui; color: #6b7280; }  /* settings.runningHeader; omit if '' */
  @top-right { content: string(doctitle); font: 9pt/1 system-ui; color: #6b7280; }
  @bottom-center { content: counter(page) " / " counter(pages); font: 9pt/1 system-ui; color: #6b7280; } /* omit if !showPageNumbers */
  @footnote { border-top: .5pt solid #d1d5db; margin-top: 6pt; padding-top: 4pt; float: bottom; }
}
@page :first { @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }
h1, h2 { string-set: doctitle content(text); }
```

### Break rules (static — `src/styles/print.css`, also `?raw`-imported into cssBuilder)

```css
* { box-decoration-break: clone; -webkit-box-decoration-break: clone; }
pre, .shiki, figure.code-figure, figure, img, svg, table, .callout, .katex-display, figure.mermaid-figure, blockquote {
  break-inside: avoid; page-break-inside: avoid;
}
pre, .shiki { orphans: 3; widows: 3; }
pre code { display: block; white-space: pre-wrap; word-break: break-word; }
thead { display: table-header-group; } tfoot { display: table-footer-group; }
tr, td, th, li { break-inside: avoid; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; break-inside: avoid; orphans: 3; widows: 3; }
p { orphans: 3; widows: 3; }
nav.toc a.toc-link::after { content: leader(". ") target-counter(attr(href url), page); }
```

### Shrink-to-fit (Tier 3, in `afterParsed`, off-DOM measure)

```ts
export function shrinkToFit(content: ParentNode, area: PageArea): void {
  content.querySelectorAll<HTMLElement>("pre, .mermaid-figure, figure.code-figure").forEach((el) => {
    const probe = el.cloneNode(true) as HTMLElement;
    Object.assign(probe.style, { position: "absolute", visibility: "hidden", left: "-9999px", width: `${el.clientWidth}px` });
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    if (h > area.heightPx && h <= area.heightPx * SHRINK_LIMIT) {
      const s = (area.heightPx - 2) / h;
      el.style.transformOrigin = "top left";
      el.style.transform = `scale(${s})`;
      el.style.height = `${h * s}px`;
      el.style.width = `${100 / s}%`;
      el.dataset.shrunk = s.toFixed(3);
    }
  });
}
```

## 6. Export (`src/export/*`)

Primary — print (vector):

```ts
export async function exportViaPrint(_host: HTMLElement): Promise<void> {
  // @media print hides chrome and prints only .pagedjs_page at true size.
  window.print();
}
```

Fallback — programmatic, one canvas per already-paginated page (breaks preserved):

```ts
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";
import { PAGEDJS } from "../app/dom";

export async function exportPaginatedToPdf(host: HTMLElement, settings: Settings, opts: FallbackPdfOptions = {}): Promise<void> {
  const [w, h] = settings.paperSize === "a4" ? [210, 297] : [215.9, 279.4]; // mm
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: settings.paperSize });
  const pages = Array.from(host.querySelectorAll<HTMLElement>(`.${PAGEDJS.pageClass}`));
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i]!, { scale: opts.scale ?? 2, backgroundColor: "#ffffff", useCORS: true });
    if (i > 0) pdf.addPage(settings.paperSize, "portrait");
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h, undefined, "FAST");
  }
  pdf.save(opts.fileName ?? "document.pdf");
}
```

Both are dynamic-imported on user action. The exported PDF is always dark-on-white.
