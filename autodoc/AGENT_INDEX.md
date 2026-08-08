# MDviewer — Agent Index

> Fast code-seam map for agents. The goal: find the right file and its invariants **without**
> bulk-reading the repo. For the full canonical detail, read
> [`../docs/design/IMPLEMENTATION_SPEC.md`](../docs/design/IMPLEMENTATION_SPEC.md) (pinned signatures,
> render order, CSS/DOM names, no-slice tiers) and
> [`../docs/design/LIBRARY_NOTES.md`](../docs/design/LIBRARY_NOTES.md) (version-correct snippets).

## Start here

1. [`../ACTION_ITEMS.md`](../ACTION_ITEMS.md) — human-only tasks; read first, flag every OPEN item.
2. [`../AGENTS.md`](../AGENTS.md) — authority order, safety floor, worktree and review rules.
3. [`../ORCHESTRATOR.md`](../ORCHESTRATOR.md) — resumable live state, exact evidence, queue, and next work.
4. [`../docs/Project_Roadmap.md`](../docs/Project_Roadmap.md) — phase status and the active gate.
5. [`../docs/design/IMPLEMENTATION_SPEC.md`](../docs/design/IMPLEMENTATION_SPEC.md) — source of truth for signatures and render order.
6. [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — pipeline, modules, CSS architecture.
7. [`../src/app/dom.ts`](../src/app/dom.ts) — canonical DOM ids/classes (`IDS`, `CLASSES`, `ATTRS`, `PAGEDJS`); import these, never hardcode.
8. [`../src/app/settings.ts`](../src/app/settings.ts) — `Settings`, `DEFAULT_SETTINGS`, `MARGIN_MM`, migrate.
9. [`../src/app/state.ts`](../src/app/state.ts) — `DocStore` and `createRenderScheduler`.

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
| **render** | `src/render/markdown.ts`, `sanitize.ts`, `highlight.ts`, `math.ts`, `mermaid.ts`, `buildSource.ts` | `getHighlighter()` is a singleton; pre-scan and await curated fenced grammars before the **sync** markdown render; Mermaid fences bypass Shiki; sanitize before DOM insertion and apply the narrower SVG-style policy after Mermaid; automatic remote-resource loads, including obfuscated CSS URLs, are forbidden; plugin order: attrs/anchor before toc; share one `SLUGIFY`; Mermaid uses SVG-native labels, `useMaxWidth:false`, and a stable light print theme. | New markdown feature, curated language loader, HTML/resource policy, theme pair, math macro, diagram handling, TOC/footnote source transform. | `tests/markdown.test.ts`, `highlight.test.ts`, `math.test.ts`, `mermaid.test.ts`, `buildSource.test.ts` (Vitest + jsdom) and real Mermaid assertions in `golden-path.spec.ts`. |
| **paginate** | `src/paginate/cssBuilder.ts`, `measure.ts`, `handler.ts`, `shrinkToFit.ts`, `paginate.ts`, `pagedjs.d.ts` | Single engine (Paged.js 0.4.3); `buildStylesheet` = `print.css?raw` + dynamic `@page`; register handlers once; fresh `Previewer` per run; tear down `.pagedjs_pages` + inserted styles before re-run; stamp source atomic identities before pagination; never shrink reflowing tables. | Break rules, `@page` block, page-area math, Tier-3 shrink, lifecycle hooks. | `tests/cssBuilder.test.ts`, `measure.test.ts`, `buildSource.test.ts`; `nocutoff.spec.ts` verifies geometry **and** logical block identity across pages. |
| **export** | `src/export/print.ts`, `download.ts` | Both operate over the **same** paginated DOM; print is vector (primary), download rasterizes one canvas per `.pagedjs_page` (fallback); PDF is always dark-on-white; both dynamic-imported on user action. | Export quality, fallback page assembly, file naming. | `tests/export-download.test.ts` (page count); real output in E2E `export.spec.ts`. |
| **app-core** | `src/app/App.ts`, `state.ts`, `settings.ts`, `dom.ts`, `input.ts`, `sampleDoc.ts`, `main.ts` | `App.runPipeline` follows the render order exactly; only `Settings` persists (doc bytes never stored, editor text included); debounce settings 120ms / content 250ms; re-paginate reuses the pristine clone; `DocStore` emits `"change"` for identity and `"text"` for in-place edits; `viewMode`/`splitRatio` are validated in `migrateSettings`, not merely spread. | Controller flow, settings shape/migration, file ingest/validation, scheduler, the editor write path. | `tests/settings.test.ts`, `state.test.ts`, `input.test.ts`, `dom-contract.test.ts`. |
| **ui** | `src/ui/Toolbar.ts`, `Canvas.ts`, `EmptyState.ts`, `Banner.ts` | Each `mount*` returns a small handle; controls write through `App.updateSettings` and subscribe via `onSettingsChange` so visual/accessible state also follows programmatic updates; use ids/classes from `dom.ts`; `aria-live` status; paginating overlay during reflow. | Toolbar controls, preview chrome, empty/error/recovery states, a11y. | `tests/dom-contract.test.ts`; flows in E2E `golden-path.spec.ts`, `empty-error.spec.ts`. |
| **workspace / editor** | `src/ui/Editor.ts`, `Splitter.ts`, `src/styles/editor.css`, `App.onEditorInput`, `DocStore.updateText` | All three panes stay mounted — `data-view-mode` on `#workspace` only shows/hides columns, so a mode switch never re-renders or loses state; `viewMode`/`splitRatio` are **not** reflow keys (page geometry is mm-based, not canvas-based); the backdrop `<pre>` and the `<textarea>` must keep identical font/size/line-height/padding/wrapping or the colors drift off the glyphs; token text goes in via `textContent`, never `innerHTML`; `updateText` emits `"text"` (not `"change"`) so identity UI does not churn per keystroke; `@media print` must hide the pane and the divider. | Source-pane behaviour, syntax backdrop, view modes, split sizing, the typing→preview loop. | `tests/editor.test.ts`, `splitter.test.ts`, `state.test.ts`, `dom-contract.test.ts`; real layout + print media in E2E `editor.spec.ts`. |
| **distribution** | `scripts/start.mjs`, `serve.mjs`, `serve.test.mjs`, `run-python.mjs`, `public/_headers`, `docs/DEPLOYMENT.md` | Production server binds to loopback by default; traversal stays inside `dist`; extensionless routes alone use SPA fallback; hashed assets are immutable; public builds omit source maps unless opted in. | Local launcher/server, static-host policy, remote-access documentation, cross-platform tooling. | `npm run test:serve`, `npm run build`, then inspect `dist` for source maps; browser smoke through `npm run serve`. |
| **styles** | `src/styles/app.css`, `preview.css`, `document.css`, `shiki.css`, `print.css` | `print.css` = static break rules, **no `@page`**, raw-imported into `cssBuilder`; `shiki.css` `@media print` forces light side; class names must match `dom.ts`. | Typography, callouts, TOC, footnotes, code colors, break rules. | `tests/dom-contract.test.ts` (name drift); visual checks in E2E. |
| **tests** | `tests/*.test.ts`, `tests/e2e/*.spec.ts`, `tests/helpers/pagedDom.ts`, `tests/fixtures/*` | Unit = pure/DOM-structure (jsdom); layout (`getBoundingClientRect`) is E2E only; `nocutoff.spec.ts` is the crown-jewel guarantee test. | New coverage for any seam above. | `npm run test` (unit), `npm run test:e2e` (Playwright/Chromium). |

## Cross-runtime note

Claude reads `.claude/skills/*/SKILL.md`; Codex follows the same intent via `AGENTS.md`. Keep
workflow intent aligned across both; see [`../docs/agentic/SKILL_REGISTRY.md`](../docs/agentic/SKILL_REGISTRY.md).
