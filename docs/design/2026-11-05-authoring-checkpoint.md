# Desktop authoring checkpoint and tracking reconciliation

**Historical authoring record.** The later Format/navigation/export/quality qualification is in the [editor follow-up checkpoint](2026-11-05-editor-followup-checkpoint.md). Earlier source identities, test counts and the Combined-main verification anchor below are preserved.

Record date: **2026-11-05**. The original authoring baseline for the historical
feature evidence below is
[`280c73e26487b16d7de607c269b2839636b0b969`](https://github.com/Chris0Jeky/MDviewer/commit/280c73e26487b16d7de607c269b2839636b0b969),
tree `89d93bf31fbdff3db87725cd6726d57199a09b56`. The primary GitHub connector verified
the five existing documentation baselines, merged #178/#191, closed #174/#189,
and the successful exact-head workflows below. Subsequent qualification of merged
#193/#194 on main `203c0979` is recorded in
[Combined-main verification](#combined-main-verification). Earlier source identities
and test counts are retained. This record makes no live-site deployment or
human-acceptance claim.

Main `85f7361e` postmerge [CI 42046588461](https://github.com/Chris0Jeky/MDviewer/actions/runs/42046588461)
and [Windows 42046589174](https://github.com/Chris0Jeky/MDviewer/actions/runs/42046589174)
also passed all five jobs.

**Human gates remain OPEN:** AI-6 (typing feel and a second browser engine), AI-7
(live-site/PWA acceptance), AI-8 (live Pulseboard acceptance), AI-9 (production
environment and first live automated deployment), and Windows acceptance/performance
[#169](https://github.com/Chris0Jeky/MDviewer/issues/169). Their existing checklists
and explicit human-confirmation requirements remain in `ACTION_ITEMS.md`.

## Merged work and qualification

| Work | Merge | Reviewed head | Successful exact-head workflows |
| --- | --- | --- | --- |
| [New document #183](https://github.com/Chris0Jeky/MDviewer/pull/183), closes #181 | `3e67112850422fbd05a004323ad39a4e026c2481` | `6d35045f5ffb902e72e7d88e76112a207e25a8db` | [CI 42029329867](https://github.com/Chris0Jeky/MDviewer/actions/runs/42029329867), [Windows 42029329807](https://github.com/Chris0Jeky/MDviewer/actions/runs/42029329807) |
| [Desktop writing space #187](https://github.com/Chris0Jeky/MDviewer/pull/187), closes #186 | `3e3733d4e3265d39ed1736dd291f88650d08cc19` | `f38248189c6c7dbdf1e3b2fcebf0aabb40d88722` | [CI 42033736286](https://github.com/Chris0Jeky/MDviewer/actions/runs/42033736286), [Windows 42033736327](https://github.com/Chris0Jeky/MDviewer/actions/runs/42033736327) |
| [Guarded editor mutations #185](https://github.com/Chris0Jeky/MDviewer/pull/185), closes #184 | `f0faf7c624b0c0682aaa10d31c0d391efb95500a` | `0dedf6610ea6f17f917b8fe9fc884251d7cc8ba6` | [CI 42033893845](https://github.com/Chris0Jeky/MDviewer/actions/runs/42033893845), [Windows 42033894135](https://github.com/Chris0Jeky/MDviewer/actions/runs/42033894135) |
| [Find/Replace #188](https://github.com/Chris0Jeky/MDviewer/pull/188), closes #182 | `4976f289e4a46e83a4ae88228ada726757fbe018` | `c5733297bb21beb9dc54ed34571c4f6071660e45` | [CI 42037107994](https://github.com/Chris0Jeky/MDviewer/actions/runs/42037107994), [Windows 42037108023](https://github.com/Chris0Jeky/MDviewer/actions/runs/42037108023) |
| [Workspace readiness #192](https://github.com/Chris0Jeky/MDviewer/pull/192), closes #190 | `7f6db5d2d6ee541e6ab2fc7baf8250f03f76fd78` | `a54b1ef58231e29cda719cd3acde68e5bf9d4a72` | [CI 42041994651](https://github.com/Chris0Jeky/MDviewer/actions/runs/42041994651), [Windows 42041994720](https://github.com/Chris0Jeky/MDviewer/actions/runs/42041994720) |
| [Offline capture #178](https://github.com/Chris0Jeky/MDviewer/pull/178), closes #174 | `85f7361ef16e549944dd0c0d9928b7aa517f95eb` | `a9664f9b5041ffa7e7c04fa3913dbc6959334df7` | [CI 42045009842](https://github.com/Chris0Jeky/MDviewer/actions/runs/42045009842), [Windows 42045009809](https://github.com/Chris0Jeky/MDviewer/actions/runs/42045009809) |
| [Visible source matches #191](https://github.com/Chris0Jeky/MDviewer/pull/191), closes #189 | `280c73e26487b16d7de607c269b2839636b0b969` | `e8ef574a07a4d8e15a17b61c0d42ffc08c1c39c3` | [CI 42046931836](https://github.com/Chris0Jeky/MDviewer/actions/runs/42046931836), [Windows 42046931378](https://github.com/Chris0Jeky/MDviewer/actions/runs/42046931378) |

Desktop users can start a blank document from the reader or workspace with New or
Ctrl/Cmd+N. Existing documents, lazy workspace loading, native admission and transition
guards remain. Document layout starts collapsed on desktop while saved settings and
the web disclosure default remain unchanged. Save Markdown continues to save a copy;
it does not reset the dirty baseline.

Delayed editor changes retain their document, value, selection and focus ownership.
The [#185 correction](https://github.com/Chris0Jeky/MDviewer/pull/185#issuecomment-6658898227)
replaced value-assignment undo isolation, which failed in Chromium, with a fresh
textarea at each document identity boundary. Passive updates and first-typed adoption
retain their node and native history. The original failing browser assertion was
unchanged. [Independent review](https://github.com/Chris0Jeky/MDviewer/pull/185#issuecomment-6658945011)
verified node/listener ownership and reran 75 focused editor tests. The later successful
exact-head workflows above qualify the corrected browser behavior. The canonical
focus-contract wording correction landed with Find/Replace.

The [#187 review](https://github.com/Chris0Jeky/MDviewer/pull/187#issuecomment-6658998020)
records real browser geometry/state-preservation coverage and inspection of all three
desktop screenshots before merge. These results do not close ordinary Windows or
non-Chromium human acceptance.

Find/Replace supplies literal search, case matching, wrapped previous/next navigation,
counts, replacement and Replace all through the guarded native edit seam. Reviewed
head `c5733297` passed all five jobs: **801 unit tests, 123 production web cases with
five existing optional skips, 27 desktop browser cases and 22 Rust tests**. Short-window
geometry, native undo, source/backdrop scroll bounds and print exclusion are covered.
Issue #182 is closed. The visible source-match cue is now qualified in merged #191, as recorded below.

## Workspace readiness correction

The postmerge main [Windows run 42038086012](https://github.com/Chris0Jeky/MDviewer/actions/runs/42038086012),
native job `127281369928`, passed the release build and 22 Rust tests, then timed out
waiting for its first Save dialog. The retained artifact shows successful Edit and
Save button probes, 58 clean absent-dialog probes, and the focused editor with no
dialog. Entry exposed Save before `flushRender()` finished, while `changingMode`
still discarded clicks. This source gap also exists in `0bfcce1`; the captured run
is consistent with it but does not trace native save-command entry directly.

Merged [#192](https://github.com/Chris0Jeky/MDviewer/pull/192) closes
[#190](https://github.com/Chris0Jeky/MDviewer/issues/190). It keeps the workspace inert
through entry, releases readiness before focus, and makes UIA wait for visible,
enabled controls. Regression-first local checks pass 803 units, typecheck, lint,
four server tests and both web builds. All five exact-head hosted jobs passed:
123 web cases with five optional skips, 27 desktop cases, and 22 Rust tests plus
actual native smoke. Source artifact verification matched the published tree.
Inspection of [native job 127294893271](https://github.com/Chris0Jeky/MDviewer/actions/runs/42041994720/job/127294893271) confirmed
two actual Save dialogs, exact UTF-8 Markdown, PDF header/EOF and no cleanup errors.
The correction is inherited by current main; retain the original failed main artifacts.

## Offline PDF qualification completed

Merged [#178](https://github.com/Chris0Jeky/MDviewer/pull/178) closes
[#174](https://github.com/Chris0Jeky/MDviewer/issues/174). The exact 2.6.0 pin and
removal of its temporary Dependabot exclusion are now on main. The source
controller/document path, real resource outcomes and fail-closed cleanup contract
are recorded in [Offline raster capture](RASTER_OFFLINE_CAPTURE.md).

Reviewed integration head `a9664f9b5041ffa7e7c04fa3913dbc6959334df7` includes current
authoring and #192's native readiness correction. All five final jobs passed:
**818 units, 127 production web cases with five existing optional performance skips,
27 desktop browser cases and 22 Rust tests plus actual native smoke**. Saved-PDF
RGB/ink checks, deliberately damaged output, repeated real CSS/font cache-loss
refusal/cleanup, and restored-cache retry passed. Review inspected the persisted
CSS/font recovery JSON, matched the 323-blob source artifact/TREE, and verified
both actual Save dialogs, exact UTF-8 Markdown, PDF header/EOF and no cleanup errors.
Independent integration review checked all 22 published changed blobs plus five
inherited critical editor/readiness files and reran 79 focused tests successfully.

The older `268bcb8f` browser run passed its raster controls but encountered the
entry-readiness failure in its PR merge checkout. That limitation is historical;
final integration includes the merged fix and passes native qualification. These
checks qualify the scoped production Chromium path and packaged Windows smoke,
not additional browser engines, live/PWA operator acceptance or representative
Windows performance. Those human gates remain open.

## Visible source match qualification

Merged [#191](https://github.com/Chris0Jeky/MDviewer/pull/191) closes
[#189](https://github.com/Chris0Jeky/MDviewer/issues/189). The current source match
stays visible while Find retains keyboard focus; the marker does not change source
text, native undo, source/backdrop scroll metrics, or printed/exported content.

Initial head `20d0792c` completed all five jobs, but actual screenshot review found
the cue below its matching phrase in a large plain source. The existing assertions
missed that alignment problem. Corrected combined head
`e8ef574a07a4d8e15a17b61c0d42ffc08c1c39c3` includes offline capture, desktop readiness,
and measured line height with stronger geometry checks. All five final jobs passed:
**830 units, 130 web cases with five existing optional performance skips, 27 desktop
browser cases, and 22 Rust tests plus actual native smoke**. Independent source and
visual review approved the corrected screenshot, including a measured large-source
alignment error of 0.1375 CSS pixels, and verified all 327 source blobs/TREE. Desktop
screenshots at 560×420 and 1280×420 pixels were inspected, covering narrow and
laptop-width layouts at the same short 420-pixel height.

## Dependency qualification and human gates

[Shiki 4.6 qualification #193](https://github.com/Chris0Jeky/MDviewer/pull/193) records
the six-package dependency update separately from the authoring baseline above.
Its initial head `0edbde4f` passed
[Windows 42046835262](https://github.com/Chris0Jeky/MDviewer/actions/runs/42046835262),
while [CI 42046835215](https://github.com/Chris0Jeky/MDviewer/actions/runs/42046835215)
found Node unit failures traced to jsdom's missing `Blob.stream()`. A normal
installation on supported Node worked. The corrected head
`49297f08f0690b7f968fdec2e59bbb806a6d7ea4` passed review and qualification, then merged
in #193 as `5fbb219c720b949131e12fe801d2137f2629f273`. Its PR retains the original
failure and correction evidence. The subsequent #194 documentation merge produced
the combined main verified below; those results were read from that main's own runs.

**#169 and AI-6/7/8/9 remain open.** No deployment, signed release, automatic updater
or comparative RAM/startup claim follows from these merges. Extra paper formats and
custom themes remain deferred; source persistence and cloud/account features are
outside these authoring slices.

## Combined-main verification

After [#193](https://github.com/Chris0Jeky/MDviewer/pull/193) and
[#194](https://github.com/Chris0Jeky/MDviewer/pull/194), main
[`203c09798b01061ceb0c00f0937c22beeafb1a55`](https://github.com/Chris0Jeky/MDviewer/commit/203c09798b01061ceb0c00f0937c22beeafb1a55)
(tree `8fe8e94f9cde0a52f3344075f0c272f140825ccb`) passed all five push jobs in
[CI 42053738540](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053738540) and
[Windows 42053740244](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244).
The actual job logs record:

| Check | Result |
| --- | --- |
| Node 22 legacy probe and Node 24 | 832 unit tests across 71 files passed on each; typecheck, lint and builds passed |
| Production web Chromium | 130 passed; five existing optional performance tests skipped |
| Production desktop Chromium | 27 passed |
| Windows native build and smoke | 22 Rust tests passed; real-app launch and save smoke passed |

The [source artifact](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244/artifacts/13427938732)
contains the literal final-main COMMIT/TREE and all 330 matching Git blobs, with no
missing, mismatched or extra files. The
[distributed executable](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244/artifacts/13429490041)
identifies that same source commit, and its hash matches the binary exercised by
the native smoke. Inspection of the
[smoke artifact](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244/artifacts/13427024597)
verified two actual Save dialogs, exact expected UTF-8 Markdown bytes, the saved PDF
header/EOF, and no cleanup errors. These are automated qualification receipts;
AI-6/AI-7/AI-8/AI-9 and ordinary Windows acceptance/performance #169 remain open.

[Future work](../FUTURE_WORK.md) and [tracker #195](https://github.com/Chris0Jeky/MDviewer/issues/195)
record the remaining work. Native file saving in #196 and optional recovery in #197
are design-first proposals. They do not change the current Save Copy behavior or
introduce automatic document storage. Formatting, navigation, progress visibility,
cancellation and performance follow-ups are tracked there separately from completed
features and human acceptance.

## Tracking reconciliation and audit limits

`ORCHESTRATOR.md` was reconciled from the verified latest authoring baseline. Its
capture-integration checkpoint and complete earlier history are retained, with this
qualified authoring record above them. Existing launch/task records are explicitly
historical and the completed offline/match-cue items are removed from the active
backlog. `ACTION_ITEMS.md` changes only the current snapshot and historical grouping;
the exact human OPEN/completed/follow-up suffix is unchanged. The roadmap records
authoring and offline capture as done and links dependency qualification to #193.

README and the Windows guide describe New, Find/Replace, persistent match visibility,
scoped shortcuts, the actual Reading view label and on-demand editor loading. README
links qualified offline capture evidence instead of describing closed #174 as pending.
The last verified deployment anchor is unchanged.

The initial 13:16 audit read every then-open issue comment stream and draft PR
conversation, review submission and inline review thread; it found no unattended
outside feedback. Later connector checks verified the authoring/offline merges and
closed issues, and identified the automated Shiki dependency update. This is an
anchored implementation/evidence record, not a claim that the repository's issue or
PR list will remain unchanged. New actionable feedback and changing qualification
state belong in their linked PRs and subsequent checkpoints.

Any newer Windows artifact linked from #169 must match a verified source identity
and successful native smoke. This documentation changes no application behavior and
leaves the human checklist untouched. Re-establish live repository/deployment state
before new work.
