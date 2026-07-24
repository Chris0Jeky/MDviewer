# MDviewer — Project Roadmap

> Active phase status, priorities, and gates. Update this file when a phase's truth changes
> (use the `mdv-roadmap-sync` skill). Companion docs: [`PRODUCT_VISION.md`](./PRODUCT_VISION.md),
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`design/IMPLEMENTATION_SPEC.md`](./design/IMPLEMENTATION_SPEC.md).
>
> Last updated: 2026-07-24.

## Status legend

`DONE` — complete and verified · `IN PROGRESS` — actively being built · `PLANNED` — accepted, not
started · `DEFERRED` — explicitly out of scope for now.

## Active gate

**Gate 3 — `DONE`.** An installed-Chrome production run generated both export
paths and rendered all 14 PDF pages for visual inspection. That check found and fixed a primary
print regression that emitted only page 1; both paths now produce 7 clean A4 pages, backed by a real
Chrome PDF page-count regression test. The maintainer accepted this evidence and closed AI-1 in
[`../ACTION_ITEMS.md`](../ACTION_ITEMS.md).

## Phases

### P0 — Scaffolding — `DONE`

- Repository, git, and agentic tooling (`CLAUDE.md`, `AGENTS.md`, skills, `autodoc/AGENT_INDEX.md`).
- Build and test config: Vite 8, Vitest 4, TypeScript 6.0 (strict), ESLint 10, Playwright.
- Pinned design specs: `design/IMPLEMENTATION_SPEC.md`, `design/LIBRARY_NOTES.md`.
- Canonical seams committed: `src/app/dom.ts`, `src/app/settings.ts`, `src/app/state.ts`, the
  ambient type shims, `index.html`, and toolchain config.

### P1 — Core pipeline — `DONE` (as of 2026-07-24)

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

### P3 — Hardening and distribution — `IN PROGRESS`

- Large-document performance (incremental page count, layout responsiveness, memory).
- Render-time budget and main-thread blocking mitigation.
- **Done:** sanitize untrusted raw HTML, CSS resource URLs (including escaped/obfuscated forms),
  embedded images, and Mermaid SVG output.
- **Done:** Mermaid fences bypass Shiki and render to sanitized, styled SVG text across flowchart and
  non-flowchart diagrams; remote URLs in SVG presentation attributes are removed and diagram output
  remains light so screen-theme changes cannot degrade printed PDFs.
- **Done:** broader Shiki language coverage via pre-scan + on-demand curated grammar chunks, with
  graceful unknown-language fallback.
- **Done:** E2E suite in CI on real Chromium (no-cutoff, golden-path, export, empty/error), plus
  configurable isolated ports to prevent stale-server false positives. Stable source atomic IDs now
  detect short logical blocks incorrectly split into individually well-fitting page fragments.
- **Done:** lazy-load Paged.js and PDF libraries; entry chunk reduced from ~1.97 MB to ~1.46 MB.
- **Done:** tested dependency-free production server, one-command/one-click Windows launch, secure
  static-host headers, no public source maps, and deployment/runbook documentation.
- **Done:** public Cloudflare Pages deployment at **https://mdviewer-c9r.pages.dev/** (AI-4).
- **Remaining:** profile very large documents before setting a production performance budget.

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
