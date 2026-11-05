# MDviewer — Project Roadmap

> Active phase status, priorities, and gates. Update this file when a phase's truth changes
> (use the `mdv-roadmap-sync` skill). Companion docs: [`PRODUCT_VISION.md`](./PRODUCT_VISION.md),
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`design/IMPLEMENTATION_SPEC.md`](./design/IMPLEMENTATION_SPEC.md).
>
> Last updated: 2026-11-05.

## Status legend

`DONE` — implemented and verified · `IN PROGRESS` — implementation or acceptance remains ·
`PLANNED` — scoped, not started · `DESIGN FIRST` — behavior/ownership decision before implementation ·
`WAITING` — named external or human dependency · `DEFERRED` — deliberately later.

## Current delivery and next work

Verified application baseline: [main `203c0979`](https://github.com/Chris0Jeky/MDviewer/commit/203c09798b01061ceb0c00f0937c22beeafb1a55),
including merged #183/#187/#185/#188/#192/#178/#191/#193/#194. Postmerge
[CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053738540) and
[Windows Desktop](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244)
passed all five jobs. This is an application checkpoint, not a live deployment.

Use [Future work](FUTURE_WORK.md) / [#195](https://github.com/Chris0Jeky/MDviewer/issues/195)
for the ordered issue queue and acceptance criteria. Next: fix hidden-preview export
feedback (#200), design file ownership/Save semantics (#196), then coordinate optional
recovery design (#197). Formatting (#198), in-session navigation (#199), second-engine/
accessibility regressions (#203), bounded raster cancellation (#201), and measured
authoring performance (#202) are separately scoped work.

**#169 and AI-6/AI-7/AI-8/AI-9 remain OPEN.** Their human checklists are unchanged.
Current documents remain memory-only except explicit user-requested saves; planning
file/recovery features does not enable persistence. Proposed contracts now have concrete
[Save / Save As](design/FILE_LIFECYCLE.md) and [optional recovery](design/RECOVERY.md)
designs. Native compare/replace evidence and implementation remain outstanding.

## Active gate

**Gate 3 — `DONE`.** An installed-Chrome production run generated both export
paths and rendered all 14 PDF pages for visual inspection. That check found and fixed a primary
print regression that emitted only page 1; both paths now produce 7 clean A4 pages, backed by a real
Chrome PDF page-count regression test. The maintainer accepted this evidence and closed AI-1 in
[`../ACTION_ITEMS.md`](../ACTION_ITEMS.md).

## Phases

### P0 — Scaffolding — `DONE`

- Repository, git, and agentic tooling (`CLAUDE.md`, `AGENTS.md`, skills, `autodoc/AGENT_INDEX.md`).
- Build and test config: Vite 8, Vitest 5, TypeScript 6.0 (strict), ESLint 10, Playwright.
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

### P2 — Desktop authoring and UX — `IN PROGRESS`

- **Implementation prepared (2026-11-05): session positions/navigation #199.**
  Bounded ID-keyed source/preview/reader positions survive document switching,
  Undo Close and reader/workspace transfers while textarea undo stays isolated.
  Compact previous/next controls and Windows/Linux shortcuts preserve native
  Apple Option behavior. See `design/SESSION_NAVIGATION.md`; final hosted checks
  and independent review remain required before merge.
- **Implementation prepared (2026-11-05): authoring quality #203.** A bounded
  production Firefox lane reuses actual editor/undo/search/shortcut and desktop
  New/layout tests. New accessibility tests cover keyboard focus and state,
  composition guards, short reflow and forced-colors Find. Forced colors now use
  native system text and an outlined match cue. Exact-head CI/review is required
  before merge; this automation does not clear AI-6 or Windows acceptance #169.
  Coverage and local environment limits: `design/AUTHORING_QUALITY.md`.
- **Done (2026-11-05): export feedback [#210](https://github.com/Chris0Jeky/MDviewer/pull/210).** A compact shell
  status row remains visible in Markdown, Split, Preview and short-window Find.
  It reports actual completed pages and native-save/browser-handoff outcomes with
  bounded polite announcements, specific failure detail and preserved focus/source.
  Exact-head Chromium, Node and native Windows checks and independent review passed;
  see `design/EXPORT_STATUS.md`.

- **Done (2026-11-05): desktop authoring entry and space.**
  [New document #183](https://github.com/Chris0Jeky/MDviewer/pull/183) adds New from
  the reader/workspace and Ctrl/Cmd+N, preserving existing documents, native admission,
  lazy workspace entry and Save Copy semantics. [#187](https://github.com/Chris0Jeky/MDviewer/pull/187)
  starts desktop Document layout collapsed while retaining settings, keyboard operation
  and the web default. Production desktop checks cover useful writing height, stable
  source/page state and screenshots at laptop and narrow-window sizes.
- **Done (2026-11-05): source edit ownership.**
  [#185](https://github.com/Chris0Jeky/MDviewer/pull/185) fences delayed paste/drop and
  range replacements to their original document, value, selection and focus. Fresh
  textarea identity boundaries isolate native undo; passive updates and first-input
  adoption preserve it. These three authoring PRs are merged in main `f0faf7c6`.
- **Done (2026-11-05): Find/Replace [#188](https://github.com/Chris0Jeky/MDviewer/pull/188),
  closes #182.** Literal search, keyboard navigation, bounded results and guarded
  replacements use the native edit seam. Reviewed head `c5733297` passed all five
  jobs, including 123 web and 27 desktop browser cases, and merged as main `4976f289`.
- **Done (2026-11-05): active-match visibility [#191](https://github.com/Chris0Jeky/MDviewer/pull/191),
  closes #189; merge `280c73e2`.** A visible source-match cue keeps Find focused while
  preserving source, native undo and editor geometry. Screenshot review caught the
  original large-source misalignment; measured line height and stronger geometry
  checks corrected it. All five reviewed-head jobs passed: 830 units, 130 web cases
  with five optional skips, 27 desktop cases, and 22 Rust tests plus native smoke.
  Independent source/screenshot review verified the corrected alignment and source TREE.
- **Done (2026-11-05): workspace readiness [#192](https://github.com/Chris0Jeky/MDviewer/pull/192),
  closes #190; merge `7f6db5d2`.** A postmerge native smoke exposed enabled Save
  controls before entry finished, while the transition guard still discarded clicks.
  Entry now stays inert through rendering and releases readiness before focus.
  Delayed-render regressions and 803 local units pass. Reviewed head `a54b1ef5` passed
  all five hosted jobs; actual native smoke verified two Save dialogs, exact Markdown,
  PDF header/EOF and clean teardown. The correction is inherited by current main.
  AI-6/AI-7/AI-8/AI-9 and Windows acceptance/performance #169 remain open.

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
  Plus: a `titlePage` setting gating the `@page :first` chrome; `string(doctitle, start)` so
  pushed content keeps its own section's running header; and the paper made permanently
  print-accurate — rendered code has no screen dark variant, the "Screen" theme control is
  visibly labelled and moved beside Export.
- **Done (2026-09-26):** responsive toolbar (QA TECH-1, closed). The workspace
  refresh had already fixed the overflow half; what remained was vertical bulk — a
  347px wrapped toolbar over a 192px preview on a 375x667 phone with a document
  loaded. The primary row is now a single-row horizontal strip at the existing
  760px toolbar breakpoint (toolbar 204px, workspace 463px), covered by
  `tests/e2e/responsive-toolbar.spec.ts`. No P2 QA-sweep items remain.

- **Done (2026-08-08): the split workspace.** A Markdown source pane with Shiki syntax colors
  beside the paginated preview, three view modes (`Markdown` / `Split` / `Preview`), and a
  draggable, keyboard-operable divider. Typing paginates live through the unchanged render
  order; a dropped file is editable in place. Layout state is pure CSS — switching modes never
  re-renders — and `@media print` keeps the editing surface off the exported PDF. This
  **promotes the P4 "optional split editor" item on explicit owner request** and reverses the
  former "no editor pane" non-goal in [`PRODUCT_VISION.md`](./PRODUCT_VISION.md).
  Spec: `design/IMPLEMENTATION_SPEC.md` §12.
- **Planned writing improvements:** compact formatting commands [#198](https://github.com/Chris0Jeky/MDviewer/issues/198) and bounded in-session position/keyboard navigation [#199](https://github.com/Chris0Jeky/MDviewer/issues/199).
- **Confirmed feedback gap:** [#200](https://github.com/Chris0Jeky/MDviewer/issues/200) keeps existing PDF progress visible and exposed when the preview is hidden; fatal-error recovery and ordinary preview progress already ship.
- **Design first:** file ownership/Save/Save As [#196](https://github.com/Chris0Jeky/MDviewer/issues/196), then optional recovery [#197](https://github.com/Chris0Jeky/MDviewer/issues/197). Existing Save Copy and in-memory Undo Close behavior remain current until a reviewed implementation changes them.
- **Acceptance and regressions:** second-engine/accessibility automation [#203](https://github.com/Chris0Jeky/MDviewer/issues/203), with manual typing, Narrator and Windows acceptance retained in AI-6/#169. Existing themes, toolbar disclosure and empty/error flows are implemented, not unstarted features.

### P3 — Hardening and distribution — `IN PROGRESS`

- **Experimental Windows distribution (merged 2026-11-05, #158):** a Tauri/WebView2 host opens local
  Markdown in a continuous reader, with a lazy transition to the existing editing/PDF
  workspace. Includes bounded file handling, single-instance forwarding, a per-user
  installer, a portable artifact and Windows process-tree measurements in CI. This is
  a separate entry point; it does not replace the web/PWA build. The native smoke
  verifies actual Markdown/PDF saves, and #162 defers the reader's highlighting engine
  until a document needs supported code highlighting or Shiki notation. #172 selectively
  prepares reader grammars while preserving embedded-language compatibility and the
  editing workspace's eager common-grammar readiness. Native acceptance
  on an ordinary desktop and comparative memory targets remain open in
  [#169](https://github.com/Chris0Jeky/MDviewer/issues/169). See
  [`WINDOWS_DESKTOP.md`](WINDOWS_DESKTOP.md) and `design/WINDOWS_READER.md`.
- **Done (2026-11-05): offline raster capture [#178](https://github.com/Chris0Jeky/MDviewer/pull/178),
  closes #174; merge `85f7361e`.** Main pins html2canvas-pro 2.6.0 and removes its narrow
  temporary Dependabot exclusion. Final reviewed head `a9664f9b` passed all five jobs:
  818 units, **127 web cases with five existing optional performance skips**, 27 desktop
  cases, and 22 Rust tests plus real native smoke. Saved-PDF pixels, damaged-output
  controls and real CSS/font cache-loss refusal/cleanup/recovery pass. Review inspected
  persisted recovery JSON, the matching source artifact/TREE, both native Save dialogs,
  exact Markdown bytes and PDF header/EOF with clean teardown. See
  [offline capture evidence](design/RASTER_OFFLINE_CAPTURE.md). Human cross-engine,
  live/PWA and representative Windows acceptance remain separate open gates.
- **Done (2026-11-05): Shiki 4.6 [#193](https://github.com/Chris0Jeky/MDviewer/pull/193), merge `5fbb219c`.** The real compressed WASM loader is qualified with a test-only jsdom byte-stream compatibility bridge. The generated WASM JavaScript asset is smaller; this does not establish representative runtime performance. Both Node lanes pass 832 units at the final combined application checkpoint.
- **Measured responsiveness:** [#202](https://github.com/Chris0Jeky/MDviewer/issues/202) refreshes the existing performance ladder and profiles authoring bottlenecks. Incremental page feedback already ships; whole-process native comparisons and budgets stay in #169.
- **Export lifetime:** [#201](https://github.com/Chris0Jeky/MDviewer/issues/201) designs bounded cancellation beyond the current per-phase CSS/font/frame deadlines. Offline output qualification is already complete.
- **Done:** sanitize untrusted raw HTML, CSS resource URLs (including escaped/obfuscated forms),
  embedded images, and Mermaid SVG output.
- **Done:** Mermaid fences bypass Shiki and render to sanitized, styled SVG text across flowchart and
  non-flowchart diagrams; remote URLs in SVG presentation attributes are removed and diagram output
  remains light so screen-theme changes cannot degrade printed PDFs.
- **Done:** broader Shiki language coverage via parsed-fence preparation and on-demand
  curated grammar chunks, with graceful unknown-language fallback. Merged #177 aligns
  workspace preparation with the actual decoded tokens; reader selection is covered by #172.
- **Done:** E2E suite in CI on real Chromium (no-cutoff, golden-path, export, empty/error), plus
  configurable isolated ports to prevent stale-server false positives. Stable source atomic IDs now
  detect short logical blocks incorrectly split into individually well-fitting page fragments.
- **Done:** lazy-load Paged.js and PDF libraries. Entry chunk measured 1,595.86 kB on `main`
  at `0dbd8a2` and 1,602.49 kB with the split workspace (+6.6 kB / +0.4%). The earlier
  "~1.46 MB" figure predates later dependency updates and is superseded by these measurements.
- **Done:** tested dependency-free production server, one-command/one-click Windows launch, secure
  static-host headers, no public source maps, and deployment/runbook documentation.
- **Done:** public Cloudflare Pages deployment at **https://mdviewer-c9r.pages.dev/** (AI-4).
- **Done (2026-08-16):** installable PWA with offline app-shell/rendering support — Workbox precache covering
  every lazy chunk and the KaTeX fonts, prompt-based updates, favicon/manifest icons, and
  OG/Twitter metadata; offline behavior proven by `tests/e2e/offline.spec.ts` on the
  production bundle. Production-Chromium saved-PDF visual and CSS/font recovery
  qualification completed in #178 (closes #174); live/PWA and second-engine human
  acceptance remain open in AI-7 and AI-6.
- **Done (2026-09-26):** profiled very large documents and set the production
  performance budget (`docs/PERF_BUDGET.md`): deterministic generator
  (`tests/perf/generateLargeDoc.ts`) plus an opt-in Playwright ladder
  (`tests/e2e/large-doc-perf.spec.ts`, `MDVIEWER_PERF=1`) measuring 67–1206
  pages in 2.3 s–3.7 min on the reference machine, with per-band wall-time,
  responsiveness (longtask) and memory (JS heap, DOM nodes) budgets. The soft
  gate drops 2 MB → 250 kB and now guards file, window-paste and editor
  paste/drop ingestion, so the confirm dialog covers the minutes-scale band
  the ladder revealed.
- **Done (2026-09-27):** reviewed CI-compatible direct-upload path for the existing Pages
  project — `.github/workflows/deploy.yml` keeps live dispatch main-only and uses a separate,
  credential-free dry job for reviewed branches. The producer builds once and hands the exact
  Chromium-tested artifact plus checked file manifest to each consumer. Real dry dispatch
  acceptance passed on 2026-10-02 at `25d3cca` in runs
  [37075799089](https://github.com/Chris0Jeky/MDviewer/actions/runs/37075799089) and
  [37076144920](https://github.com/Chris0Jeky/MDviewer/actions/runs/37076144920): live skipped,
  no approvals or new production records, same producer artifact ID/digest verified.
  Wrangler 4.114.0 and post-upload SHA confirmation
  remain pinned/documented in `docs/DEPLOYMENT.md` "Automated deploy". Production
  promotion (the dispatch itself, plus the `production` environment's required
  reviewers and main-only branch policy) and credentials (Cloudflare secrets scoped
  to that environment) remain separate human gates, tracked as AI-9; the first live
  run is the operator's proof step.
- **Blocked (MD2):** prepare canonical-origin metadata and base-path acceptance only after a hostname
  has been selected and ownership verified.
- **Done (2026-09-27):** render/export and runtime-egress contracts re-proven —
  `offline.spec.ts` (render + paginate with the network cut, zero cross-origin
  requests, positive offline proof) and `export-offline.spec.ts` (both export paths
  with the network cut, egress re-asserted after each export) in CI, plus a two-part
  production-egress proof: `tests/pulse-egress.test.ts` pins the vendored SDK to
  collector-only fetch in CI (the SDK is inert under automation by design, so no live
  probe can observe its beacons), while `scripts/smoke-egress.mjs` proves per-deploy
  against the immutable URL that the app itself requests nothing cross-origin, with
  the verdict recorded in `docs/DEPLOYMENT.md`. No document upload, converter backend
  or new runtime network path exists.

### P4 — Stretch — `DEFERRED`

Explicitly out of scope for now; revisit only after P1–P3 land.

- ~~Optional split editor / live-edit pane.~~ **Promoted to P2 and shipped 2026-08-08** on
  explicit owner request.
- Additional paper sizes and orientations.
- Custom user themes.

## Priorities

1. Preserve the shipped no-slice, sanitization, edit-ownership and export-lifetime contracts.
2. Fix the confirmed export-feedback gap (#200); review the next file-lifecycle design (#196) before changing Save behavior.
3. Add bounded writing/navigation improvements (#198/#199) and accessibility/second-engine regressions (#203); coordinate optional recovery design (#197) with file identity.
4. Qualify cancellation (#201) and improve measured authoring bottlenecks (#202). Keep representative native acceptance and efficiency evidence in #169.
5. Resolve the remaining ledger-backed follow-ups in [Future work](FUTURE_WORK.md), including Unicode IDs, the upstream SDK issue and the explicitly deferred pagination trade-off.
6. Keep P4 options, canonical-host selection and human release/deployment decisions explicit; do not infer their completion from green CI.
