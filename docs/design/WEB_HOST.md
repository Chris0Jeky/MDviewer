# The browser host (web parity)

Status: **W0, W1, W2a and W3 implemented; W2b, W4 and W5 open.** Contract: Track W in
[`2026-11-13-complete-push.md`](2026-11-13-complete-push.md). This note records how the browser host
meets the native file rules in [`FILE_LIFECYCLE.md`](FILE_LIFECYCLE.md) and where it cannot.

## Seam

Every platform call in the companion shell goes through one typed `Host` (`src/desktop/native.ts`).
Windows runs `tauriHost` (`src/desktop/hosts/tauri.ts`), and nothing else calls `invoke`. The
browser host (`src/desktop/hosts/browser.ts`) is loaded only by a web-shell build (the web build,
`vite.config.ts`, where the shell is the second entry `/desktop.html`; and the test build
`vite build --config vite.desktop.config.ts --mode webhost`) and only outside Tauri. In the Windows
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

## Following the file (W3)

A browser has no file watcher. While the tab is visible and the shell listens (`onFilesChanged`),
the browser host reads each open bound document's size and last-modified time at most once a second
and reports the tokens whose stamp moved since it last looked (on first sight, since the document
read the file). The shell then does exactly what it does for the native watcher: `readDocument`
adopts the change into a clean document and patches the reader; a document with unsaved edits keeps
them, shows the conflict bar and marks the file changed, and Save refuses until the change is taken.
Nothing is read while the tab is hidden; returning to the tab looks at once. Only open documents are
followed, never a folder; a deleted file is reported and the re-read answers `missing`. A file that
cannot be read for a moment (a lock, a permission) is skipped and looked at again next time.

## The shell on the web (W2a)

The web build serves the companion shell as a second entry, `/desktop.html`, on the browser host;
`/` stays the existing app until the default flip (W2b, with its human acceptance item AI-11). The
whole Windows shell suite (`tests/desktop-e2e/`) also runs on the browser host: project
`webhost-desktop` in `playwright.webhost.config.ts`, against the CSP'd `--mode webhost` build.
There the shared fixture opens real OPFS handles (one folder per pick), so documents are bound and
Ctrl+S saves in place; assertions that are about the fallback (a downloaded copy, "In memory", the
file input) reach the same behaviour through its explicit command or a dropped copy, and say so.
Specs that fake the Tauri IPC (`fakeHost.ts`) keep running the Tauri host there.

Running the suite on a file host surfaced, and this slice fixes, two things that were also true
on Windows but never exercised: the workspace's session strip with Save and Save As wrapped over
the editor in a small window (it now stays one line), and a dropped item with no file handle failed
the drop (it now opens as a copy).

Not yet on the web shell: the Library, session restore, relative links, local images and templates
(W4, W5). Until they land the browser host returns an empty
library, no session and an "is not available in this browser yet" error for linked files, images
and templates; the shell still shows the Library tab, so the default flip (W2b) must state or hide
what is not built yet.

## Proof

`tests/browser-host.test.ts` runs the host on in-memory handles. `tests/webhost-e2e/save.spec.ts`
runs the built shell in Chromium on origin private file system handles. The OS pickers cannot be
driven headless, so a test-only override returns those handles; the app reads, compares and writes
them through the same calls a picked file gets. It checks byte-for-byte round trips for UTF-8,
UTF-8 with BOM, UTF-16 LE and BE, and CRLF, LF and CR, the outside-change refusal, and Save As. In
Firefox it proves the fallback: open through the file input, Ctrl+S downloads a copy.

Not covered by automation: the real OS pickers, permission prompts, a file on a network or removable
drive, and the installed PWA's `launchQueue`. These are human acceptance (AI-11, added with W2).
