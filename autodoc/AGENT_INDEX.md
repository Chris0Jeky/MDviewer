# MDviewer — Agent Index

> Fast code-seam map for agents. The goal: find the right file and its invariants **without**
> bulk-reading the repo. For the full canonical detail, read
> [`../docs/design/IMPLEMENTATION_SPEC.md`](../docs/design/IMPLEMENTATION_SPEC.md) (pinned signatures,
> render order, CSS/DOM names, no-slice tiers) and
> [`../docs/design/LIBRARY_NOTES.md`](../docs/design/LIBRARY_NOTES.md) (version-correct snippets).

## Start here

1. [`../docs/design/IMPLEMENTATION_SPEC.md`](../docs/design/IMPLEMENTATION_SPEC.md) — the source of truth.
2. [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — pipeline, modules, CSS architecture.
3. [`../docs/Project_Roadmap.md`](../docs/Project_Roadmap.md) — phase status and the active gate.
4. [`../src/app/dom.ts`](../src/app/dom.ts) — canonical DOM ids/classes (`IDS`, `CLASSES`, `ATTRS`, `PAGEDJS`); import these, never hardcode.
5. [`../src/app/settings.ts`](../src/app/settings.ts) — `Settings`, `DEFAULT_SETTINGS`, `MARGIN_MM`, migrate.
6. [`../src/app/state.ts`](../src/app/state.ts) — `DocStore` and `createRenderScheduler`.
7. [`../ACTION_ITEMS.md`](../ACTION_ITEMS.md) — human-only tasks; read first, flag OPEN items.

## Do not bulk-read

`node_modules/`, `dist/`, `.vite/`, lockfiles, generated build output, and `tests/fixtures/*`
content. Read fixtures only when changing the test that uses them.

## The one rule that overrides convenience

**Pagination runs last, exactly once**, after Shiki, markdown render, source build, Mermaid, and
fonts/images all settle (render order §3 of the spec). Never paginate before async content settles —
stale heights misplace breaks and break the no-slice guarantee.

## Seam table

| Seam | Files | Key invariants | Edit seam | Verify |
| --- | --- | --- | --- | --- |
| **render** | `src/render/markdown.ts`, `highlight.ts`, `math.ts`, `mermaid.ts`, `buildSource.ts` | `getHighlighter()` is a singleton; markdown render is **sync** (Shiki via `fromHighlighter` + inline KaTeX); plugin order: attrs/anchor before toc; share one `SLUGIFY`; Mermaid is async and `useMaxWidth:false`. | New markdown feature, theme pair, math macro, diagram handling, TOC/footnote source transform. | `tests/markdown.test.ts`, `highlight.test.ts`, `math.test.ts`, `mermaid.test.ts`, `buildSource.test.ts` (Vitest + jsdom). |
| **paginate** | `src/paginate/cssBuilder.ts`, `measure.ts`, `handler.ts`, `shrinkToFit.ts`, `paginate.ts`, `pagedjs.d.ts` | Single engine (Paged.js 0.4.3); `buildStylesheet` = `print.css?raw` + dynamic `@page`; register handlers once; fresh `Previewer` per run; tear down `.pagedjs_pages` + inserted styles before re-run; never shrink reflowing tables. | Break rules, `@page` block, page-area math, Tier-3 shrink, lifecycle hooks. | `tests/cssBuilder.test.ts`, `measure.test.ts` (unit); layout correctness only in E2E. |
| **export** | `src/export/print.ts`, `download.ts` | Both operate over the **same** paginated DOM; print is vector (primary), download rasterizes one canvas per `.pagedjs_page` (fallback); PDF is always dark-on-white; both dynamic-imported on user action. | Export quality, fallback page assembly, file naming. | `tests/export-download.test.ts` (page count); real output in E2E `export.spec.ts`. |
| **app-core** | `src/app/App.ts`, `state.ts`, `settings.ts`, `dom.ts`, `input.ts`, `sampleDoc.ts`, `main.ts` | `App.runPipeline` follows the render order exactly; only `Settings` persists (doc bytes never stored); debounce settings 120ms / content 250ms; re-paginate reuses the pristine clone. | Controller flow, settings shape/migration, file ingest/validation, scheduler. | `tests/settings.test.ts`, `input.test.ts`, `dom-contract.test.ts`. |
| **ui** | `src/ui/Toolbar.ts`, `Canvas.ts`, `EmptyState.ts`, `Banner.ts` | Each `mount*` returns a small handle; controls bind to `Settings` via `App.updateSettings`; use ids/classes from `dom.ts`; `aria-live` status; paginating overlay during reflow. | Toolbar controls, preview chrome, empty/error/recovery states, a11y. | `tests/dom-contract.test.ts`; flows in E2E `golden-path.spec.ts`, `empty-error.spec.ts`. |
| **styles** | `src/styles/app.css`, `preview.css`, `document.css`, `shiki.css`, `print.css` | `print.css` = static break rules, **no `@page`**, raw-imported into `cssBuilder`; `shiki.css` `@media print` forces light side; class names must match `dom.ts`. | Typography, callouts, TOC, footnotes, code colors, break rules. | `tests/dom-contract.test.ts` (name drift); visual checks in E2E. |
| **tests** | `tests/*.test.ts`, `tests/e2e/*.spec.ts`, `tests/helpers/pagedDom.ts`, `tests/fixtures/*` | Unit = pure/DOM-structure (jsdom); layout (`getBoundingClientRect`) is E2E only; `nocutoff.spec.ts` is the crown-jewel guarantee test. | New coverage for any seam above. | `npm run test` (unit), `npm run test:e2e` (Playwright/Chromium). |

## Cross-runtime note

Claude reads `.claude/skills/*/SKILL.md`; Codex follows the same intent via `AGENTS.md`. Keep
workflow intent aligned across both; see [`../docs/agentic/SKILL_REGISTRY.md`](../docs/agentic/SKILL_REGISTRY.md).
