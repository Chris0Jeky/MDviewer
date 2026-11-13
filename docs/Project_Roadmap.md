# MDviewer — Project Roadmap

> Active phase status, priorities, and gates. Update this file when a phase's truth changes
> (use the `mdv-roadmap-sync` skill). Companion docs: [`PRODUCT_VISION.md`](./PRODUCT_VISION.md),
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`design/IMPLEMENTATION_SPEC.md`](./design/IMPLEMENTATION_SPEC.md).
>
> Last updated: 2026-11-12 (Readable data and Actionable Markdown status; other sections as of 2026-11-05).

## Status legend

`DONE` — implemented and verified · `IN PROGRESS` — implementation or acceptance remains ·
`PLANNED` — scoped, not started · `DESIGN FIRST` — behavior/ownership decision before implementation ·
`WAITING` — named external or human dependency · `DEFERRED` — deliberately later.

## Current delivery and next work

Qualified application revision: [`18afeeb8`](https://github.com/Chris0Jeky/MDviewer/commit/18afeeb8df7f7448d5241de50ff00db1d56f9697). The [editor follow-up checkpoint](design/2026-11-05-editor-followup-checkpoint.md)
records the merged PRs, exact-head review, all six hosted jobs and the matching
Windows executable/source evidence. This is application qualification; the live
site retains its separate deployment record.

Use [Future work](FUTURE_WORK.md) / [#195](https://github.com/Chris0Jeky/MDviewer/issues/195)
for the next implementation work. Windows Save/Save As (#196) shipped with the conflict-safe
replace (S1a #226) and owned Save/Save As (S1b #231); the optional recovery contract #197 stays
parked; design bounded raster
cancellation #201 and profile measured authoring bottlenecks #202. Unicode heading
identity #204, upstream engagement accounting #206 and pagination whitespace
research #205 remain separate.

[Actionable Markdown v1](design/ACTIONABLE_MARKDOWN.md) joined the companion push on 2026-11-11
(owner: "Yes, add it"): clickable marks, choices, fields and status chips written back byte-exact,
in slices A1–A5. A1 to A4 are merged on main (see P2); A5 ([#300](https://github.com/Chris0Jeky/MDviewer/issues/300)) is later.

[Readable data v1](design/READABLE_DATA.md) (owner request, 2026-11-12) opens data files as a
readable view derived on the device. D0 to D4 and the D6 readability pass are merged on main, and JSON,
JSON Lines, YAML, TOML, CSV, TSV and plain text open as readable views; D5 (copy) is next (see P2).

**#169 and AI-6/AI-7/AI-8/AI-9 remain open** (AI-6, AI-7, AI-8, AI-10 and the hands-on #169 boxes are delegated to agent QA by owner decision 2026-11-13, not accepted; AI-9 and the #169 signing decision stay with the owner). Documents remain in memory except
explicit user-requested saves. [Save / Save As](design/FILE_LIFECYCLE.md) and
[optional recovery](design/RECOVERY.md) designs merged in #209; no in-place writes
or recovery storage were implemented by that design PR.

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

- **Done (2026-11-05): Markdown writing commands [#211](https://github.com/Chris0Jeky/MDviewer/pull/211), closes #198.**
  A collapsed Format disclosure and source-only shortcuts provide eleven guarded
  commands, native Undo, placeholder selections and conservative boundary refusal.
  Both editing panels remain usable in a 560×420 desktop window. See
  `design/MARKDOWN_COMMANDS.md` and the final checkpoint for qualification.
- **Done (2026-11-05): session navigation [#212](https://github.com/Chris0Jeky/MDviewer/pull/212), closes #199.**
  Bounded ID-keyed source/preview/reader positions survive switching, Undo Close and
  reader/workspace transfers while native undo stays isolated. Equal filenames
  are distinguished; Windows/Linux shortcuts leave Apple Option typing alone.
  Near-end restoration uses final outline geometry and a stable reader box model.
- **Done (2026-11-05): authoring quality [#208](https://github.com/Chris0Jeky/MDviewer/pull/208), closes #203.**
  A production Firefox lane covers real editing, focus/state, composition guards,
  short reflow and forced colors alongside Chromium and native Windows. The source
  uses system text colors and an outlined Find cue in high-contrast mode. This
  automation does not clear AI-6 or #169; see `design/AUTHORING_QUALITY.md`.
- **Done (2026-11-05): authored heading isolation [#213](https://github.com/Chris0Jeky/MDviewer/pull/213).**
  Shell CSS and feedback lookups follow actual application parents, preserving
  authored headings named Workspace, Error card, Status live and other chrome names
  in normal, forced-color and print output. Unicode ID semantics remain #204.
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
- **Done (2026-11-12): Actionable Markdown, A1 to A4** ([contract](design/ACTIONABLE_MARKDOWN.md)).
  A1 [#252](https://github.com/Chris0Jeky/MDviewer/pull/252) parser, fixtures and static controls (spec
  [#247](https://github.com/Chris0Jeky/MDviewer/pull/247)); A2 [#244](https://github.com/Chris0Jeky/MDviewer/pull/244)
  native line patch, byte-exact and conflict-checked; A3 [#263](https://github.com/Chris0Jeky/MDviewer/pull/263)
  interaction with write-back and Undo. [#268](https://github.com/Chris0Jeky/MDviewer/pull/268) fixed the
  1-based line placement that made every native write-back refuse ([#266](https://github.com/Chris0Jeky/MDviewer/issues/266),
  closed); the native A3 smoke [#275](https://github.com/Chris0Jeky/MDviewer/pull/275) now toggles a
  checkbox in a CRLF file and Undoes it against the real host with exact bytes. Human acceptance on real files
  is AI-10. **A4 templates:** the native template read
  [#285](https://github.com/Chris0Jeky/MDviewer/pull/285), the picker/command
  [#286](https://github.com/Chris0Jeky/MDviewer/pull/286) and its wiring
  [#295](https://github.com/Chris0Jeky/MDviewer/pull/295) are merged: New from template reads a pinned project's
  `templates/` folder. **Later:** A5 embeddable element ([#300](https://github.com/Chris0Jeky/MDviewer/issues/300)).
  Open follow-ups: [#254](https://github.com/Chris0Jeky/MDviewer/issues/254).
- **In progress (2026-11-12): Readable data, D0 to D4 and D6 merged** ([contract](design/READABLE_DATA.md)).
  Merged: D0 spec [#269](https://github.com/Chris0Jeky/MDviewer/pull/269); D1 JSON, JSON Lines and
  plain text [#270](https://github.com/Chris0Jeky/MDviewer/pull/270); D2 conversation lens
  [#273](https://github.com/Chris0Jeky/MDviewer/pull/273); D3 native open/save
  [#272](https://github.com/Chris0Jeky/MDviewer/pull/272) and webview
  [#280](https://github.com/Chris0Jeky/MDviewer/pull/280) (Read, Edit, PDF); D4 YAML, TOML, CSV and TSV
  parsers [#281](https://github.com/Chris0Jeky/MDviewer/pull/281), native extensions
  [#284](https://github.com/Chris0Jeky/MDviewer/pull/284) and webview
  [#288](https://github.com/Chris0Jeky/MDviewer/pull/288); relative links open Markdown only
  [#283](https://github.com/Chris0Jeky/MDviewer/pull/283); the D6 readability pass
  [#293](https://github.com/Chris0Jeky/MDviewer/pull/293) (small objects and lists inline, record tables with
  flattened columns and a Line column for JSON Lines, details only for embedded JSON, clear Markdown or block
  prose); the Library lists agent data files and skips `.claude/worktrees`
  [#290](https://github.com/Chris0Jeky/MDviewer/pull/290). The Windows app opens `.json`, `.jsonc`, `.jsonl`,
  `.ndjson`, `.yaml`, `.yml`, `.toml`, `.csv`, `.tsv`, `.txt` and `.log` as readable views. D5 pure copy
  module [#289](https://github.com/Chris0Jeky/MDviewer/pull/289) is merged; the D5 webview copy menu
  and Save readable view as Markdown [#299](https://github.com/Chris0Jeky/MDviewer/issues/299) are merged. Open
  issues: [#276](https://github.com/Chris0Jeky/MDviewer/issues/276), [#277](https://github.com/Chris0Jeky/MDviewer/issues/277),
  [#278](https://github.com/Chris0Jeky/MDviewer/issues/278), [#282](https://github.com/Chris0Jeky/MDviewer/issues/282),
  [#291](https://github.com/Chris0Jeky/MDviewer/issues/291), [#292](https://github.com/Chris0Jeky/MDviewer/issues/292)
  and [#296](https://github.com/Chris0Jeky/MDviewer/issues/296).
- **Merged (2026-11-12): S9 performance and polish.** Part 1 (tab switch back in about 50 ms, one sanitizer
  pass for code blocks) [#294](https://github.com/Chris0Jeky/MDviewer/pull/294) is merged. The polish pass
  [#298](https://github.com/Chris0Jeky/MDviewer/pull/298) is merged. Part 2
  [#297](https://github.com/Chris0Jeky/MDviewer/pull/297) (native start-up numbers, first frame in the theme
  colour from a bundled stylesheet, with a guard against inline style in `desktop.html`) is merged. Next:
  [#301](https://github.com/Chris0Jeky/MDviewer/issues/301) (data views after D6),
  [#302](https://github.com/Chris0Jeky/MDviewer/issues/302) (native window background and closable during a
  slow start; Core halves #304 and #305) and [#306](https://github.com/Chris0Jeky/MDviewer/issues/306) (clippy).
- **File lifecycle:** Windows Save/Save As [#196](https://github.com/Chris0Jeky/MDviewer/issues/196)
  shipped through the conflict-safe replace (S1a #226) and owned Save/Save As (S1b #231); Save Copy
  stays the explicit copy. Optional recovery [#197](https://github.com/Chris0Jeky/MDviewer/issues/197)
  is parked: it still requires fault/restart/deletion and overhead evidence.
- **Human acceptance pending:** typing feel, Narrator and ordinary Windows behavior
  remain in AI-6/#169. The delivered automation supplies regression evidence only.

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
- **Done (2026-11-05): Shiki 4.6 [#193](https://github.com/Chris0Jeky/MDviewer/pull/193), merge `5fbb219c`.** The real compressed WASM loader is qualified with a test-only jsdom byte-stream compatibility bridge. The generated WASM JavaScript asset is smaller; this does not establish representative runtime performance. Both Node lanes passed 832 units at the historical `203c0979` application checkpoint.
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
2. Keep the shipped Windows Save/Save As (#196: S1a #226, S1b #231) conflict-safe as new document kinds arrive.
3. Implement and fault-test the reviewed opt-in recovery design (#197, parked), coordinated with file identity, revocation and storage limits.
4. Qualify cancellation (#201) and improve measured authoring bottlenecks (#202). Keep representative native acceptance and efficiency evidence in #169.
5. Resolve the remaining ledger-backed follow-ups in [Future work](FUTURE_WORK.md), including Unicode IDs, the upstream SDK issue and the explicitly deferred pagination trade-off.
6. Keep P4 options, canonical-host selection and human release/deployment decisions explicit; do not infer their completion from green CI.
