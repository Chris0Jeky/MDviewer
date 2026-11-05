# Desktop editor: future work

Planning baseline: **2026-11-05**, verified application commit
[`203c0979`](https://github.com/Chris0Jeky/MDviewer/commit/203c09798b01061ceb0c00f0937c22beeafb1a55).
Tracker: [#195](https://github.com/Chris0Jeky/MDviewer/issues/195).
The [roadmap](Project_Roadmap.md) owns phase status; the issues below own execution,
acceptance criteria and dependencies. Check GitHub before starting: this table is a
dated priority map, not a claim that issue state never changes.

**Human acceptance remains OPEN:** [Windows #169](https://github.com/Chris0Jeky/MDviewer/issues/169)
and [AI-6, AI-7, AI-8, AI-9](../ACTION_ITEMS.md#open-items). Code merges and automated
checks do not close those gates. The last verified deployment record stays in
[DEPLOYMENT.md](DEPLOYMENT.md); newer repository commits are not deployment evidence.

## Direction and current boundary

Build a straightforward Windows Markdown reader/editor with dependable local file
workflows, fast everyday writing, accessible controls and page-safe PDF output.
Keep reader startup light and reveal advanced controls when needed. The web/PWA
build remains supported; the desktop host stays separate from the shared renderer.

New documents, compact writing controls, guarded native editing/undo, Find/Replace,
visible matches, workspace readiness, offline PDF qualification and Shiki 4.6 are
already merged through #183/#187/#185/#188/#192/#178/#191/#193/#194. The final
application baseline passed both [CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053738540)
and [Windows Desktop](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244):
832 units on each Node lane, 130 web cases with five optional performance skips,
27 desktop cases, and 22 Rust tests plus actual native launch/save smoke.

Today, document/session content stays in memory. Explicit Markdown/PDF saving is
available; **Save Markdown saves a copy and does not clear the original-source
dirty baseline**. There is no automatic document storage, crash recovery, in-place
save, file watcher or persistent recent-file list. The reader already has an
outline, and progress already exists when the preview is visible. Future issues
must not misdescribe those shipped capabilities as missing.

## Ordered work

Priority is an execution order, not a delivery date. **Ready** means a confirmed
gap with a bounded fix; **Planned** means a scoped enhancement; **Design first**
requires a reviewed behavior/ownership contract before implementation; **Waiting**
identifies a dependency; **Deferred** is deliberately lower priority.

| Priority / stage | Issue | Completion target and dependency |
| --- | --- | --- |
| Implementation prepared · review/CI pending | [#200 — Export feedback with a hidden preview](https://github.com/Chris0Jeky/MDviewer/issues/200) | External visible progress/status, bounded announcements, exact capture/save phases and failure/cancel/retry feedback are implemented. See [design and evidence](design/EXPORT_STATUS.md); exact-head review/CI remains required. Raster cancellation stays separate in #201. |
| Design drafted · native primitive gate | [#196 — Save / Save As and file ownership](https://github.com/Chris0Jeky/MDviewer/issues/196) | Review the [Save / Save As design](design/FILE_LIFECYCLE.md): capability ownership, saved revisions, encoding and conflict outcomes. Prove the Windows compare/replace primitive before implementing owned writes; current Save Copy remains unchanged. |
| Design drafted · depends on #196 | [#197 — Optional crash/session recovery](https://github.com/Chris0Jeky/MDviewer/issues/197) | Review the [optional recovery design](design/RECOVERY.md): default off, bounded native generations, revocable writers, explicit restore/discard and deletion. Implementation still depends on the identity contract and Windows fault/restart evidence. |
| Implementation prepared · review/CI pending | [#198 — Markdown formatting commands](https://github.com/Chris0Jeky/MDviewer/issues/198) | Collapsed Format controls and source shortcuts implement eleven Markdown commands through the guarded edit seam. Exact toggles, selections and tests: [command design](design/MARKDOWN_COMMANDS.md). Final hosted checks/review remain required. |
| Implementation prepared · review/CI pending | [#199 — In-session positions and document navigation](https://github.com/Chris0Jeky/MDviewer/issues/199) | Bounded ID-keyed caret/scroll positions, compact previous/next controls and Windows/Linux shortcuts are implemented, with reader/workspace and Undo Close transfer. See [navigation contract](design/SESSION_NAVIGATION.md); final hosted checks/review remain required. |
| Implementation prepared · review/CI pending | [#203 — Second-engine and accessibility regressions](https://github.com/Chris0Jeky/MDviewer/issues/203) | Production Firefox authoring lane, keyboard/accessibility regressions and forced-colors Find correction. Local 39-case Firefox evidence and exact coverage: [design note](design/AUTHORING_QUALITY.md). Human AI-6/#169 acceptance remains separate. |
| Soon · Design first | [#201 — Bounded raster cancellation](https://github.com/Chris0Jeky/MDviewer/issues/201) | Stop or safely isolate queued/stalled/multi-page work without a late save or premature render-lease release; reuse #200's feedback surface. |
| Soon · Measure first | [#202 — Measured authoring responsiveness](https://github.com/Chris0Jeky/MDviewer/issues/202) | Refresh workloads and profile actual bottlenecks before choosing an optimization; preserve output/ownership and demonstrate improvement against the same baseline. Native comparisons stay in #169. |
| Later · Ready | [#204 — Unicode heading/TOC identity](https://github.com/Chris0Jeky/MDviewer/issues/204) | Consistent heading IDs and encoded fragments across reader, TOC/page numbers and vector/Print PDF links; preserve raster visual output. Include duplicates and compatibility. CSS selector escaping already exists. |
| Later · Waiting on upstream | [#206 — Preview engagement accounting](https://github.com/Chris0Jeky/MDviewer/issues/206) | Fix the marked-pane scroll latch upstream and import a regenerated locked SDK with behavioral/consent controls. No manual vendored edit. |
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

No feature in this future-work table is implemented by the documentation pass itself.
