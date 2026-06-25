---
name: mdv-test-harness
description: Choose or extend Vitest vs Playwright for MDviewer; layout belongs in e2e; keep the no-cutoff test honest.
user-invocable: true
---

# mdv-test-harness

Use this when adding or changing tests, or deciding which lane proves a change. The
rule that drives everything: jsdom has NO layout, so anything depending on
`getBoundingClientRect`/real heights must be a Playwright e2e test.

## Lanes

- Unit (Vitest + jsdom) — `tests/*.test.ts`. For pure functions and DOM-structure
  assertions: settings round-trip, markdown plugin output (callout classes, footnotes
  section, TOC anchors == anchor slugs), highlighter singleton + dual-theme inline
  color, KaTeX `throwOnError:false`, mermaid block → figure + failure placeholder,
  `buildStylesheet` per setting, `measurePageArea` math, footnote-inline transform,
  input validation, fallback PDF page-count, DOM-contract drift guard.
- E2E (Playwright, real Chromium) — `tests/e2e/*.spec.ts`. For anything layout-dependent:
  `nocutoff.spec.ts` (crown jewel — no atomic block straddles a page boundary),
  `golden-path.spec.ts`, `export.spec.ts`, `empty-error.spec.ts`.

## Choosing the lane

- Does it assert on element geometry or actual pagination? → e2e.
- Does it assert on emitted HTML, a returned string/number, or a pure function? → unit.
- New rendered structure → unit DOM assertion; new break behavior → extend
  `nocutoff.spec.ts`.

## Keep no-cutoff honest

- Use fixtures with genuinely hard cases: tall code blocks, wide tables, callouts near
  boundaries (`tests/fixtures/nocutoff.md`). Helpers in `tests/helpers/pagedDom.ts`.
- Never loosen the boundary tolerance to make it pass — that defeats the product.

## Verify

`npm run test` (Vitest) and `npm run test:e2e` (Playwright). State which lanes ran and
their results; never claim a lane passed unless it ran in this environment.
