# The browser host (web parity)

Status: **W0 and W1 implemented; W2 to W5 open.** Contract: Track W in
[`2026-11-13-complete-push.md`](2026-11-13-complete-push.md). This note records how the browser host
meets the native file rules in [`FILE_LIFECYCLE.md`](FILE_LIFECYCLE.md) and where it cannot.

## Seam

Every platform call in the companion shell goes through one typed `Host` (`src/desktop/native.ts`).
Windows runs `tauriHost` (`src/desktop/hosts/tauri.ts`), and nothing else calls `invoke`. The
browser host (`src/desktop/hosts/browser.ts`) is loaded only by a web-shell build
(`vite build --config vite.desktop.config.ts --mode webhost`) and only outside Tauri. In the Windows
build the selection folds to `tauriHost` and the browser host is not bundled; CI job `webhost` greps
`dist-desktop` to keep it that way. Where the browser lacks `showOpenFilePicker` and
`showSaveFilePicker` (Firefox and Safari today), `browserHost.available` is false and the shell keeps
its file input, Save Copy download and in-memory documents.

## Binding and Save (W1)

- A document is bound only to a handle the user picked (`showOpenFilePicker`), dropped
  (`DataTransferItem.getAsFileSystemHandle`, requested inside the drop event) or launched the
  installed app with (`file_handlers` with `launchQueue`). Tokens and handles live in page memory;
  nothing is persisted until W5.
- On open the host records the file's size, `lastModified` and SHA-256, plus its encoding and line
  endings. The rules are the native ones, mirrored in `src/desktop/hosts/codec.ts` and tested with
  the Rust cases in `tests/browser-codec.test.ts`.
- **Save** re-reads the file and compares size, `lastModified` and digest with what this document
  last read or wrote. Any difference refuses the save as `conflict: changed`, a missing file as
  `conflict: missing`, and nothing is written. Only then does it write through `createWritable`,
  which Chromium commits by swapping a temporary file in on `close()`.
- **What this does not promise.** The native host holds the file open from the comparison to the
  commit. A browser cannot, so a write by another program in that window is not excluded. The UI
  therefore says Save "checks for outside changes before writing", never "conflict-safe".
- **Save As** asks with `showSaveFilePicker`. Choosing the document's own file (`isSameEntry`) gets
  exactly Save's check. Another existing file is compared against what it held when it was chosen.
  A name MDviewer does not open is refused (`invalid-destination`). On success the document moves to
  a new token and the old one is revoked. New documents are written as UTF-8 with LF.
- **Line patches** (Actionable Markdown) read the current file, place the patches by line and
  expected text (`unplaced` otherwise), keep every line ending byte-for-byte, and write with the same
  check. One retry on an outside change matches the native retry.
- **Re-read** (`readDocument`) follows `reload.rs`: same bytes are `unchanged`; a change is held
  without `adopt` (a later Save still conflicts) and adopted with it (new baseline, generation + 1).
- Write permission is asked for (`requestPermission`), never assumed. A refusal reports
  `permission-denied` and keeps the text open.

## Proof

`tests/browser-host.test.ts` runs the host on in-memory handles. `tests/webhost-e2e/save.spec.ts`
runs the built shell in Chromium on origin private file system handles. The OS pickers cannot be
driven headless, so a test-only override returns those handles; the app reads, compares and writes
them through the same calls a picked file gets. It checks byte-for-byte round trips for UTF-8,
UTF-8 with BOM, UTF-16 LE and BE, and CRLF, LF and CR, the outside-change refusal, and Save As. In
Firefox it proves the fallback: open through the file input, Ctrl+S downloads a copy.

Not covered by automation: the real OS pickers, permission prompts, a file on a network or removable
drive, and the installed PWA's `launchQueue`. These are human acceptance (AI-11, added with W2).
