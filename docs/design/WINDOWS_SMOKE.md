# Windows native smoke boundary

The desktop workflow builds the release executable, then runs `scripts/desktop-smoke.ps1` against that actual binary. It does not substitute a browser mock for native file operations. The process refuses an existing MDviewer instance and cleans up only the processes it owns or has identified by PID and creation time.

## Native Save controls

Framework UI Automation can label the filename host `AppControlHost` even though the same HWND has native class `ComboBox`. The observed child is a native `Edit`, ID 1001, without a managed ValuePattern. The filename fallback requires the exact UIA FileNameControlHost, repeats PID/class/ancestry/enabled/read-only checks through Win32, and uses bounded messages with exact text readback. It does not write to an arbitrary Edit or use keyboard simulation.

When the managed provider also omits Save's InvokePattern, `desktop-save-button.cs` resolves only the verified dialog's ID 1 child. It requires a visible/enabled native Button, the same process, the exact direct parent and control ID. It activates only that owned dialog, validates again, and dispatches BM_CLICK with a 1.5-second bound. BM_CLICK has no return value: dispatch is not evidence of a successful export.

`scripts/test-desktop-save-button.ps1` exercises a real native positive fixture and rejection cases for invalid handles, process ownership, dialog/button classes, missing/wrong IDs, disabled/hidden controls and nested rather than direct children. These tests do not click, read text, or access document files. The workflow runs them before building the release application.

The actual smoke must subsequently find the newly saved Markdown file and compare every UTF-8 byte with its fixture. It must find the PDF with its header and EOF marker. A published probe attempt or a completed click is never substituted for these file checks. Full rendering fidelity remains covered separately by the production browser's saved-PDF pixel tests.

## Evidence and limits

Run 39775474433 captured the matching UIA/native HWND identities without reading window text. Run 39777243620 confirmed successful filename write/readback and isolated the remaining Save-button selection failure. Neither is a passed native export run. Keep subsequent exact-head evidence with the PR.

The `desktop-source` artifact contains a tracked-source ZIP, checkout commit, tree and SHA-256. Native smoke evidence includes owned-window screenshots, exact export hashes, process-tree samples and bounded worker checkpoints. Measurements include UI Automation/accessibility overhead and are not controlled startup or comparative RAM benchmarks.

This automation does not clear the separate human acceptance gates: installation/uninstallation, Explorer default-handler behavior, print-driver output, screen-reader acceptance, or performance on representative hardware. Previews remain unsigned; no release/deployment/updater is implied.
