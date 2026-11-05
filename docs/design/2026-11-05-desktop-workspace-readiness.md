# Desktop workspace readiness

Issue: [#190](https://github.com/Chris0Jeky/MDviewer/issues/190). Candidate based on
main `4976f289e4a46e83a4ae88228ada726757fbe018` (tree prefix `286fb812`).

## Evidence and cause

The postmerge Windows smoke [run 42038086012](https://github.com/Chris0Jeky/MDviewer/actions/runs/42038086012),
native job `127281369928`, built successfully and passed 22 Rust tests before the
first Save dialog timed out. Its artifact records successful Edit & PDF and Save
Markdown button probes, followed by 58 clean probes reporting no Save export
dialog. The failure screenshot shows the mounted editor, focused source, and no
dialog or save error. The reviewed PR source tree had passed the same native smoke
before merging. A second integration run, [42039793185](https://github.com/Chris0Jeky/MDviewer/actions/runs/42039793185),
shows the same first-Save failure; that checkout combines the offline branch with
current main and is not independent runtime evidence from an older main.

The entry code exposes the workspace, mounts its controls and transfers documents
before awaiting `app.flushRender()`. Save becomes enabled during that wait, while
`changingMode` remains true and the existing capture listener discards workspace
clicks. A UI Automation invocation can therefore succeed without reaching the
Save handler. The captured failure is consistent with this race; the original
artifact does not trace the native save command itself. A deferred-render unit
test reproduces the unavailable-entry interval deterministically. Direct source
comparison also finds the same entry gap in main `0bfcce1`, before the authoring
changes.

## Decision and implementation

Keep the workspace visible for layout, but set `appRoot.inert` before mounting it.
It remains unavailable through the initial render. The existing capture guard
continues to reject programmatic shortcut clicks during both mode transitions.
Native UI Automation must wait until the controls return to its available tree.

Entry releases the inert guard in `finally`, on successful rendering, failed
mounting, or failed initial rendering. It completes `finishMode()` and queued
imports before focusing the editor. Failed mounting keeps the original reader
documents; a failed first render keeps the transferred workspace documents and
the existing recovery notice. The guard also continues to protect return-to-reader
snapshots and is released on return failure or success.

`syncDocuments()` now derives Reading view and New availability from the same
transition, export and native-save state. An immediate idle export notification
cannot enable Reading view before entry finishes, and save completion cannot
enable it while an export still owns the workspace. Source admission, selection,
dirty baselines and Save Copy behavior retain their existing contracts.

The Windows smoke polls visible, enabled UI Automation buttons, rechecks those
properties immediately before invoking, and records them in the probe result. Its
modal invocation handling and subsequent actual-dialog check remain intact. No
fixed entry delay or repeated Save invocation is introduced. The desktop browser
readiness helper also requires the actual root's inert state to be false after
pagination completes.

## Verification plan and evidence

1. Add deferred-render regressions against the real desktop entry and event wiring.
   Before the fix, four assertions failed in the focused 25-test suite; 21 tests
   passed. The failures included the missing entry inert guard.
2. Apply the entry guard and focus-order fix. The focused suite now passes all
   25 tests, including queued imports, failed mount/render recovery, return
   rollback, New admission and overlapping export/native-save ownership.
3. Local verification passes: 803 unit tests across 68 files, typecheck, lint, four
   server tests, both production web builds and discovery of all 27 desktop
   browser tests. Builds identify themselves as a local source-archive candidate.
4. Hosted qualification is pending publication. Qualify the tree with the existing production desktop browser suite
   and actual Windows smoke. The native smoke must create the real Save dialogs,
   verify the exact Markdown bytes, and verify the saved PDF header and EOF. Keep
   the original failure artifacts for comparison.

Local Chromium, Rust and PowerShell are unavailable in this environment. Local
checks cannot establish WebView2's UI Automation behavior or native save success;
the hosted browser and Windows jobs are required qualification, not optional
reruns of the failed main. Manual Windows checks in #169 and AI-6 through AI-9
remain open.
