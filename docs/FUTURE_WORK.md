# Desktop editor: future work

Updated **2026-11-05**. Qualified application revision: [`18afeeb8`](https://github.com/Chris0Jeky/MDviewer/commit/18afeeb8df7f7448d5241de50ff00db1d56f9697).
Exact checks, reviewed heads and Windows artifacts are recorded in the
[editor follow-up checkpoint](design/2026-11-05-editor-followup-checkpoint.md). Tracker: [#195](https://github.com/Chris0Jeky/MDviewer/issues/195).
The [roadmap](Project_Roadmap.md) owns phase status; each issue owns its acceptance
criteria and dependencies. Re-read GitHub before starting new work.

**Human acceptance remains OPEN:** [Windows #169](https://github.com/Chris0Jeky/MDviewer/issues/169)
and [AI-6, AI-7, AI-8, AI-9](../ACTION_ITEMS.md#open-items). Code merges and automated
checks do not close those gates. The last verified deployment record stays in
[DEPLOYMENT.md](DEPLOYMENT.md); newer repository commits are not deployment evidence.

## Direction and current boundary

Build a straightforward Windows Markdown reader/editor with dependable local file
workflows, fast everyday writing, accessible controls and page-safe PDF output.
Keep reader startup light and reveal advanced controls when needed. The web/PWA
build remains supported; the desktop host stays separate from the shared renderer.

New, Find/Replace, native edit ownership and offline PDF qualification are joined
by compact Markdown commands (#211/#198), bounded session positions and document
navigation (#212/#199), visible PDF progress in every workspace layout (#210/#200),
and production Firefox/accessibility coverage (#208/#203). Authored heading names
are isolated from application styles and feedback (#213). These changes preserve
the native textarea, lazy reader/workspace entry and the existing render pipeline.
No new editor or Markdown-parser dependency was added.

Today, document/session content stays in memory. Explicit Markdown/PDF saving is
available; **Save Markdown saves a copy and does not clear the original-source
dirty baseline**. There is no automatic document storage, crash recovery, in-place
save, file watcher or persistent recent-file list. The reader already has an
outline, and PDF progress remains visible even when the preview is hidden. Future issues
must not misdescribe those shipped capabilities as missing.

## Delivered in this follow-up

| Work | Completion evidence |
| --- | --- |
| Markdown writing commands #198 | [#211](https://github.com/Chris0Jeky/MDviewer/pull/211); [command contract](design/MARKDOWN_COMMANDS.md) |
| Session positions and navigation #199 | [#212](https://github.com/Chris0Jeky/MDviewer/pull/212); [ownership contract](design/SESSION_NAVIGATION.md) |
| Visible PDF feedback #200 | [#210](https://github.com/Chris0Jeky/MDviewer/pull/210); [phase/announcement contract](design/EXPORT_STATUS.md) |
| Second-engine/accessibility automation #203 | [#208](https://github.com/Chris0Jeky/MDviewer/pull/208); [coverage matrix](design/AUTHORING_QUALITY.md). Human acceptance remains open. |
| Authored heading isolation | [#213](https://github.com/Chris0Jeky/MDviewer/pull/213); runtime CSS/feedback fix, separate from Unicode ID design #204 |
| Native probe snapshot publication | [#214](https://github.com/Chris0Jeky/MDviewer/pull/214); atomic diagnostic snapshots and real held-reader fixtures in both PowerShell runtimes |
| File ownership and recovery designs | [#209](https://github.com/Chris0Jeky/MDviewer/pull/209); designs merged, implementations #196/#197 remain open |

## Ordered work

Priority is an execution order, not a delivery date. **Ready** means a confirmed
gap with a bounded fix; **Planned** means a scoped enhancement; **Design first**
requires a reviewed behavior/ownership contract before implementation; **Waiting**
identifies a dependency; **Deferred** is deliberately lower priority.

| Priority / stage | Issue | Completion target and dependency |
| --- | --- | --- |
| Next · Design merged; native proof required | [#196 — Save / Save As and file ownership](https://github.com/Chris0Jeky/MDviewer/issues/196) | Implement the reviewed [file-lifecycle contract](design/FILE_LIFECYCLE.md) after proving conflict-safe Windows compare/replace. A hash check followed by atomic replacement alone is insufficient; current Save Copy remains available. |
| Next · Design merged; depends on #196 | [#197 — Optional crash/session recovery](https://github.com/Chris0Jeky/MDviewer/issues/197) | Implement the reviewed [recovery contract](design/RECOVERY.md) after identity agreement, bounded-write measurements and Windows fault/restart/deletion evidence. Default remains off and no recovery storage has shipped. |
| Soon · Design first | [#201 — Bounded raster cancellation](https://github.com/Chris0Jeky/MDviewer/issues/201) | Stop or safely isolate queued/stalled/multi-page work without a late save or premature render-lease release; reuse #200's feedback surface. |
| Soon · Measure first | [#202 — Measured authoring responsiveness](https://github.com/Chris0Jeky/MDviewer/issues/202) | Refresh workloads and profile actual bottlenecks before choosing an optimization; preserve output/ownership and demonstrate improvement against the same baseline. Native comparisons stay in #169. |
| Later · Ready | [#204 — Unicode heading/TOC identity](https://github.com/Chris0Jeky/MDviewer/issues/204) | Consistent heading IDs and encoded fragments across reader, TOC/page numbers and vector/Print PDF links; preserve raster visual output. Include duplicates and compatibility. CSS selector escaping already exists. |
| Later · Waiting on upstream | [#206 — Preview engagement accounting](https://github.com/Chris0Jeky/MDviewer/issues/206) | Fix the marked-pane scroll latch upstream and import a regenerated locked SDK with behavioral/consent controls. No manual vendored edit. |
| Next · A1–A4 merged | [Actionable Markdown v1](design/ACTIONABLE_MARKDOWN.md) | Owner-confirmed 2026-11-11 as part of the [companion push](design/2026-11-11-companion-push.md). A1 parser and static controls (#252), A2 native line patch (#244) and A3 interaction (#263) are merged; A4 templates (native read #285, picker and command #286, wiring #295) are merged; A5 embeddable element (#300) is later. The grammar is fixed for generators that build to it. |
| Next · D0–D4 and D6 merged; D5 in progress | [Readable data v1](design/READABLE_DATA.md) | Owner-requested 2026-11-12: JSON, JSON Lines, YAML, TOML, CSV, TSV and plain text open as a readable view derived as Markdown by a pure function and shown by the existing reader. D0 to D4 (parsers #281, native #284, webview #288), the D6 readability pass (#293) and agent data files in the Library (#290) are merged. D5: the pure copy module is open as #289; the webview copy menu and Save readable view as Markdown is #299.
| Deferred · Research | [#205 — Pagination whitespace](https://github.com/Chris0Jeky/MDviewer/issues/205) | Distinguish unavoidable keep-whole space from avoidable layout; retain the trade-off unless an improvement preserves no-slice and legibility. |

The two persistence issues require coordinated operating-contract, native-capability
and privacy documentation in their implementation PRs. Planning them does not add
storage permission to the current application, change default behavior or imply
cloud synchronization. No document content, paths or titles may enter telemetry.

## Existing human and release gates

| Tracking | Remaining evidence |
| --- | --- |
| [#169](https://github.com/Chris0Jeky/MDviewer/issues/169) | Ordinary Windows install/uninstall, Explorer associations, keyboard/Narrator, printer output, representative cold/warm startup and complete WebView2 process measurements, budgets and signing/distribution. Its verified preview links/checksums are the handoff. |
| [AI-6](../ACTION_ITEMS.md#open-items) | Manual typing feel and second-engine editing acceptance. Automation in #203 supplies regressions; it does not self-clear the checklist. |
| [AI-7](../ACTION_ITEMS.md#open-items) | Live-site/PWA acceptance, including the actual install/offline/two-version update flow. Historical cache-header and theme-color fixes are already recorded. |
| [AI-8](../ACTION_ITEMS.md#open-items) | Live Pulseboard Beta-bar/consent acceptance. The SDK is deliberately inert under automation. |
| [AI-9](../ACTION_ITEMS.md#open-items) | Production environment configuration and the first approved live automated promotion. Dry-run success and merging main are not deployment. |

The Windows preview is unsigned and has no automatic updater. #169 owns that release
decision; do not create a competing signing/performance/accessibility checklist.
Artifact retention dates are in #169. After an artifact expires, qualify a new build
and record its own commit/tree/checksums instead of carrying forward old evidence.

## Maintenance and intentionally deferred choices

- **Dependency bridges:** remove the Shiki/jsdom byte-stream shim and scoped
  minimatch/glob/KaTeX/lodash overrides only when upstream versions satisfy the
  documented criteria and actual-consumer tests pass. See
  [DEVELOPMENT_DEPENDENCIES.md](DEVELOPMENT_DEPENDENCIES.md),
  [library notes](design/LIBRARY_NOTES.md) and canonical spec §2. A version bump alone
  is not evidence that a bridge is obsolete. Reconcile new Dependabot PRs normally.
- **Node verification policy:** Node 24 is the supported strict-install CI lane;
  Node 22 remains a legacy required compatibility context. Coordinate any context
  retirement with repository check settings; do not remove the required gate in
  an unrelated docs or dependency change.
- **Further navigation/UI:** source-to-paginated-preview mapping, a command palette,
  templates and extra editor conveniences need a concrete workflow/design before
  they enter the implementation queue. The existing reader outline is not pending.
- **P4 output options:** additional paper sizes/orientations and custom user themes
  remain deferred. Preserve the existing A4/Letter and screen/print separation.
- **File integration:** linked local images, file watching and shell/Explorer preview
  integration remain outside the current bounded host contract. Introduce a scoped
  issue and capability design before changing that boundary.
- **Canonical origin (MD2):** hostname selection/ownership is still a product/hosting
  decision. Only then update canonical metadata and base-path acceptance. The
  existing Pages deployment and AI-9 runbook remain authoritative.

## How to keep this backlog usable

1. Read the live issue/PR state, current main, relevant source and human gates before
   taking an item. Start with a ready fix or an explicit design deliverable.
2. Record the exact scope, dependencies and acceptance in its issue. Break a large
   item into independently reviewable PRs; keep unimplemented portions open.
3. When a fix merges, add a resolved summary with PR/commit and tested evidence to
   the issue. Label its original report/history clearly. Link any remaining work.
4. Update this map, the phase roadmap, ORCHESTRATOR current checkpoint and relevant
   contracts/guide in the same change. Keep completed design notes as dated history,
   not an active to-do list. The failure ledger must link each open limitation to
   an issue or an existing human gate and regenerate its Markdown table.
5. Use latest-head independent review, triage comments and preserve required CI and
   the three-minute head age before a merge commit. New evidence belongs to its
   actual commit; do not claim tests on an older commit prove a changed head.

This map records merged application work and the remaining implementation gates. Updating the map does not ship the pending features.
