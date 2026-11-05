# MDviewer — Architecture

> The _how_. For the _why_ see [`PRODUCT_VISION.md`](./PRODUCT_VISION.md). For the canonical,
> pinned details (module signatures, exact CSS/DOM names, no-slice tiers, testing strategy) see
> [`design/IMPLEMENTATION_SPEC.md`](./design/IMPLEMENTATION_SPEC.md) and the version-correct
> library snippets in [`design/LIBRARY_NOTES.md`](./design/LIBRARY_NOTES.md). If this doc and the
> spec disagree, the spec wins — fix one of them in the same change.

## Web and Windows ownership

The web entry opens the shared source/PDF workspace. The experimental Windows entry
starts with `src/desktop/main.ts` and its in-memory `ReaderSession`; the continuous
reader uses the shared rendering modules without Paged.js. New or Edit & PDF lazily
loads `src/desktop/workspace.ts` and the App workspace. Entry and return transfer
document ownership, preserve dirty baselines, and keep controls inert through the
handoff. Entry drains queued imports before focusing the editor. The reader's old source
list is released after successful transfer; failed transitions retain the owned text for retry.

The Rust host owns OS-selected paths. The webview receives names/text and sends bounded
export bytes plus a safe basename; it cannot supply an arbitrary write path. Explicit
native saves use a dialog and atomic replacement. The ordinary web build uses browser
downloads. Save Markdown writes a copy and does not adopt an original-file binding or
clear the dirty baseline. Open documents and latest-close recovery stay in memory;
there is no automatic/app-managed document or session persistence. Settings and the
approved Pulseboard keys are the existing exceptions for app-managed user state.

The next scopes are indexed in [Future work](FUTURE_WORK.md) and
[#195](https://github.com/Chris0Jeky/MDviewer/issues/195). Save ownership
[#196](https://github.com/Chris0Jeky/MDviewer/issues/196) and optional recovery
[#197](https://github.com/Chris0Jeky/MDviewer/issues/197) require design and coordinated
contract/privacy updates before implementation.

## The pipeline (load-bearing order)

Pagination measures real, laid-out heights. Every earlier step changes those heights, so
**pagination must run last, exactly once, after all async content has settled.** `App.runPipeline`
follows this order and must never reorder it:

```
  0  capture markdown + settings         (drag-drop / paste / file picker)
       │
  1  await getHighlighter()              singleton: Shiki core + Oniguruma WASM (once)
       │
  1b createMarkdown(null, settings)      parse once, retaining tokens and environment
     await ensureLang(...)              prepare parsedFenceLanguages(md, tokens)
       │
  2  installMarkdownHighlighter(...)     attach after grammars are ready
     renderMarkdownTokens(md,            SYNC Shiki + inline KaTeX -> { html, warnings }
       tokens, env)
       │
  3  buildPaginationSource(html,         inject TOC nav; transform end-of-doc footnotes
       settings)                         into inline float spans  ->  DocumentFragment
       │
  4  await renderAllMermaid(src, theme)  async  ->  fixed-size SVG figures (useMaxWidth:false)
       │
  5  await awaitFontsAndImages(src)      document.fonts.ready + img.decode  ->  heights final
       │
  6  fully prepared source               fresh fragment for this render
       │
  7  registerHandlersOnce();             PAGINATION LAST — Paged.js over the settled DOM
     await paginate(source,                afterParsed  -> shrinkToFit (Tier 3)
       buildStylesheet(settings),          afterRendered -> fillTocPageNumbers
       #paged-output)
       │
       ▼
   one paginated DOM  ──►  export: print (vector)  OR  download (rasterized)
```

**Re-pagination** (debounced about 120 ms) runs for code-theme family, typography,
paper, margins and page-furniture changes. Screen theme, zoom, view mode and split
ratio change screen presentation without scheduling pagination. Content changes
debounce about 250 ms. Each run rebuilds a fresh fragment through the serialized
pipeline, so prepared transforms do not accumulate. Paginated document code remains
on the light side in every screen theme.

## Module responsibilities by folder

- **`src/app/`** — application core. `App.ts` owns the `DocStore` and `Settings` and runs the
  pipeline above. `state.ts` holds the in-memory document store plus the debounced render
  scheduler. `settings.ts` is the persisted settings type, defaults, and load/save/migrate.
  `dom.ts` is the single source of truth for DOM ids and class names (`IDS`, `CLASSES`, `ATTRS`,
  `PAGEDJS`, plus the `el()` helper). `input.ts` validates and ingests dropped/pasted/picked files.
- **`src/desktop/`** — continuous reading, bounded session admission, dirty baselines,
  lazy App handoff, native event/save adapters and reading-view controls.
- **`src-tauri/`** — bounded file, link, save and window capabilities, single-instance
  forwarding, atomic explicit writes and Windows packaging. Filesystem paths stay in the host.
- **`src/ui/`** — DOM builders, each returning a small handle. `Toolbar` binds controls to
  settings and the export buttons; `Editor` is the Markdown source pane (a `<textarea>` over a
  Shiki syntax backdrop); `Splitter` is the `role="separator"` divider; `Canvas` hosts
  `#paged-output` and the paginating overlay; `EmptyState` is the full-window dropzone; `Banner`
  aggregates warnings and fatal errors. `Editor` and `Canvas` are the two columns of the
  `#workspace` grid — see the split workspace below.
- **`src/render/`** — turn Markdown into a print-ready DOM. `markdown.ts` builds the markdown-it
  instance (callouts, footnotes, anchors, TOC, task lists, attrs) with Shiki and KaTeX wired in;
  `sanitize.ts` removes executable HTML and automatic remote-resource loads before DOM insertion;
  `highlight.ts` is the Shiki singleton and theme pairs; `math.ts` is the KaTeX plugin config;
  `mermaid.ts` renders diagrams to fixed-size, re-sanitized SVG; `buildSource.ts` injects the TOC, moves
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

- **`app.css` + `editor.css` + `preview.css`** — app chrome (grid shell, toolbar, theme tokens),
  the split workspace (view-mode grid, source-pane metrics, divider), and screen-only page-sheet
  styling, drag overlay, and paginating spinner. Imported by `main.ts`. **Not** part of the
  stylesheet handed to Paged.js. Each carries an `@media print` block that removes its chrome,
  because the primary export prints this same live document.
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

## The split workspace

Below the toolbar sits `#workspace`, a CSS grid of three columns: the Markdown source pane, the
divider, and the preview canvas. `data-view-mode` (`editor` / `split` / `preview`) selects which
columns show; `--split-ratio` carries the source pane's width share.

Two properties keep this cheap and safe:

- **All three panes stay mounted.** A view-mode change is a single attribute write — nothing is
  torn down, nothing re-renders, and no pagination runs. `viewMode` and `splitRatio` are therefore
  not reflow keys: `measurePageArea` derives page geometry from `Settings` in millimetres and never
  reads the DOM, so canvas width cannot influence a page break. The no-slice guarantee is
  independent of the layout you happen to be viewing in.
- **Editing feeds the unchanged pipeline.** `Editor` reports each keystroke to
  `App.onEditorInput`, which calls `DocStore.updateText`; the store emits `"text"` (distinct from
  the `"change"` that identity operations emit, so per-keystroke edits do not churn the document
  switcher or re-seed the editor), and the App schedules the ordinary 250 ms content render. A
  typed document and a dropped file take exactly the same path from there.

Full detail — the two-layer editor's alignment contract, the no-`innerHTML` rule for the syntax
backdrop, and the print guard — is section 12 of the implementation spec.

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
   (`addImage`/`addPage`), then use the browser download or installed native save destination.
   One canvas equals one already-broken page, so breaks are preserved. Rasterized output
   (non-selectable, larger) — best-effort.

An export captures document identity, source and settings when requested. The scheduler
holds the render host through capture/print and native save settlement. It reuses a
matching completed paginated render; otherwise it prepares the captured input through
the normal pipeline. Later renders, switches and closes remain queued behind that lease.

The exported PDF is **always dark-on-white** regardless of the screen theme, because `@media print`
forces the Shiki light side and light callout backgrounds.

## Threading and performance model

Rendering and pagination run on the browser/WebView **main thread**; there is no rendering
worker. Native file dialogs and filesystem operations run off the WebView callback thread.
The cost centers are the one-time Shiki WASM load (singleton, requested when needed) and
Paged.js layout, which can block on large documents. Mitigations:

- **Paginate once**, after all async content settles (the render order above).
- **Debounce** setting changes and content changes, and show a "Paginating…" state so the UI stays
  honest during a reflow.
- **Reuse a matching completed render for export** under the scheduler lease. Each scheduled
  content/settings render rebuilds a fresh fragment, so prepared transforms never accumulate.
- **Lazy-load** the export code and the Shiki langs/themes (Vite code-splits the dynamic imports),
  keeping the initial bundle small.
- **Surface incremental page count** from the Paged.js `page` event for large-document feedback.

See section 11 of the implementation spec for the full risk/mitigation list.
