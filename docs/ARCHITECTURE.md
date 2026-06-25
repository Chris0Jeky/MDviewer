# MDviewer — Architecture

> The _how_. For the _why_ see [`PRODUCT_VISION.md`](./PRODUCT_VISION.md). For the canonical,
> pinned details (module signatures, exact CSS/DOM names, no-slice tiers, testing strategy) see
> [`design/IMPLEMENTATION_SPEC.md`](./design/IMPLEMENTATION_SPEC.md) and the version-correct
> library snippets in [`design/LIBRARY_NOTES.md`](./design/LIBRARY_NOTES.md). If this doc and the
> spec disagree, the spec wins — fix one of them in the same change.

## The pipeline (load-bearing order)

Pagination measures real, laid-out heights. Every earlier step changes those heights, so
**pagination must run last, exactly once, after all async content has settled.** `App.runPipeline`
follows this order and must never reorder it:

```
  0  read raw markdown string            (drag-drop / paste / file picker)
       │
  1  await getHighlighter()              singleton: Shiki core + Oniguruma WASM (once)
       │
  2  createMarkdown(hl, settings)        SYNC render: markdown-it + Shiki (fromHighlighter)
     .render(src)                        + inline KaTeX  ->  { html, warnings }
       │
  3  buildPaginationSource(html,         inject TOC nav; transform end-of-doc footnotes
       settings)                         into inline float spans  ->  DocumentFragment
       │
  4  await renderAllMermaid(src, theme)  async  ->  fixed-size SVG figures (useMaxWidth:false)
       │
  5  await awaitFontsAndImages(src)      document.fonts.ready + img.decode  ->  heights final
       │
  6  capture pristine clone of source    enables re-paginate without re-render
       │
  7  registerHandlersOnce();             PAGINATION LAST — Paged.js over the settled DOM
     await paginate(source,                afterParsed  -> shrinkToFit (Tier 3)
       buildStylesheet(settings),          afterRendered -> fillTocPageNumbers
       #paged-output)
       │
       ▼
   one paginated DOM  ──►  export: print (vector)  OR  download (rasterized)
```

**Re-pagination** (full reflow, debounced ~120ms) is triggered by anything that changes layout:
paper size, margins, font, font size, and the TOC / page-numbers / running-header / line-numbers
toggles. Purely visual changes — screen theme, same-family code light/dark flip — are CSS-only and
do **not** re-paginate. Content changes debounce at ~250ms. Re-pagination reuses the **pristine
clone** captured at step 6, so it never re-runs the render pipeline or bakes stale transforms.

## Module responsibilities by folder

- **`src/app/`** — application core. `App.ts` owns the `DocStore` and `Settings` and runs the
  pipeline above. `state.ts` holds the in-memory document store plus the debounced render
  scheduler. `settings.ts` is the persisted settings type, defaults, and load/save/migrate.
  `dom.ts` is the single source of truth for DOM ids and class names (`IDS`, `CLASSES`, `ATTRS`,
  `PAGEDJS`, plus the `el()` helper). `input.ts` validates and ingests dropped/pasted/picked files.
- **`src/ui/`** — DOM builders, each returning a small handle. `Toolbar` binds controls to
  settings and the export buttons; `Canvas` hosts `#paged-output` and the paginating overlay;
  `EmptyState` is the full-window dropzone; `Banner` aggregates warnings and fatal errors.
- **`src/render/`** — turn Markdown into a print-ready DOM. `markdown.ts` builds the markdown-it
  instance (callouts, footnotes, anchors, TOC, task lists, attrs) with Shiki and KaTeX wired in;
  `highlight.ts` is the Shiki singleton and theme pairs; `math.ts` is the KaTeX plugin config;
  `mermaid.ts` renders diagrams to fixed-size SVG; `buildSource.ts` injects the TOC, moves
  footnotes inline as page-bottom floats, and awaits fonts/images.
- **`src/paginate/`** — the single pagination engine (Paged.js 0.4.3). `cssBuilder.ts` produces the
  full stylesheet string; `measure.ts` computes the printable page area; `handler.ts` runs the
  Paged.js lifecycle hooks (shrink-to-fit, TOC page numbers); `shrinkToFit.ts` is the Tier-3
  heuristic; `paginate.ts` tears down and re-runs a fresh `Previewer`.
- **`src/export/`** — `print.ts` (primary, vector via `window.print()`) and `download.ts`
  (fallback, rasterize each page with html2canvas-pro → jsPDF). Both are dynamic-imported on user
  action to keep the initial bundle light.
- **`src/styles/`** — see the CSS architecture below.
- **`src/types/`** — local ambient shims for packages that ship no `@types`.

## CSS architecture

CSS is split by **where it applies** and **whether it is static or settings-dependent**:

- **`app.css` + `preview.css`** — app chrome (grid shell, toolbar, canvas backdrop, theme tokens)
  and screen-only page-sheet styling, drag overlay, and paginating spinner. Imported by `main.ts`.
  **Not** part of the stylesheet handed to Paged.js.
- **`document.css` + `shiki.css`** — the rendered document's typography, callouts, TOC, footnotes,
  task lists, and code colors. Imported by `main.ts`; these cascade normally onto the paginated
  page content. `shiki.css` has an `@media print` rule that forces the Shiki **light** side and a
  `@media (prefers-color-scheme: dark)` rule for screen.
- **`print.css`** — **static** paged-media break rules only (`break-inside: avoid` +
  `box-decoration-break: clone`, orphans/widows, repeated `thead`, the per-element keep-whole list,
  heading keep-with-next, TOC leader dots). It contains **no `@page` block** (that is dynamic). It
  is both imported by `main.ts` **and** raw-imported into `cssBuilder.ts`
  (`import printBase from "../styles/print.css?raw"`).
- **`cssBuilder.ts` `buildStylesheet(settings)`** — returns `printBase` concatenated with a
  dynamically generated `@page` block: size from `settings.paperSize`, margin from
  `MARGIN_MM[settings.margins]`, the running header only if `settings.runningHeader` is set, the
  `@bottom-center` page counter only if `settings.showPageNumbers`, the `nav.toc` target-counter
  rule only if `settings.showToc`, and line-number CSS only if `settings.showLineNumbers`, plus the
  `@footnote` area rule and the `h1/h2` `string-set`. **This combined string is what `paginate()`
  passes to Paged.js** (as a blob URL).

## Single pagination engine

There is exactly **one** pagination engine: **Paged.js 0.4.3**. The same paginated DOM feeds both
export paths, so the page breaks are computed once and shared. This is deliberate — a second engine
would mean two break models that could disagree, and the no-slice guarantee depends on a single,
testable source of truth. The no-slice strategy (keep-whole, graceful split, shrink-to-fit, clean
forced split) is documented in detail in section 4 of the implementation spec and verified by
`tests/e2e/nocutoff.spec.ts`.

## The two export paths

Both operate over the **same** already-paginated DOM, so page-break safety is inherited rather than
recomputed:

1. **Primary — `exportViaPrint(host)`**: `window.print()` with `@media print` + `@page` CSS. The
   chrome is hidden and only `.pagedjs_page` nodes print, at true size. Output is **vector** with
   selectable text — best quality and smallest file. The user chooses "Save as PDF" in the print
   dialog.
2. **Fallback — `exportPaginatedToPdf(host, settings, opts)`**: iterate the `.pagedjs_page` nodes,
   rasterize each with html2canvas-pro (white background), and assemble with jsPDF
   (`addImage`/`addPage`/`save`). One canvas equals one already-broken page, so breaks are
   preserved. Rasterized output (non-selectable, larger) — best-effort.

The exported PDF is **always dark-on-white** regardless of the screen theme, because `@media print`
forces the Shiki light side and light callout backgrounds.

## Threading and performance model

Everything runs on the **main thread**; there is no worker. The cost centers are the one-time Shiki
WASM load (singleton, amortized across renders) and Paged.js layout (which can briefly block on
large documents). Mitigations:

- **Paginate once**, after all async content settles (the render order above).
- **Debounce** setting changes and content changes, and show a "Paginating…" state so the UI stays
  honest during a reflow.
- **Keep a pristine clone** so re-pagination never re-runs render and never compounds transforms.
- **Lazy-load** the export code and the Shiki langs/themes (Vite code-splits the dynamic imports),
  keeping the initial bundle small.
- **Surface incremental page count** from the Paged.js `page` event for large-document feedback.

See section 11 of the implementation spec for the full risk/mitigation list.
