# MDviewer — Project Roadmap

> Active phase status, priorities, and gates. Update this file when a phase's truth changes
> (use the `mdv-roadmap-sync` skill). Companion docs: [`PRODUCT_VISION.md`](./PRODUCT_VISION.md),
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`design/IMPLEMENTATION_SPEC.md`](./design/IMPLEMENTATION_SPEC.md).
>
> Last updated: 2026-08-08.

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

### P2 — UX polish — `IN PROGRESS`

- **Done (2026-08-16): the QA-sweep fixes.** A full manual QA pass (`mdviewerqareport.md`,
  run against the July deployment) drove a coordinated fix sweep: working zoom controls with
  true fit-to-width; a live, pinned page-position chip; visible warning banner / error card
  (plus a dom-contract rule making TS-authored classes without CSS a CI failure); Download-PDF
  progress, busy gating and completion feedback; per-page pagination progress + scroll-position
  restore across re-pagination; footnotes actually collected at the page foot (the
  `float: footnote` declaration must live in `buildStylesheet()` — new spec invariant);
  synthesized-TOC titles, placement and leader dots repaired; KaTeX error affordance; table
  cells wrap instead of clipping; visible task-list checkboxes; empty-document hint;
  beforeunload guard; close-document button; toolbar field styling; export buttons disabled
  with no document; keyboard-focusable preview; `logging: false` on the raster export.

- **Done (2026-08-08): the split workspace.** A Markdown source pane with Shiki syntax colors
  beside the paginated preview, three view modes (`Markdown` / `Split` / `Preview`), and a
  draggable, keyboard-operable divider. Typing paginates live through the unchanged render
  order; a dropped file is editable in place. Layout state is pure CSS — switching modes never
  re-renders — and `@media print` keeps the editing surface off the exported PDF. This
  **promotes the P4 "optional split editor" item on explicit owner request** and reverses the
  former "no editor pane" non-goal in [`PRODUCT_VISION.md`](./PRODUCT_VISION.md).
  Spec: `design/IMPLEMENTATION_SPEC.md` §12.
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
- **Done:** lazy-load Paged.js and PDF libraries. Entry chunk measured 1,595.86 kB on `main`
  at `0dbd8a2` and 1,602.49 kB with the split workspace (+6.6 kB / +0.4%). The earlier
  "~1.46 MB" figure predates later dependency updates and is superseded by these measurements.
- **Done:** tested dependency-free production server, one-command/one-click Windows launch, secure
  static-host headers, no public source maps, and deployment/runbook documentation.
- **Done:** public Cloudflare Pages deployment at **https://mdviewer-c9r.pages.dev/** (AI-4).
- **Done (2026-08-16):** installable PWA with full offline support — Workbox precache covering
  every lazy chunk and the KaTeX fonts, prompt-based updates, favicon/manifest icons, and
  OG/Twitter metadata; offline behavior proven by `tests/e2e/offline.spec.ts` on the
  production bundle.
- **Remaining:** profile very large documents before setting a production performance budget.

### P4 — Stretch — `DEFERRED`

Explicitly out of scope for now; revisit only after P1–P3 land.

- ~~Optional split editor / live-edit pane.~~ **Promoted to P2 and shipped 2026-08-08** on
  explicit owner request.
- Additional paper sizes and orientations.
- Custom user themes.

## Priorities

1. Land P1 and clear its exit gate — the no-slice guarantee is the product. **Done.**
2. P2 UX polish once the core path is trustworthy. **In progress** — the split workspace landed
   first because authoring in-app was an explicit owner request.
3. P3 hardening before claiming production readiness.
4. P4 stays deferred until explicitly reprioritized.
