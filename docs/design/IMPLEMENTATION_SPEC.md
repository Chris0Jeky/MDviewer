# MDviewer — Implementation Spec (canonical)

> The single source of truth for how MDviewer is built. Pinned module signatures,
> CSS/DOM names, the load-bearing render order, and the no-slice strategy live here.
> If code and this doc disagree, fix one of them in the same change — do not let them drift.
> Companion docs: [`docs/PRODUCT_VISION.md`](../PRODUCT_VISION.md),
> [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), [`autodoc/AGENT_INDEX.md`](../../autodoc/AGENT_INDEX.md).

## 1. What MDviewer is

A **browser-based, drag-and-drop Markdown → PDF tool** whose #1 job is to export
beautiful PDFs where **no code block, figure, table, or callout is ever sliced
across a page boundary** — the failure of typical online md-to-pdf converters.
Optimized for **research papers and code-heavy technical docs**. 100% client-side,
local-first (no runtime network calls, nothing uploaded). Vanilla TypeScript + Vite.

Documents arrive by drop, paste, or file picker, **or are written directly in the app**:
the workspace pairs a Markdown source editor with the paginated preview, and every edit
re-runs the same pipeline that produces the PDF. See §12.

## 2. Resolved dependency versions (verified installed)

Read back from `npm ls --depth=0` on 2026-08-08, after the dependency sweep that cleared the
Dependabot backlog and every open advisory.

Runtime: `markdown-it@14.3.0` · `markdown-it-footnote@4.0.0` · `markdown-it-anchor@9.2.1`
· `markdown-it-toc-done-right@4.2.0` · `markdown-it-container@4.0.0` · `markdown-it-attrs@5.0.1`
· `markdown-it-task-lists@2.1.1` · `shiki@4.3.1` (+ `@shikijs/core`, `@shikijs/langs`,
`@shikijs/themes`, `@shikijs/markdown-it`, `@shikijs/transformers` all `4.3.1`)
· `@vscode/markdown-it-katex@1.1.2` · `katex@0.18.1` · `mermaid@11.16.1` · `pagedjs@0.4.3`
· `jspdf@4.2.1` · `html2canvas-pro@1.6.7` · `dompurify@3.4.13`.

Toolchain: `vite@8.1.5` · `vitest@4.1.10` · `typescript@6.0.3` · `eslint@10.8.0` +
`typescript-eslint@8.65.0` · `jsdom@29.1.1` · `@playwright/test@1.62.0` · `@types/node@26.1.1`.

Notes that bite if ignored:
- **Shiki is 4.x** (bumped from 3.x; the fine-grained API is unchanged across the major).
  The fine-grained API (`shiki/core` `createHighlighterCore`,
  `shiki/engine/oniguruma` `createOnigurumaEngine`, `import('shiki/wasm')`,
  `@shikijs/langs/<lang>`, `@shikijs/themes/<theme>`, `@shikijs/markdown-it/core`
  `fromHighlighter`) — use it. All `@shikijs/*` siblings are version-pinned in lockstep,
  so bump them together.
- **`@types/markdown-it-footnote@3.0.4`** intentionally pairs with runtime `4.0.0`
  (type surface unchanged). Do not "fix" the mismatch.
- **`markdown-it-task-lists`** ships no `@types` → local shim in `src/types/`.
- **`pagedjs`** ships no types and no `module` field → local ambient `pagedjs.d.ts`;
  Vite resolves its `browser`/`import` export condition automatically.
- **jspdf is 4.2.1** — use `addImage`/`addPage`/`save` (we never use `.html()`); this API
  is unchanged from the prior 2.x, and the bump pulled in upstream security fixes.

## 3. The load-bearing render order (NEVER reorder)

Pagination measures real laid-out heights. Every earlier step changes those heights,
so pagination MUST run last, exactly once, after all async content settles.

```
0  read raw markdown string (drag-drop / paste / file picker)
1  await getHighlighter()            // singleton: createHighlighterCore + Oniguruma WASM
1b await ensureMarkdownLanguages(hl, src)     // curated fenced grammars load before sync render
2  createMarkdown(hl, settings).render(src)   // SYNC: Shiki (fromHighlighter) + KaTeX inline
3  buildPaginationSource(html, settings)      // inject TOC nav; transform end-of-doc footnotes -> inline float spans
4  await renderAllMermaid(source, 'default')  // async fixed SVG; light for preview + print
4b stampAtomicBlocks(source)                  // stable identities copied into Paged.js fragments
5  await awaitFontsAndImages(source)          // document.fonts.ready + img.decode -> heights final
6  retain the fully prepared source           // a later render rebuilds a fresh fragment
7  registerHandlersOnce(); await paginate(source, css, #paged-output)   // PAGINATION LAST
       // inside: afterParsed -> shrinkToFit ; afterRendered -> fillTocPageNumbers
```

Re-paginate triggers (full re-flow, debounced 120ms): paper size, margins, font,
font size, TOC toggle, page-numbers toggle, running header, line-numbers toggle.
CSS-only (no re-paginate): screen theme, same-family code light/dark flip.
Content change debounce: 250ms.

## 4. The no-slice strategy (the product)

Single pagination engine: **Paged.js 0.4.3**. The same paginated DOM feeds both export paths.

Atomic blocks get `break-inside: avoid` (+ legacy `page-break-inside: avoid`):
`pre, .shiki, figure.code-figure, figure, img, svg, table, tr, td, th, .callout,
.callout-*, .katex-display, figure.mermaid-figure, blockquote, li`. Headings get
`break-after: avoid` (keep-with-next). Paragraphs/pre get `orphans: 3; widows: 3`.
`thead { display: table-header-group }` repeats headers if a table must split.
`box-decoration-break: clone` keeps a forced-split block's frame continuous.
`pre code { white-space: pre-wrap }` prevents horizontal clipping.

**Tiered handling for blocks taller than one page** (where `break-inside:avoid` is
physically impossible and Paged.js will split):
- **T1 keep-whole** — default; ~95% of blocks.
- **T2 graceful split** — `orphans/widows:3` + `box-decoration-break:clone` + repeated `thead`.
- **T3 shrink-to-fit** — in `afterParsed` (pre-layout), if a self-contained block
  (`pre`, `.mermaid`, `figure`) is ≤ `SHRINK_LIMIT` (1.15) too tall, `transform:scale`
  it to fit one page; reserve the scaled height. Never shrink reflowing tables.
- **T4 clean forced split** — last resort; the above make even a multi-page listing read cleanly.

This is verified by `tests/e2e/nocutoff.spec.ts`: no atomic block's rect may straddle a
`.pagedjs_page` boundary (and no table cell may escape its page's content box horizontally —
`.doc th, .doc td` carry `overflow-wrap: anywhere; word-break: break-word` so unbreakable
tokens wrap instead of clipping at the paper edge).

**Invariant — CSS that Paged.js itself must interpret lives in `buildStylesheet()`.**
Paged.js only walks the stylesheets passed to `previewer.preview()`; `paginate()` passes
exactly one — the blob built by `cssBuilder.buildStylesheet()`. Declarations Paged.js has to
*parse* (`float: footnote`, `footnote-display`, `string-set`, `target-counter`, `leader()`,
`@footnote`, `@page`) are invisible to it — and inert in the browser — if they sit in a
globally imported file such as `document.css`. Corollary: Paged.js relocates footnote spans
out of `.doc` into `.pagedjs_footnote_area` (a sibling of the page content), where `.doc`-scoped
rules and `--doc-*` tokens no longer apply, so the footnote area's typography is restated in
`buildStylesheet()` (sharing `DOC_FONT_STACKS` from `src/app/settings.ts`).

**TOC placement rule:** an author-placed `[[toc]]` stays exactly where the author put it; a
synthesized TOC (when `showToc` is on and no marker exists) is inserted immediately after the
first `h1`, or at the top of the document when there is no `h1`.

## 5. Two export paths over one paginated DOM

- **PRIMARY — `exportViaPrint()`**: `window.print()` with `@media print` + `@page` CSS.
  Vector, selectable text, best quality. `@media print` hides chrome, prints only `.pagedjs_page`.
- **FALLBACK — `exportPaginatedToPdf()`**: iterate `.pagedjs_page` nodes, `html2canvas-pro`
  each (scale ~1.5–2, white bg) → `jsPDF` `addImage`/`addPage`; one canvas == one already-broken
  page, so page-break safety is inherited. Rasterized (non-selectable), best-effort.

Both are dynamic-imported on user action (keeps the initial bundle light). The exported PDF
**and the on-screen page sheets** are always dark-on-white regardless of screen theme: rendered
code (`.shiki`) has no screen dark variant at all — the preview is WYSIWYG with the export, and
the raster path cannot leak a dark theme by construction. The only surviving `--shiki-dark`
swap is the source editor's backdrop (`#editor-highlight` in `editor.css`), which is chrome,
not paper; its scope must not widen. `@media print` force-light rules remain as belt-and-braces.
The running header uses `string(doctitle, start)` (not the default `first` variant) so content
pushed onto a page that also starts a new heading keeps its own section's title. In the
toolbar, `.toolbar-spacer` is a semantic divide: document settings sit left of it, the
screen-theme ("Screen") group and Export sit right of it.

Fallback-path constraints learned in production: `html2canvas` is called with
`logging: false` (its default floods the console with per-page clone timings and truncated
data-URI dumps), and it **hangs on a pseudo-element attached to an `<input>`** — affordances
on form controls (e.g. the task-list checkbox tick) must be drawn with embedded `data:`
background images, never `::before`/`::after`. `exportPaginatedToPdf` accepts
`onProgress?(done, total)` and the App exposes an export busy state so the toolbar can
disable both export buttons and announce progress while the raster loop runs.

## 6. File tree (src + tests)

```
src/
  main.ts                       Vite entry; App.init(#app); wire global drag/drop/paste; import CSS
  app/
    App.ts                      controller; owns DocStore + Settings; runPipeline (render order); pane swap
    state.ts                    DocStore (openDocs/activeId, events) + createRenderScheduler (debounce + serialize)
    settings.ts                 Settings type, DEFAULT_SETTINGS, load/save/migrate (localStorage)
    dom.ts                      canonical DOM ID + class-name constants (single source) + el() helper
    input.ts                    openMarkdown(); drag/drop/paste/picker; ext+MIME validation; size guards
    sampleDoc.ts                bundled demo markdown (code+KaTeX+Mermaid+callouts+footnotes+tall code block)
  ui/
    Toolbar.ts                  toolbar groups A–F, bind controls -> Settings, export buttons
    Editor.ts                   Markdown source pane: textarea + Shiki syntax backdrop (§12)
    Splitter.ts                 draggable/keyboard role="separator" between source and preview (§12)
    Canvas.ts                   preview pane: #paged-output host, page chip, zoom, paginating overlay, aria
    EmptyState.ts               full-window dropzone card (recovery state too)
    Banner.ts                   aggregated warning banner + fatal error card (aria-live)
  render/
    markdown.ts                 createMarkdown(hl,settings); renderMarkdown(); SLUGIFY; RenderWarning
    sanitize.ts                 DOMPurify boundary + local-first resource policy
    highlight.ts                getHighlighter() singleton; ensureLang(); CODE_THEME_PAIRS
    math.ts                     KaTeX plugin wiring (macros, throwOnError:false)
    mermaid.ts                  renderAllMermaid(root,theme) -> fixed-size SVG figures
    buildSource.ts              buildPaginationSource(); transformFootnotesToInline(); injectToc(); awaitFontsAndImages()
  paginate/
    cssBuilder.ts               buildStylesheet(settings) -> full @page + break-rule + print CSS string
    measure.ts                  measurePageArea(settings); MM, IN, SHRINK_LIMIT
    handler.ts                  MDViewerHandler (afterParsed/afterPageLayout/afterRendered); registerHandlersOnce; fillTocPageNumbers
    shrinkToFit.ts              Tier-3 shrink-to-fit heuristic (off-DOM measure, transform:scale)
    paginate.ts                 paginate(source,css,host); teardownPagination(); fresh Previewer per run
    pagedjs.d.ts                ambient module declaration for 'pagedjs'
  export/
    print.ts                    exportViaPrint()
    download.ts                 exportPaginatedToPdf(host,settings,opts)
  types/
    markdown-it-task-lists.d.ts ambient shim (no @types)
  styles/
    app.css                     grid shell, toolbar, canvas backdrop, data-app-theme tokens, focus, reduced-motion
    editor.css                  screen-only split workspace: view modes, source pane, overlay metrics, divider
    preview.css                 screen-only .pagedjs_page sheets, drag overlay, paginating spinner, empty state
    document.css                rendered-doc typography, callouts, toc, footnotes, task-list, anchors, katex-display
    print.css                   static @page base + no-slice break rules (settings-independent parts)
    shiki.css                   screen-dark + print-light force + line-number counters + .line.highlighted
index.html                      host page; #app, hidden #file-input, theme bootstrap
tests/
  settings.test.ts  markdown.test.ts  highlight.test.ts  math.test.ts  mermaid.test.ts
  cssBuilder.test.ts  measure.test.ts  buildSource.test.ts  input.test.ts  state.test.ts
  export-download.test.ts  dom-contract.test.ts  editor.test.ts  splitter.test.ts
  e2e/nocutoff.spec.ts  e2e/golden-path.spec.ts  e2e/export.spec.ts  e2e/empty-error.spec.ts
  e2e/editor.spec.ts
  fixtures/nocutoff.md  fixtures/sample.md
  helpers/pagedDom.ts
```

## 7. Module API (pinned signatures — code and tests must match)

```typescript
// src/app/settings.ts
export type ScreenTheme = 'light' | 'dark' | 'sepia';
export type PaperSize = 'a4' | 'letter';
export type MarginPreset = 'narrow' | 'normal' | 'wide';      // 12.7mm | 20mm | 30mm
export type DocFont = 'serif' | 'sans' | 'slab';
export type FontSizePt = 10 | 11 | 12 | 13;
export type CodeThemeId = 'github' | 'vscode' | 'nord' | 'min' | 'one' | 'catppuccin';
export interface Settings {
  schemaVersion: 1;
  screenTheme: ScreenTheme; codeTheme: CodeThemeId; docFont: DocFont; fontSizePt: FontSizePt;
  paperSize: PaperSize; margins: MarginPreset;
  showToc: boolean; showPageNumbers: boolean; runningHeader: string; showLineNumbers: boolean;
  titlePage: boolean;   // default true: blank the @page :first margin boxes (title-page convention).
                        // Validated in migrateSettings (boolean check, not spread); a REFLOW_KEYS member.
                        // counter(page) counts page 1 either way — only its margin boxes are blanked.
  zoom: 'fit' | 1 | 0.5;
}
export const DEFAULT_SETTINGS: Settings;
export function loadSettings(): Settings;
export function saveSettings(s: Settings): void;
export function migrateSettings(raw: unknown): Settings;

// src/app/state.ts
export interface Doc { id: string; name: string; text: string; }
export type RenderReason = 'content' | 'settings';
export class DocStore {
  openDocs: Doc[]; activeId: string | null;
  get active(): Doc | null;
  add(name: string, text: string): Doc;          // returns new doc, sets active
  setActive(id: string): void;
  remove(id: string): void;
  on(ev: 'change', cb: () => void): () => void;   // returns unsubscribe
}
export interface RenderScheduler {
  schedule(reason: RenderReason): void;   // debounced: content 250 ms, settings 120 ms
  flush(): Promise<void>;                 // run any pending render NOW; resolve when it settles
  readonly isPending: boolean;
}
// Debounced AND serialized: runs are chained so two `run` calls never overlap, because
// pagination tears down and rewrites one shared host through Paged.js's global handler and
// page counter. A queued run superseded by a newer request is dropped rather than executed.
export function createRenderScheduler(run: (r: RenderReason) => Promise<void>): RenderScheduler;

// src/app/input.ts
export const MD_EXTENSIONS: readonly string[];    // ['.md','.markdown']
export const SIZE_SOFT_BYTES: number;             // ~2_000_000
export const SIZE_HARD_BYTES: number;             // ~25_000_000
export interface OpenResult { opened: Doc[]; skipped: string[]; }
export function isMarkdownFile(name: string, mime: string): boolean;
export function classifyFiles(files: File[]): { accept: File[]; reject: string[] };
export async function openMarkdown(text: string, filename: string): Promise<Doc>;
export function installInputHandlers(store: DocStore, opts: {
  onReject(names: string[]): void; onLargeFile(bytes: number): Promise<boolean>;
}): () => void;

// src/render/highlight.ts
import type { HighlighterCore } from 'shiki/core';
export interface CodeThemePair { light: string; dark: string; }
export const CODE_THEME_PAIRS: Record<CodeThemeId, CodeThemePair>;
export function getHighlighter(): Promise<HighlighterCore>;
export function ensureLang(hl: HighlighterCore, lang: string): Promise<void>;
export function findFenceLanguages(src: string): string[];
export function isSupportedLanguage(lang: string): boolean;
export function ensureMarkdownLanguages(hl: HighlighterCore, src: string): Promise<void>;

// src/render/markdown.ts
import type MarkdownIt from 'markdown-it';
// 'content' = document-level notices that are not render failures (e.g. "document is empty")
export interface RenderWarning { kind: 'math' | 'diagram' | 'lang' | 'security' | 'content'; message: string; }
export function createMarkdown(hl: HighlighterCore, settings: Settings): MarkdownIt;
export function renderMarkdown(md: MarkdownIt, src: string): { html: string; warnings: RenderWarning[] };
export const SLUGIFY: (s: string) => string;

// src/render/sanitize.ts
export interface SanitizedHtml { html: string; removedCount: number; }
export function sanitizeRenderedHtml(html: string): SanitizedHtml;
export function sanitizeMermaidSvg(svg: string): SanitizedHtml;

// src/render/mermaid.ts
export type MermaidTheme = 'default' | 'dark' | 'neutral' | 'forest' | 'base';
export function renderAllMermaid(root: ParentNode, theme?: MermaidTheme): Promise<{ rendered: number; failed: number }>;

// src/render/buildSource.ts
export function buildPaginationSource(html: string, settings: Settings): DocumentFragment;
export const ATOMIC_BLOCK_SELECTOR: string;
export function stampAtomicBlocks(root: ParentNode): number;
export function transformFootnotesToInline(root: ParentNode): void;
export function injectToc(root: ParentNode, settings: Settings): void;
export async function awaitFontsAndImages(root: ParentNode): Promise<void>;

// src/paginate/cssBuilder.ts
export function buildStylesheet(settings: Settings): string;

// src/paginate/measure.ts
export const MM: number; export const IN: number; export const SHRINK_LIMIT: number; // 1.15
export interface PageArea { widthPx: number; heightPx: number; }
export function measurePageArea(settings: Settings): PageArea;

// src/paginate/shrinkToFit.ts
export function shrinkToFit(content: ParentNode, area: PageArea): void;

// src/paginate/handler.ts
export function registerHandlersOnce(area: () => PageArea): Promise<void>;   // idempotent
export function fillTocPageNumbers(host: HTMLElement): void;
export function setPaginationProgress(sink: ((page: number) => void) | null): void; // per-page overlay label; set around paginate(), cleared in finally

// src/paginate/paginate.ts
import type { PagedFlow } from 'pagedjs';
export function teardownPagination(host: HTMLElement): void;
export async function paginate(source: DocumentFragment, css: string, host: HTMLElement): Promise<PagedFlow>;

// src/export/print.ts
export async function exportViaPrint(host: HTMLElement): Promise<void>;
// src/export/download.ts
export interface FallbackPdfOptions { scale?: number; fileName?: string; onProgress?(done: number, total: number): void; }
// html2canvas is always called with logging: false (its default floods the console per page)
export async function exportPaginatedToPdf(host: HTMLElement, settings: Settings, opts?: FallbackPdfOptions): Promise<void>;

// src/ui/*
export function mountToolbar(root: HTMLElement, app: App): { destroy(): void };
export interface CanvasPosition { /* topmost visible page + fractional offset */ }
export interface CanvasOptions { onZoom(zoom: Settings['zoom']): void; }
export interface CanvasController {
  host: HTMLElement;
  setPaginating(b: boolean): void; setProgress(page: number | null): void;
  setBusy(busy: boolean, label?: string): void;                 // export overlay (.is-exporting)
  setPageCount(n: number): void; setZoom(z: Settings['zoom']): void;
  capturePosition(): CanvasPosition | null; restorePosition(p: CanvasPosition | null): void;
  destroy(): void;
}
export function mountCanvas(root: HTMLElement, options: CanvasOptions): CanvasController;
// zoom is paint-only: a transform driven by --preview-zoom, never the `zoom` property and
// never a reflow key — layout geometry must stay identical to what the export inherits.
// 'fit' = fit-to-width, capped at 1, recomputed via ResizeObserver.
export function mountEmptyState(root: HTMLElement, onChoose: () => void, onSample: () => void): { destroy(): void };
export function mountBanner(root: HTMLElement): { warn(w: RenderWarning[]): void; fatal(msg: string): void; clear(): void };

// src/app/App.ts
export interface ExportState { busy: boolean; hasDocument: boolean; } // toolbar gates both export buttons on this
export function withEmptyDocWarning(warnings: RenderWarning[], src: string): RenderWarning[];
export class App {
  settings: Settings; store: DocStore;
  static init(root: HTMLElement): App;              // also registers the beforeunload guard
  scheduleRender(reason: RenderReason): void;
  flushRender(): Promise<void>;                     // settle the preview; awaited by both exports
  updateSettings(patch: Partial<Settings>): void;   // persists + scheduleRender('settings')
  onSettingsChange(listener: (settings: Readonly<Settings>) => void): () => void;
  onExportStateChange(listener: (state: ExportState) => void): () => void;
  get exportState(): ExportState;
}
// src/app/state.ts (addition)
export function hasProtectableWork(docs: readonly Doc[], pristineSample: string): boolean;
// beforeunload prompts only when some open doc has content differing from the pristine sample
// src/render/math.ts (additions)
export const KATEX_ERROR_COLOR: string;             // single source for errorColor + detection
export const KATEX_ERROR_HINT: string;
export function tagKatexErrors(html: string): { html: string; count: number }; // normalizes failed math onto .katex-error + title
// src/app/settings.ts (addition)
export const DOC_FONT_STACKS: Record<DocFont, string>; // shared by buildSource AND cssBuilder (footnote area)
```

## 8. DOM IDs and CSS class names (single source: `src/app/dom.ts`)

DOM IDs: `#app #toolbar #workspace #editor-pane #editor-input #editor-highlight
#split-handle #canvas #paged-output #empty-state #drag-overlay #warning-banner
#error-card #page-chip #zoom-control #status-live #file-input`.

Paged.js-owned (never rename): `.pagedjs_pages` `.pagedjs_page`
`style[data-pagedjs-inserted-styles]` `[data-page-number]`.

App-authored: chrome — `.toolbar-group .toolbar-divider .toolbar-spacer .toolbar-field
.toolbar-label .toolbar-select .toolbar-input .doc-switcher .doc-close .seg-control
.seg-option .toggle-btn[aria-pressed] .export-primary .export-secondary .is-paginating
.is-exporting [data-app-theme]`; canvas chrome — `.canvas-controls .canvas-notices
.page-chip-label .paginating-overlay .paginating-spinner .paginating-label
.warning-banner(-icon/-text/-dismiss) .error-card(-icon/-title/-message/-reload)
--preview-zoom`; workspace — `.editor-head .editor-scroll .editor-line
[data-view-mode] [data-highlight] --split-ratio`; doc root — `.doc` (carries `--doc-font-family`/`--doc-font-size`,
`data-code-theme`); code — `.shiki .shiki .line .line.highlighted .with-line-numbers
figure.code-figure`; callouts — `.callout .callout-note .callout-tip .callout-warning
.callout-danger .callout-title`; toc — `nav.toc .toc ol a.toc-link .toc-text a.xref`
(`.toc-text` wraps the entry title inside the link — required by the leader-dot fallback);
footnotes — `.footnote .footnotes .footnote-item .footnote-backref`; misc — `.task-list-item
.header-anchor .katex .katex-display .katex-error figure.mermaid-figure .mermaid
[data-shrunk] .landscape`.

Every app-authored class name is listed in `CLASSES` in `src/app/dom.ts`, and
`tests/dom-contract.test.ts` requires each to appear in some stylesheet — a TS-authored class
with no CSS rule (the root cause of several shipped invisible-UI bugs) now fails CI.

## 9. Settings persistence

Only `Settings` persists (localStorage key `mdviewer.settings.v1`). **Document bytes are
never persisted** (privacy + size) — text typed into the editor is no exception: it lives in
the in-memory `DocStore` and is gone on reload. `loadSettings()` merges parsed over
`DEFAULT_SETTINGS` inside try/catch (tolerates corrupt JSON and private-mode throwing
storage).

`viewMode` and `splitRatio` are the two layout fields. Unlike the rest of the merge they are
**validated, not merely spread**: they drive CSS geometry directly, so a corrupt persisted
value would strand a pane with no way back. `migrateSettings` falls back to the default view
mode for an unrecognised string and runs the ratio through `clampSplitRatio`
(`SPLIT_RATIO_MIN` 0.2 … `SPLIT_RATIO_MAX` 0.8; a non-number returns the default rather than
coercing, because `Number(null) === 0` would silently collapse the pane).

## 10. Testing strategy

- **Unit (Vitest + jsdom)**: pure functions and DOM-structure assertions — settings round-trip,
  markdown plugin output (callout classes, footnote section, toc anchors == anchor slugs),
  highlighter singleton + dual-theme inline color, KaTeX `throwOnError:false`, mermaid block →
  figure + failure placeholder, `buildStylesheet` per setting, `measurePageArea` math,
  footnote-inline transform, input validation, fallback PDF page-count, DOM-contract drift guard.
- **E2E (Playwright, real Chromium)**: anything layout-dependent. `nocutoff.spec.ts` is the
  crown-jewel test (no atomic block straddles a page boundary). Plus golden-path, export,
  empty/error, and `editor.spec.ts` (view modes, live typing → pagination, backdrop/textarea
  box alignment, divider drag + keyboard, and the print-media check that keeps the editing
  surface off paper).
- Layout (`getBoundingClientRect`) is meaningless in jsdom → such assertions belong in E2E only.

## 11. Known risks / mitigations

1. **No incremental relayout in Paged.js** → keep a pristine clone (no baked transforms),
   debounce setting changes, show a "Paginating…" state.
2. **`break-inside:avoid` is ignored for blocks taller than a page** (by design) → the T2–T4
   strategy makes the forced split clean.
3. **Async ordering** is the #1 correctness risk → Section 3 is load-bearing; never paginate early.
4. **html2canvas-pro fallback** rasterizes (non-selectable, large, Mermaid `foreignObject` text can
   blank) → keep `window.print()` primary; warn on big docs.
5. **`pagedjs` has no types / unbundled `src` entry** → ambient `pagedjs.d.ts`; if Vite picks the
   `src` ESM entry and chokes, alias to `pagedjs/dist/paged.esm.js` (`dist/paged.js` exists).
6. **Large docs** freeze the main thread during layout → paginate once, lazy-run the fallback,
   surface incremental page count from the Paged.js `page` event.
7. **Live typing re-runs the whole pipeline** → the 250 ms content debounce coalesces bursts,
   and the editor's own syntax pass is capped at `HIGHLIGHT_MAX_CHARS` (§12). A document large
   enough to make pagination slow will make *editing* it feel slow; that is the same
   main-thread budget as risk 6 and is tracked with it.

## 12. The split workspace (source editor + preview)

The window below the toolbar is `#workspace`, a CSS grid of three columns: the Markdown
source pane, a draggable divider, and the preview canvas. `data-view-mode` on `#workspace`
selects which columns are shown — `editor`, `split` (default), or `preview` — and
`--split-ratio` carries the source pane's share of the width.

**All three panes are always mounted.** Switching view mode is a pure attribute write: no
pane is torn down, nothing re-renders, no pagination runs, and neither the editor's text nor
the preview's scroll position is lost. `viewMode` and `splitRatio` are therefore deliberately
**not** in `App.REFLOW_KEYS`: the paginated sheets are sized in millimetres by the `@page`
rules (`measurePageArea` reads Settings, never the DOM), so a narrower canvas cannot move a
page break — the no-slice guarantee is independent of the workspace layout.

**Hiding a pane is not the same for `#canvas`.** `#editor-pane` and `#split-handle` are hidden
with `display: none`; `#canvas` must never be. Markdown mode hides the preview but keeps
feeding it — every keystroke still runs the full pipeline into that host — and Paged.js places
breaks by measuring real element heights, which are all zero under a `display: none` ancestor.
So in `editor` mode the canvas is *parked* instead: `position: absolute; inset: 0;
visibility: hidden`, lifted out of the grid onto `#workspace`'s own box at full size. It stays
laid out and measurable; only its paint is suppressed. `@media print` then un-parks it
explicitly, because the toolbar's Print action is live in every view mode and would otherwise
emit a blank PDF from Markdown mode.

### The editing loop

```
textarea input  →  App.onEditorInput  →  DocStore.updateText (in place)
                →  store "text" event  →  scheduleRender("content")  [250 ms debounce]
                →  the SAME runPipeline as a dropped file (§3, unchanged)
```

Renders are **serialized as well as debounced** (`createRenderScheduler`, §7). A pagination
that outlives its debounce window — routine once a document is large and the user keeps
typing — must not have the next one start underneath it: `runPipeline` tears down and rewrites
one shared host through Paged.js's global handler and page counter, so two overlapping runs
interleave two layouts into the same pages. The monotonic `renderToken` is not sufficient on
its own; it only suppresses the older run's final UI write, it cannot cancel Paged.js.

Both exports call `App.flushRender()` first, which runs any debounced render immediately and
awaits the in-flight one. Without it, Print or Download fired inside the 250 ms window — a
user clicking straight after typing — reads a host still holding the *previous* pages: the
newest edits silently missing from the PDF, or no sheets at all for a freshly typed document.

Typing into an empty app calls `DocStore.add("Untitled.md", …)` on the first keystroke, so a
preview exists immediately. Editing an open document mutates it in place — a file opened by
drop, paste, or picker is editable exactly like typed text, and editing never opens a second
document.

`DocStore` has **two** events so this loop cannot thrash unrelated UI:

| Event | Fired by | Who listens |
| --- | --- | --- |
| `change` | `add` / `setActive` / `remove` — the document *set* or active doc changed | App (re-seed the editor, then render), Toolbar (document switcher) |
| `text` | `updateText` — the active document's text was edited, once per keystroke | App (render only) |

`Editor.setDocument` is a no-op when the text already matches, so the `change` that follows
`add` can never write over a live caret.

### The two-layer editor

`#editor-highlight` (a non-interactive `<pre>`) sits underneath `#editor-input` (a
`<textarea>` whose glyphs are transparent). The backdrop paints Shiki's `markdown` grammar;
the textarea supplies native undo/redo, IME, selection and accessibility.

Three invariants, all enforced by `editor.css` / `Editor.ts` and asserted in
`e2e/editor.spec.ts` and `editor.test.ts`:

1. **Identical box metrics.** Font family/size, line-height, padding, `tab-size`, wrapping and
   `scrollbar-gutter` are declared once for both selectors. Change one, change both, or the
   colors drift off the characters. The gutter belongs in that set: where scrollbars take
   layout width, a source long enough to overflow would otherwise narrow only the
   `overflow: auto` textarea, and the two layers would soft-wrap at different characters.
2. **Glued scrolling.** The textarea is the scroller; its `scroll` handler copies
   `scrollTop`/`scrollLeft` onto the `overflow:hidden` backdrop. Every repaint re-runs that
   copy, because replacing the backdrop's content resets its scroll height and the browser has
   already clamped its `scrollTop` against the previous, shorter content.
3. **The backdrop always shows the current text.** With the backdrop on, the textarea's glyphs
   are transparent, so the backdrop is the *only* visible copy of the source. Every input
   therefore repaints it synchronously in plain text; the debounced Shiki pass only recolors
   it. Deferring the whole paint to the debounce leaves freshly typed characters invisible and
   deleted ones still painted for as long as the user keeps typing.

The backdrop is built from `HighlighterCore.codeToTokens` and inserted with `textContent`
plus `CSSStyleDeclaration.setProperty` — **never `innerHTML`**. Document text is therefore
never parsed as markup on this path at all, which is stronger than sanitizing generated HTML
and costs no DOMPurify pass per keystroke. Tokenizing is debounced 90 ms and guarded by a
monotonic token so a slow pass cannot repaint over newer text.

Two costs are deliberately kept off the keystroke path: the word count (`countWords` is O(n)
and allocates per word — it rides the same 90 ms debounce, while the O(1) size stays live),
and tokenizing (capped at `HIGHLIGHT_MAX_CHARS`, above which the textarea paints its own
text). Tab inserts via `execCommand("insertText")`, the only insertion path browsers record in
the textarea's native undo stack, falling back to a manual splice where it is unavailable.

`data-highlight` on `#editor-pane` switches the backdrop off — for an empty document (so an
untouched app never pays the Shiki/WASM startup cost), past `Editor.HIGHLIGHT_MAX_CHARS`
(120 000), or after a tokenizer failure. When off, the textarea paints its own plain text at
the same metrics; the user's content is never at risk.

### Print

The primary export is `window.print()` over this same live document, so `editor.css`'s
`@media print` block — which hides `#editor-pane` and `#split-handle` and makes `#workspace`
`display:block` — is the only thing keeping a textarea off the exported PDF. `dom-contract`
asserts those rules exist and `e2e/editor.spec.ts` verifies them under `emulateMedia`.
