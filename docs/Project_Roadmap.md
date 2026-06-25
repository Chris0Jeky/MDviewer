# MDviewer — Project Roadmap

> Active phase status, priorities, and gates. Update this file when a phase's truth changes
> (use the `mdv-roadmap-sync` skill). Companion docs: [`PRODUCT_VISION.md`](./PRODUCT_VISION.md),
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`design/IMPLEMENTATION_SPEC.md`](./design/IMPLEMENTATION_SPEC.md).
>
> Last updated: 2026-06-25.

## Status legend

`DONE` — complete and verified · `IN PROGRESS` — actively being built · `PLANNED` — accepted, not
started · `DEFERRED` — explicitly out of scope for now.

## Active gate

**Manual browser verification (Gate 3).** The no-slice guarantee and both export paths are
layout-dependent and cannot be fully cleared from an agent sandbox. They must be verified in a real
Chrome with the app running. Tracked as human action items in [`../ACTION_ITEMS.md`](../ACTION_ITEMS.md)
(AI-1, AI-2). No phase that depends on real-browser layout is `DONE` until those items are cleared.

## Phases

### P0 — Scaffolding — `DONE`

- Repository, git, and agentic tooling (`CLAUDE.md`, `AGENTS.md`, skills, `autodoc/AGENT_INDEX.md`).
- Build and test config: Vite 8, Vitest 4, TypeScript 6.0 (strict), ESLint 10, Playwright.
- Pinned design specs: `design/IMPLEMENTATION_SPEC.md`, `design/LIBRARY_NOTES.md`.
- Canonical seams committed: `src/app/dom.ts`, `src/app/settings.ts`, `src/app/state.ts`, the
  ambient type shims, `index.html`, and toolchain config.

### P1 — Core pipeline — `IN PROGRESS` (as of 2026-06-25)

The end-to-end path: **render → paginate → export**, delivering the **no-slice guarantee**.

- markdown-it stack (callouts, footnotes, anchors, TOC, task lists, attrs) with Shiki and KaTeX.
- Mermaid rendering to fixed-size SVG before pagination.
- `buildPaginationSource` (TOC injection, inline footnotes, fonts/images await).
- Paged.js engine: `cssBuilder`, `measure`, `handler`, `shrinkToFit`, `paginate`.
- Both export paths: print (vector) and download (rasterized fallback).
- App controller wiring the load-bearing render order; UI shell (toolbar, canvas, empty, banner).
- Unit tests for every pure/DOM-structure seam; the `nocutoff` E2E as the crown-jewel test.

**Exit gate:** unit + E2E green in CI **and** manual browser verification (AI-1) passes — a
code-heavy, math-and-diagram document exports with no block sliced across a page boundary, via both
export paths.

### P2 — UX polish — `PLANNED`

- Theme system refinement (light / dark / sepia screen themes; the six code-theme families).
- Toolbar grouping, control affordances, and keyboard operation.
- Empty-state, error, and recovery flows (aggregated warning banner, fatal error card).
- Accessibility: `aria-live` status, focus management, reduced-motion, contrast.

### P3 — Hardening — `PLANNED`

- Large-document performance (incremental page count, layout responsiveness, memory).
- Render-time budget and main-thread blocking mitigation.
- Broader Shiki language coverage and graceful unknown-language fallback.
- E2E suite running in CI on real Chromium (no-cutoff, golden-path, export, empty/error).
- Bundle size: initial chunk ~1.9 MB (KaTeX + markdown-it + Paged.js + Shiki core). Lazy-load
  Paged.js (`paginate.ts`) and the PDF libs (`download.ts`), and consider `manualChunks`, to cut
  first paint. Builds and runs fine today — an optimization, not a blocker.

### P4 — Stretch — `DEFERRED`

Explicitly out of scope for now; revisit only after P1–P3 land.

- Optional split editor / live-edit pane.
- Additional paper sizes and orientations.
- Custom user themes.

## Priorities

1. Land P1 and clear its exit gate — the no-slice guarantee is the product.
2. P2 UX polish once the core path is trustworthy.
3. P3 hardening before claiming production readiness.
4. P4 stays deferred until explicitly reprioritized.
