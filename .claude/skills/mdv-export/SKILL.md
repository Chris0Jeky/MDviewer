---
name: mdv-export
description: Work on the print + programmatic PDF export paths; verify both buttons and that the PDF is always dark-on-white.
user-invocable: true
---

# mdv-export

Use this for changes under `src/export/*`. Both export paths run over the SAME
already-paginated DOM, so page-break safety is inherited from Paged.js — never
re-implement breaking here.

## Two paths (spec section 5)

- PRIMARY — `src/export/print.ts` `exportViaPrint(host)`: `window.print()` with
  `@media print` + `@page` CSS. Vector, selectable text, best quality. `@media print`
  hides chrome and prints only `.pagedjs_page`.
- FALLBACK — `src/export/download.ts` `exportPaginatedToPdf(host, settings, opts)`:
  iterate `.pagedjs_page` nodes, `html2canvas-pro` each (scale ~1.5–2, white bg) →
  `jsPDF` `addImage`/`addPage`. One canvas == one already-broken page. Rasterized,
  non-selectable, best-effort.

## Rules

- Both are dynamic-imported on user action (keeps the initial bundle light).
- The exported PDF is ALWAYS dark-on-white regardless of screen theme — `@media print`
  forces the Shiki light side and light callout backgrounds. Do not let screen theme
  leak into the PDF.
- jspdf is 2.5.2: use `addImage`/`addPage`/`save`; named import `{ jsPDF }`; never
  `.html()`. Use `PAGEDJS.pageClass` from `src/app/dom.ts` to select pages.
- html2canvas-pro caveat: Mermaid `foreignObject` text can blank; warn on big docs and
  keep `window.print()` primary.

## Verify

`npm run test` (`tests/export-download.test.ts` — page-count from N `.pagedjs_page`
nodes). Manual: both export buttons in the toolbar, confirm output is dark-on-white and
no block is cut (the paginated DOM already guarantees this). `tests/e2e/export.spec.ts`
covers the wired buttons.
