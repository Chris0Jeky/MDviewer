# Windows native smoke boundary

The desktop workflow builds the release executable, then runs `scripts/desktop-smoke.ps1` against that actual binary. It does not substitute a browser mock for native file operations. The process refuses an existing MDviewer instance and cleans up only the processes it owns or has identified by PID and creation time.

## Native Save controls

Framework UI Automation can label the filename host `AppControlHost` even though the same HWND has native class `ComboBox`. It can also expose the second Save dialog without exposing any of its children. The parent harness therefore identifies only the exact owned `Save export` dialog through UIA; `desktop-save-button.cs` addresses its native controls.

The filename bridge enumerates at most 256 descendants of that verified dialog. It requires exactly one visible native `Edit` with ID 1001 under a `ComboBox` and `FloatNotifySink`, with matching process ownership, ancestry and enabled/visible state. A read-only Edit is rejected. The bridge writes a bounded path, requires exact readback, sends the documented `CBN_EDITCHANGE` notification only to the verified ComboBox's own parent, then rechecks identity and readback. No arbitrary Edit, keyboard simulation or document-derived target is used.

Save resolves only the verified dialog's direct ID 1 child. It requires a visible/enabled native Button, the same process, exact direct parent and control ID. It activates only that owned dialog, validates again, and dispatches BM_CLICK with a 1.5-second bound. BM_CLICK has no return value: dispatch is not evidence of a successful export.

`scripts/test-desktop-save-button.ps1` exercises a real native positive button fixture and rejection cases for invalid handles, process ownership, dialog/button classes, missing/wrong IDs, disabled/hidden controls, nested rather than direct children, missing/misplaced filename controls, and empty/NUL/oversized filename input. These rejection tests do not click, read text, or access document files. The actual application smoke is the positive integration test for the filename bridge.

The actual smoke must subsequently find the newly saved Markdown file and compare every UTF-8 byte with its fixture. It must find the PDF with its header and EOF marker. A published probe attempt or completed click is never substituted for these file checks. Full rendering fidelity remains covered separately by the production browser's saved-PDF pixel tests.

## Probe JSON publication

Every worker owns a unique probe path. Its progress and result snapshots use the
shared `scripts/lib/desktop-probe-json.ps1` helper in both the Windows PowerShell
5.1 worker and PowerShell 7 parent. The worker writes complete UTF-8 JSON without
a BOM to a same-directory `.writing` file. Initial publication moves that file
into place; subsequent publication uses
[`File.Replace`](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace?view=netframework-4.7.2), without deleting the
visible snapshot first or falling back after a replacement error.

Readers open with
[`FileShare.ReadWrite | FileShare.Delete`](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileshare?view=netframework-4.7.2) and dispose their
streams deterministically. A reader already holding the old file can finish that
complete snapshot while a new reader sees the complete replacement. This covers
both progress updates and results published before a potentially blocking native
action. The parent consumes the result snapshot recorded with its probe evidence.

An unpublished initial snapshot returns no value. Unexpected I/O failures,
invalid UTF-8, malformed JSON, and non-object snapshots remain errors. The parent
retains the first observed readiness time and the last valid progress snapshot;
publication does not reset the 30-second bootstrap, eight-second worker-operation,
45-second action, or 180-second overall budgets. This is a single-writer protocol
for harness-owned JSON, not a user-file conflict-safety primitive for Save/Save As.

`scripts/test-desktop-probe-json.ps1` runs against real Windows handles in both
PowerShell versions in the native workflow. It holds a reader opened by the
production helper across publication and checks complete old/new snapshots,
Unicode bytes, initial and repeated progress/result writes, missing versus invalid
snapshots, handle disposal, and visible failures when replacement is blocked.

## Current qualification

The [editor follow-up checkpoint](2026-11-05-editor-followup-checkpoint.md) records
the current qualified source, six hosted jobs, both PowerShell publication fixtures,
native screenshots and exact saved-output/binary receipts. The original receipt
below remains tied to its historical source revision.

## Historical main checkpoint — 2026-11-05

The final-main push at `203c09798b01061ceb0c00f0937c22beeafb1a55` passed
[Windows Desktop 42053740244](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244).
The [native job](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244/job/127336397827)
passed 22 Rust tests, the release build and the actual executable smoke. It rendered
the absolute Unicode UTF-8 launch and relative Unicode UTF-16LE forwarded launch,
retained the original host, and verified two native Save dialogs with exact
filename readback. The actual saved Markdown matched all 93 expected UTF-8 bytes;
the 54,601-byte saved PDF had a valid header/EOF and parsed as one A4 page. The
native screenshots and rendered saved PDF were inspected, and cleanup errors were
empty.

The [corresponding source artifact](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244/artifacts/13427938732)
records the literal main commit above, not a synthetic PR merge checkout. Its
tree is `8fe8e94f9cde0a52f3344075f0c272f140825ccb`; all 330 archived Git blobs
matched the authoritative tree. The packaged portable executable's SHA-256 equals
the executable hash recorded by smoke, and its `SOURCE.txt` names the same main
commit.

| Verified file | SHA-256 |
| --- | --- |
| [Windows binary artifact ZIP](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244/artifacts/13429490041) | `29f99920e9e165b297f361b39093ecf622bf1616af93a6642a7c795070f631c8` |
| Portable `mdviewer.exe` | `fa3a648678270a750d6ee05ffcf61119f009c8bbd355f168b2dffb676f8110cf` |
| `MDviewer_0.2.0_x64-setup.exe` | `59b87cca3c341a0caf6fe0702eab4756f47e34cb87d6fef587a817eac9f04811` |
| Inner tracked `source.zip` | `5b0290835635702c31a1038ce1316705be994ab3f5b6eb7edf71a1c094a4a354` |
| [Native smoke artifact ZIP](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244/artifacts/13427024597) | `d699562b2c19cbe365e007051fbde30486742099bf90f502e667bf34ed9b04ae` |

The binary/source artifacts expire on 2026-12-05; the smoke evidence expires on
2026-11-19. [#169](https://github.com/Chris0Jeky/MDviewer/issues/169) records the
artifact identity, all-five-job qualification and remaining human checks. The
installer was built and checksummed; this smoke tested the portable executable
and does not claim a manual installation/uninstallation pass.

## Historical evidence and limits

Run 39775474433 captured matching UIA/native HWND identities without reading window text. Run 39777243620 confirmed successful filename write/readback and isolated Save-button selection failure. Run 39783780956 closed the dialog and the app reported saved Markdown, but the expected destination was absent; its actual saved path was not established. Run 39786113293, with the filename-change notification, produced the exact expected Markdown file, then exposed the second PDF dialog's missing UIA children. None of those is a fully passed native export run. Keep subsequent exact-head evidence with the PR.

The subsequent exact-head run for #158 at `08ce00a6f0ab6c45f3554599fd696354f1ffd284`
passed native Markdown/PDF saved-file verification:
[Windows Desktop 41948007431](https://github.com/Chris0Jeky/MDviewer/actions/runs/41948007431).
The same smoke passed for #172 at `42244b9f79162d303f012315fab6f3fe42b3325d`
in [Windows Desktop 41953423405](https://github.com/Chris0Jeky/MDviewer/actions/runs/41953423405).
These are executable/export checks; the human acceptance limits below remain open.

The `desktop-source` artifact contains a tracked-source ZIP, checkout commit, tree and SHA-256. Native smoke evidence includes owned-window screenshots, exact export hashes, process-tree samples and bounded worker checkpoints. Measurements include UI Automation/accessibility overhead and are not controlled startup or comparative RAM benchmarks.

This automation does not clear the separate human acceptance gates: installation/uninstallation, Explorer default-handler behavior, print-driver output, screen-reader acceptance, or performance on representative hardware. Previews remain unsigned; no release/deployment/updater is implied.
