# Windows native smoke boundary

The desktop workflow builds the release executable, then runs `scripts/desktop-smoke.ps1` against that actual binary. It does not substitute a browser mock for native file operations. The process refuses an existing MDviewer instance and cleans up only the processes it owns or has identified by PID and creation time.

## Native Save controls

Framework UI Automation can label the filename host `AppControlHost` even though the same HWND has native class `ComboBox`. It can also expose the second Save dialog without exposing any of its children. The parent harness therefore identifies only the exact owned `Save export` dialog through UIA; `desktop-save-button.cs` addresses its native controls.

The filename bridge enumerates at most 256 descendants of that verified dialog. It requires exactly one visible native `Edit` with ID 1001 under a `ComboBox` and `FloatNotifySink`, with matching process ownership, ancestry and enabled/visible state. A read-only Edit is rejected. The bridge writes a bounded path, requires exact readback, sends the documented `CBN_EDITCHANGE` notification only to the verified ComboBox's own parent, then rechecks identity and readback. No arbitrary Edit, keyboard simulation or document-derived target is used.

Save resolves only the verified dialog's direct ID 1 child. It requires a visible/enabled native Button, the same process, exact direct parent and control ID. It activates only that owned dialog, validates again, and dispatches BM_CLICK with a 1.5-second bound. BM_CLICK has no return value: dispatch is not evidence of a successful export.

`scripts/test-desktop-save-button.ps1` exercises a real native positive button fixture and rejection cases for invalid handles, process ownership, dialog/button classes, missing/wrong IDs, disabled/hidden controls, nested rather than direct children, missing/misplaced filename controls, and empty/NUL/oversized filename input. These rejection tests do not click, read text, or access document files. The actual application smoke is the positive integration test for the filename bridge.

The actual smoke must subsequently find the newly saved Markdown file and compare every UTF-8 byte with its fixture. It must find the PDF with its header and EOF marker. A published probe attempt or completed click is never substituted for these file checks. Full rendering fidelity remains covered separately by the production browser's saved-PDF pixel tests.

## Evidence and limits

Run 39775474433 captured matching UIA/native HWND identities without reading window text. Run 39777243620 confirmed successful filename write/readback and isolated Save-button selection failure. Run 39783780956 closed the dialog and the app reported saved Markdown, but the expected destination was absent; its actual saved path was not established. Run 39786113293, with the filename-change notification, produced the exact expected Markdown file, then exposed the second PDF dialog's missing UIA children. None of those is a fully passed native export run. Keep subsequent exact-head evidence with the PR.

The `desktop-source` artifact contains a tracked-source ZIP, checkout commit, tree and SHA-256. Native smoke evidence includes owned-window screenshots, exact export hashes, process-tree samples and bounded worker checkpoints. Measurements include UI Automation/accessibility overhead and are not controlled startup or comparative RAM benchmarks.

This automation does not clear the separate human acceptance gates: installation/uninstallation, Explorer default-handler behavior, print-driver output, screen-reader acceptance, or performance on representative hardware. Previews remain unsigned; no release/deployment/updater is implied.
