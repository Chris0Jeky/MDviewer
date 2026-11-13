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
- **Save** re-reads the file and compares its size and digest with what this document last read or
  wrote. Any difference refuses the save as `conflict: changed`, a missing file as
  `conflict: missing`, and nothing is written. Only then does it write through `createWritable`,
  which Chromium commits by swapping a temporary file in on `close()`.
- **What this does not promise.** The native host holds the file open from the comparison to the
  commit. A browser cannot, so a write by another program in that window is not excluded. The UI
  therefore says Save "checks for outside changes before writing", never "conflict-safe".
- **Save** compares bytes, as the native host does: the size first, then the digest. `lastModified`
  is only a hint for following the file (W3), so a touched file with the same bytes saves normally.
- **Save As** asks with `showSaveFilePicker`, offering only the document's kind of extension
  (Markdown, or data and text, as `export_destination` requires; `excludeAcceptAllOption`). The
  picker is the commit point. Chromium can create or empty the chosen file by the time the picker
  returns, so a check after it could only leave an emptied file and a refusal. Every refusal
  (unknown token, mixed endings without consent, size) therefore happens before the picker opens,
  and the text is always written to the confirmed destination. The divergence from native: choosing
  the document's own file after another program changed it replaces it (the user confirmed the
  replacement in the picker), where native refuses. On success the document moves to a new token
  and the old one is revoked; if the document closed while the picker was open, the text is
  written and nothing is bound (`revoked-after-write`). New documents are written as UTF-8 with LF.
- **Exports** (PDF, Save a copy, data copies) stay ordinary browser downloads, as on the web
  today. The browser host has no `save`, so an export can never be written over a bound document.
- **Line patches** (Actionable Markdown) read the current file, place the patches by line and
  expected text (`unplaced` otherwise), keep every line ending byte-for-byte, and write with the same
  check. They apply the main `linepatch.rs` shape rules (1 to 256 patches, one per line, no NUL, no line break in `expect`; the per-line length cap is not mirrored). One retry
  on an outside change matches the native retry. A patched file keeps its mixed endings; only Save
  converts them to LF, after consent.
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
