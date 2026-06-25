---
name: mdv-pagination
description: Work on Paged.js + the @page/break CSS + the no-slice guarantee — always run the no-cutoff e2e test.
user-invocable: true
---

# mdv-pagination

Use this for any change under `src/paginate/*` or the break/`@page` CSS. This is the
product's core promise: no atomic block ever straddles a page boundary.

## Key files

- `src/paginate/paginate.ts` — `paginate(source, css, host)`, `teardownPagination`.
  Fresh `Previewer` per run; tear down prior `.pagedjs_pages` AND
  `style[data-pagedjs-inserted-styles]` before re-running; CSS is passed as a blob URL.
- `src/paginate/cssBuilder.ts` — `buildStylesheet(settings)`: `import printBase from
  "../styles/print.css?raw"` concatenated with the dynamic `@page` block (size, margin
  via `MARGIN_MM`, `@top` header only if `runningHeader`, `@bottom-center` counter only
  if `showPageNumbers`, TOC `target-counter` only if `showToc`, line-number CSS only if
  `showLineNumbers`, `@footnote` area, `h1/h2 string-set`).
- `src/styles/print.css` — STATIC break rules only: `break-inside:avoid` +
  `box-decoration-break:clone` + `orphans/widows` + `thead` repeat + tr/td/th/li +
  headings `break-after:avoid` + `katex-display` + figures. NO `@page` block here.
- `src/paginate/measure.ts` — `MM`, `IN`, `SHRINK_LIMIT` (1.15), `measurePageArea`.
- `src/paginate/handler.ts` — `MDViewerHandler`, `registerHandlersOnce` (idempotent),
  `fillTocPageNumbers`.
- `src/paginate/shrinkToFit.ts` — Tier-3 off-DOM measure + `transform:scale`.

## No-slice tiers (spec section 4)

T1 keep-whole (default) → T2 graceful split (`orphans/widows:3` + clone + repeated
`thead`) → T3 shrink-to-fit (block ≤ `SHRINK_LIMIT` too tall, never reflowing tables) →
T4 clean forced split (last resort). `break-inside:avoid` is intentionally ignored for
blocks taller than a page — the tiers make that split read cleanly.

## Rules

- Pagination runs LAST and exactly once (render order, spec section 3).
- Keep a pristine clone so re-paginate has no baked transforms.
- Never rename Paged.js-owned selectors (`.pagedjs_page`, etc.); import from
  `PAGEDJS` in `src/app/dom.ts`.

## Verify

ALWAYS run `tests/e2e/nocutoff.spec.ts` (real Chromium) — it asserts no atomic block's
rect straddles a `.pagedjs_page` boundary. Plus `npm run test` for cssBuilder/measure.
Layout is meaningless in jsdom, so break correctness is e2e-only.
