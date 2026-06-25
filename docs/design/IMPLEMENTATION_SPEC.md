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

## 2. Resolved dependency versions (verified installed)

Runtime: `markdown-it@14.2.0` · `markdown-it-footnote@4.0.0` · `markdown-it-anchor@9.2.0`
· `markdown-it-toc-done-right@4.2.0` · `markdown-it-container@4.0.0` · `markdown-it-attrs@4.5.0`
· `markdown-it-task-lists@2.1.1` · `shiki@3.23.0` (+ `@shikijs/core`, `@shikijs/langs`,
`@shikijs/themes`, `@shikijs/markdown-it`, `@shikijs/transformers` all `3.23.0`)
· `@vscode/markdown-it-katex@1.1.2` · `katex@0.16.47` · `mermaid@11.15.0` · `pagedjs@0.4.3`
· `jspdf@2.5.2` · `html2canvas-pro@1.6.7`.

Toolchain: `vite@6` · `vitest@2` · `typescript@5.9` · `eslint@9` + `typescript-eslint@8`
· `jsdom@25` · `@playwright/test@1.49+`.

Notes that bite if ignored:
- **Shiki is 3.x**, not 4.x. The fine-grained API (`shiki/core` `createHighlighterCore`,
  `shiki/engine/oniguruma` `createOnigurumaEngine`, `import('shiki/wasm')`,
  `@shikijs/langs/<lang>`, `@shikijs/themes/<theme>`, `@shikijs/markdown-it/core`
  `fromHighlighter`) is identical in 3.x — use it.
- **`@types/markdown-it-footnote@3.0.4`** intentionally pairs with runtime `4.0.0`
  (type surface unchanged). Do not "fix" the mismatch.
- **`markdown-it-task-lists`** ships no `@types` → local shim in `src/types/`.
- **`pagedjs`** ships no types and no `module` field → local ambient `pagedjs.d.ts`;
  Vite resolves its `browser`/`import` export condition automatically.
- **jspdf is 2.5.2** — use `addImage`/`addPage`/`save` (we never use `.html()`).

## 3. The load-bearing render order (NEVER reorder)

Pagination measures real laid-out heights. Every earlier step changes those heights,
so pagination MUST run last, exactly once, after all async content settles.

```
0  read raw markdown string (drag-drop / paste / file picker)
1  await getHighlighter()            // singleton: createHighlighterCore + Oniguruma WASM
2  createMarkdown(hl, settings).render(src)   // SYNC: Shiki (fromHighlighter) + KaTeX inline
3  buildPaginationSource(html, settings)      // inject TOC nav; transform end-of-doc footnotes -> inline float spans
4  await renderAllMermaid(source, theme)      // async -> fixed-size SVG (useMaxWidth:false)
5  await awaitFontsAndImages(source)          // document.fonts.ready + img.decode -> heights final
6  capture pristine clone of source           // enables re-paginate without re-render
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
`.pagedjs_page` boundary.

## 5. Two export paths over one paginated DOM

- **PRIMARY — `exportViaPrint()`**: `window.print()` with `@media print` + `@page` CSS.
  Vector, selectable text, best quality. `@media print` hides chrome, prints only `.pagedjs_page`.
- **FALLBACK — `exportPaginatedToPdf()`**: iterate `.pagedjs_page` nodes, `html2canvas-pro`
  each (scale ~1.5–2, white bg) → `jsPDF` `addImage`/`addPage`; one canvas == one already-broken
  page, so page-break safety is inherited. Rasterized (non-selectable), best-effort.

Both are dynamic-imported on user action (keeps the initial bundle light). The exported
PDF is **always dark-on-white** regardless of screen theme (`@media print` forces the Shiki
light side and light callout backgrounds).

## 6. File tree (src + tests)

```
src/
  main.ts                       Vite entry; App.init(#app); wire global drag/drop/paste; import CSS
  app/
    App.ts                      controller; owns DocStore + Settings; runPipeline (render order); pane swap
    state.ts                    DocStore (openDocs/activeId, events) + createRenderScheduler (debounce)
    settings.ts                 Settings type, DEFAULT_SETTINGS, load/save/migrate (localStorage)
    dom.ts                      canonical DOM ID + class-name constants (single source) + el() helper
    input.ts                    openMarkdown(); drag/drop/paste/picker; ext+MIME validation; size guards
    sampleDoc.ts                bundled demo markdown (code+KaTeX+Mermaid+callouts+footnotes+tall code block)
  ui/
    Toolbar.ts                  toolbar groups A–F, bind controls -> Settings, export buttons
    Canvas.ts                   preview pane: #paged-output host, page chip, zoom, paginating overlay, aria
    EmptyState.ts               full-window dropzone card (recovery state too)
    Banner.ts                   aggregated warning banner + fatal error card (aria-live)
  render/
    markdown.ts                 createMarkdown(hl,settings); renderMarkdown(); SLUGIFY; RenderWarning
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
    preview.css                 screen-only .pagedjs_page sheets, drag overlay, paginating spinner, empty state
    document.css                rendered-doc typography, callouts, toc, footnotes, task-list, anchors, katex-display
    print.css                   static @page base + no-slice break rules (settings-independent parts)
    shiki.css                   screen-dark + print-light force + line-number counters + .line.highlighted
index.html                      host page; #app, hidden #file-input, theme bootstrap
tests/
  settings.test.ts  markdown.test.ts  highlight.test.ts  math.test.ts  mermaid.test.ts
  cssBuilder.test.ts  measure.test.ts  buildSource.test.ts  input.test.ts
  export-download.test.ts  dom-contract.test.ts
  e2e/nocutoff.spec.ts  e2e/golden-path.spec.ts  e2e/export.spec.ts  e2e/empty-error.spec.ts
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
export function createRenderScheduler(run: (r: RenderReason) => Promise<void>): (r: RenderReason) => void;

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

// src/render/markdown.ts
import type MarkdownIt from 'markdown-it';
export interface RenderWarning { kind: 'math' | 'diagram' | 'lang'; message: string; }
export function createMarkdown(hl: HighlighterCore, settings: Settings): MarkdownIt;
export function renderMarkdown(md: MarkdownIt, src: string): { html: string; warnings: RenderWarning[] };
export const SLUGIFY: (s: string) => string;

// src/render/mermaid.ts
export type MermaidTheme = 'default' | 'dark' | 'neutral' | 'forest' | 'base';
export function renderAllMermaid(root: ParentNode, theme?: MermaidTheme): Promise<{ rendered: number; failed: number }>;

// src/render/buildSource.ts
export function buildPaginationSource(html: string, settings: Settings): DocumentFragment;
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
export function registerHandlersOnce(area: () => PageArea): void;   // idempotent
export function fillTocPageNumbers(host: HTMLElement): void;

// src/paginate/paginate.ts
import type { PagedFlow } from 'pagedjs';
export function teardownPagination(host: HTMLElement): void;
export async function paginate(source: DocumentFragment, css: string, host: HTMLElement): Promise<PagedFlow>;

// src/export/print.ts
export async function exportViaPrint(host: HTMLElement): Promise<void>;
// src/export/download.ts
export interface FallbackPdfOptions { scale?: number; fileName?: string; }
export async function exportPaginatedToPdf(host: HTMLElement, settings: Settings, opts?: FallbackPdfOptions): Promise<void>;

// src/ui/*
export function mountToolbar(root: HTMLElement, app: App): { destroy(): void };
export function mountCanvas(root: HTMLElement): { host: HTMLElement; setPaginating(b: boolean): void; setPageCount(n: number): void; setZoom(z: Settings['zoom']): void };
export function mountEmptyState(root: HTMLElement, onChoose: () => void, onSample: () => void): { destroy(): void };
export function mountBanner(root: HTMLElement): { warn(w: RenderWarning[]): void; fatal(msg: string): void; clear(): void };

// src/app/App.ts
export class App {
  settings: Settings; store: DocStore;
  static init(root: HTMLElement): App;
  scheduleRender(reason: RenderReason): void;
  updateSettings(patch: Partial<Settings>): void;   // persists + scheduleRender('settings')
}
```

## 8. DOM IDs and CSS class names (single source: `src/app/dom.ts`)

DOM IDs: `#app #toolbar #canvas #paged-output #empty-state #drag-overlay #warning-banner
#error-card #page-chip #zoom-control #status-live #file-input`.

Paged.js-owned (never rename): `.pagedjs_pages` `.pagedjs_page`
`style[data-pagedjs-inserted-styles]` `[data-page-number]`.

App-authored: chrome — `.toolbar-group .toolbar-divider .seg-control .seg-option
.toggle-btn[aria-pressed] .export-primary .export-secondary .is-paginating
[data-app-theme]`; doc root — `.doc` (carries `--doc-font-family`/`--doc-font-size`,
`data-code-theme`); code — `.shiki .shiki .line .line.highlighted .with-line-numbers
figure.code-figure`; callouts — `.callout .callout-note .callout-tip .callout-warning
.callout-danger .callout-title`; toc — `nav.toc .toc ol a.toc-link a.xref`; footnotes —
`.footnote .footnotes .footnote-item .footnote-backref`; misc — `.task-list-item
.header-anchor .katex .katex-display figure.mermaid-figure .mermaid [data-shrunk]
.landscape`.

## 9. Settings persistence

Only `Settings` persists (localStorage key `mdviewer.settings.v1`). **Document bytes are
never persisted** (privacy + size). `loadSettings()` merges parsed over `DEFAULT_SETTINGS`
inside try/catch (tolerates corrupt JSON and private-mode throwing storage).

## 10. Testing strategy

- **Unit (Vitest + jsdom)**: pure functions and DOM-structure assertions — settings round-trip,
  markdown plugin output (callout classes, footnote section, toc anchors == anchor slugs),
  highlighter singleton + dual-theme inline color, KaTeX `throwOnError:false`, mermaid block →
  figure + failure placeholder, `buildStylesheet` per setting, `measurePageArea` math,
  footnote-inline transform, input validation, fallback PDF page-count, DOM-contract drift guard.
- **E2E (Playwright, real Chromium)**: anything layout-dependent. `nocutoff.spec.ts` is the
  crown-jewel test (no atomic block straddles a page boundary). Plus golden-path, export, empty/error.
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
