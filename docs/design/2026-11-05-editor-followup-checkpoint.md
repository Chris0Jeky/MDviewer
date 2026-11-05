# Windows editor follow-up checkpoint

Record date: **2026-11-05**. Qualified application revision:
[`18afeeb8`](https://github.com/Chris0Jeky/MDviewer/commit/18afeeb8df7f7448d5241de50ff00db1d56f9697),
tree `2ede86cc07caf53a8afb3106716ece69c49d8a41`. This receipt covers the following merged source. Later
tracking-only documentation commits do not redefine this binary's source identity.
The [earlier authoring checkpoint](2026-11-05-authoring-checkpoint.md) retains the
original New/Find/offline-export and dependency receipts.

**Human acceptance remains OPEN:** #169 and AI-6/AI-7/AI-8/AI-9. The existing
checklists and deployment record are unchanged. This is an unsigned CI preview,
not evidence of comparative RAM/startup performance or an installed user acceptance pass.

## Merged work

| Change | Merge commit | Reviewed final head and hosted receipts |
| --- | --- | --- |
| [File lifecycle and recovery designs #209](https://github.com/Chris0Jeky/MDviewer/pull/209) | `2aec9104c7f35f4ac230705e4ba6775e0ee3e7ec` | `e27d94ba38118b0065b1c35f6f946db2344d309b`; [CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42080261624), [Windows](https://github.com/Chris0Jeky/MDviewer/actions/runs/42080261726). Implementations #196/#197 remain open. |
| [Visible PDF progress #210](https://github.com/Chris0Jeky/MDviewer/pull/210), closes #200 | `255473a12c940341697f16f0e665daf569487fa1` | `a0562fe06c1b23c6f70e9e1b86ec5e8b360d5608`; [CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42082539280), [Windows](https://github.com/Chris0Jeky/MDviewer/actions/runs/42082539236) |
| [Firefox/accessibility and native probe qualification #208](https://github.com/Chris0Jeky/MDviewer/pull/208), closes #203 | `44f895adb50ac0204f1177f66b90a14ebf15e79f` | `76705e02ca65f08b55748a14d81fbbfa46a947ec`; [CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42085178457), [Windows](https://github.com/Chris0Jeky/MDviewer/actions/runs/42085178562) |
| [Authored heading isolation #213](https://github.com/Chris0Jeky/MDviewer/pull/213) | `b89ea34d9f969d1efc62a4f98843b3c789cacc8c` | `40ebfbae89018db42d07da680294d29963e7f051`; [CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42091543176), [Windows](https://github.com/Chris0Jeky/MDviewer/actions/runs/42091543030) |
| [Session positions/navigation #212](https://github.com/Chris0Jeky/MDviewer/pull/212), closes #199 | `fc5105252d9b07925f5d497e24a077ab5bea301e` | `80501828a6a7f81593680c57cb434eff81c54dff`; [CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42093746915), [Windows](https://github.com/Chris0Jeky/MDviewer/actions/runs/42093746730) |
| [Markdown writing commands #211](https://github.com/Chris0Jeky/MDviewer/pull/211), closes #198 | `e1efb1c28516245936336bf7d64f5c864cf86cc5` | `df31b109b3761ab41951c5d4d359c60c19ff55a7`; [CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42099256278), [Windows](https://github.com/Chris0Jeky/MDviewer/actions/runs/42099256231) |
| [Native probe snapshot publication #214](https://github.com/Chris0Jeky/MDviewer/pull/214) | `18afeeb8df7f7448d5241de50ff00db1d56f9697` | `27323833fd0121c4436a65e5ce19c49d46725fa0`; [CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42105484731), [Windows](https://github.com/Chris0Jeky/MDviewer/actions/runs/42105484771) |

Each PR retained merge commits, independent latest-head review, comment triage,
all applicable hosted checks and the three-minute head age. Findings produced
code changes and regressions before merge; old green heads did not substitute
for qualification of changed code.

## Product behavior and corrections found during review

- **Format** is a collapsed source control with eleven commands, source-only
  Bold/Italic/Link shortcuts and native Undo. UTF-16 selections, first-input
  adoption, document ownership and the exact fallback event remain fenced.
  Chromium exposed a multiline input sequence that previously left only the last
  line selected; final selection now follows the owned native event sequence.
- Formatting recognizers preserve unsupported or ambiguous source unchanged.
  Balanced link destinations, distinct code spans, escaped delimiters, Unicode
  flanking, literal marker spans and active image openers have actual parser-output
  regressions. There is no new runtime parser/editor dependency.
- The desktop 560×420 Find+Format control initially left only 24.5px of source.
  The redundant shortcut legend now yields space while Format is open, preserving
  the memory warning, Save, shortcut titles and all controls. The regression
  requires at least 60px of source and 30px command targets, retained focus and
  textarea/page identity, and a measurable parked canvas.
  Hosted Windows Firefox at `0f151239` ([run](https://github.com/Chris0Jeky/MDviewer/actions/runs/42097512801))
  exposed a separate measurement issue: one 30px target
  was reported as 29.999984741210938px. The target-size assertions normalize only
  sub-millipixel noise; the source-space requirement, product CSS and deadlines
  remain unchanged.
- Position data lives in a bounded 64-entry coordinate cache keyed by document ID.
  Review covered visible old previews during held/failed preparation, closed IDs,
  fresh textarea history, Undo Close and reader/workspace handoffs. Reader scroll
  restoration now follows outline layout. A near-end clamp observed in hosted
  Windows Firefox also revealed that the first workspace import changed the reader's box model; a
  startup reader reset keeps geometry stable without loading the workspace early.
- Authored headings using 17 shell names remain ordinary document content.
  Actual parent chains isolate shell styles, print rules and feedback lookups;
  rendering no longer hides an Error card heading or replaces Status live text.
  Unicode heading-ID semantics remain a separate issue, #204.
- PDF feedback uses its own visible screen row with bounded polite announcements.
  It reports actual completed pages and native save outcomes, and describes browser
  handoff as a download request. It preserves export ownership and the host lease.
- Native smoke separates PowerShell worker bootstrap from UI-operation time while
  retaining action/overall deadlines, rendered-heading checks, two real Save
  dialogs, exact saved bytes and cleanup evidence. Probe startup timing is not an
  application startup-performance measurement.

## Native probe publication follow-up

Artifact inspection of the earlier combined main `e1efb1c` found a missing
first-launch diagnostic screenshot in [Windows run 42100615344](https://github.com/Chris0Jeky/MDviewer/actions/runs/42100615344).
Both rendered-heading checks, native Save dialogs and exact saved files passed;
the first screenshot recorded a sharing violation while the worker deleted its
progress JSON during a parent read. That receipt is not presented as complete
screenshot evidence. A focused follow-up replaces the harness-owned snapshots
atomically and permits snapshot readers to share replacement. It does not change
application document saves or satisfy #196's independent user-file conflict proof.
The first hosted fixture then caught PowerShell binding a bare `$null` backup
argument to an empty .NET path. The correction uses the explicit `NullString.Value`
marker; the held-reader fixture remained unchanged and must pass in both actual
PowerShell runtimes. The final qualified receipt below belongs to that corrected
source, with fresh native screenshot and saved-file evidence.

## Final combined verification

The qualified revision's own [CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/42107298155)
and [Windows Desktop](https://github.com/Chris0Jeky/MDviewer/actions/runs/42107298588)
passed all six jobs:

| Check | Observed result |
| --- | --- |
| Node 22 compatibility / Node 24 supported lane | 1,073 unit tests; typecheck, lint, Observatory guard and clean web build passed on each |
| Production web Chromium | 178 passed; five existing optional performance cases skipped |
| Production Firefox on Windows | 94 passed, without retries or skips |
| Production desktop Chromium | 36 passed |
| Native Windows | 22 Rust tests, 21 probe-policy cases, 117 held-reader publication assertions in each of PowerShell 5.1/7, build/installer and actual launch/save smoke passed |

Local Linux Firefox requires the process-only namespace workaround documented in
[AUTHORING_QUALITY.md](AUTHORING_QUALITY.md); hosted checks use normal launches.
One earlier local large-insert test passed every body assertion then timed out
closing its browser context. At local combined revision `f8af680`, the unchanged
test passed in 2.3s as part of a 91-case no-retry suite. The unexplained signal
remains a profiling candidate in #202; it is not a measured 60-second application freeze. Earlier
hosted navigation export tests also exhausted time during initial page load;
subsequent exact-head lanes passed without relaxed assertions or deadlines.

## Windows artifact and source identity

| Artifact | Qualified download |
| --- | --- |
| Installer and portable executable | [mdviewer-windows-x64](https://github.com/Chris0Jeky/MDviewer/actions/runs/42107298588/artifacts/13452403372) |
| Tracked source / COMMIT / TREE | [desktop-source](https://github.com/Chris0Jeky/MDviewer/actions/runs/42107298588/artifacts/13452991467) |
| Native metrics, screenshots and saved files | [windows-desktop-smoke](https://github.com/Chris0Jeky/MDviewer/actions/runs/42107298588/artifacts/13452323599) |
| Desktop browser evidence | [desktop-browser-evidence](https://github.com/Chris0Jeky/MDviewer/actions/runs/42107298588/artifacts/13453146372) |

The source archive records this literal application revision and tree; all
365 tracked Git blobs match, with no missing, mismatched or extra files.
The packaged portable executable matches the native-tested executable, and its
SOURCE.txt identifies this revision. Inspection verifies two actual Save dialogs,
the expected 93 UTF-8 Markdown bytes, the saved PDF's header/EOF and recorded
hashes, and no cleanup errors. Binary/source artifacts expire 2026-12-05;
smoke/browser evidence expires 2026-11-19.

| File | SHA-256 |
| --- | --- |
| Windows artifact ZIP | `a8624a708e264f36543a0debed530c90ad90c309b4bbdb0eeb49835bfc0efda2` |
| Installer | `3f3b4d02dcf535c5ab719efb73476c3a2b03bf1d3f7f44d8ebdfeb1fdafebf39` |
| Portable executable | `a94ab1159127f59d8dcc45a77555ddd034a5aa60144c54e9eabbb17423e7e0f0` |
| Inner tracked source.zip | `dd1a6d71f13df2a501babdeadfd529190f3a7c6b1e293e17bac08f3327f9ee8e` |

## Remaining work and handoff

[#195](https://github.com/Chris0Jeky/MDviewer/issues/195) and [Future work](../FUTURE_WORK.md)
remain the execution index. #196 requires a Windows compare/replace proof before
owned Save/Save As; #197 requires agreed identity, fault/restart/deletion tests and
measured bounded writes before opt-in recovery. #201 still needs a cancellation
contract and deliberately stalled export experiments that retain the render lease
until readers settle. #202 owns measured authoring bottlenecks and budgets; #169
owns representative whole-process hardware comparisons. #204 Unicode fragments,
#206 the upstream SDK accounting fix and #205 whitespace research stay open.

Current documents and session positions remain in memory except explicit saves.
Save Markdown writes a copy and does not adopt an original-file write binding or
clear its dirty baseline. No in-place Save, automatic document storage, watcher,
cloud backend or updater was added. Merged designs are not shipped persistence.

This reconciliation updates current status, user guidance and evidence pointers.
It preserves historical source receipts, the exact human-checklist suffix in
ACTION_ITEMS.md and the existing deployment anchor. Re-establish GitHub state
before continuing work; new receipts must identify their own source and artifacts.
