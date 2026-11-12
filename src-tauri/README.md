# Windows host

This Tauri v2 shell embeds the `dist-desktop` frontend. Its window opens
`desktop.html`, and the existing editor/PDF application is loaded by that reader
only when requested. The host does not load the public website.

## Frontend bridge

Use `invoke` from `@tauri-apps/api/core` and `listen` from `@tauri-apps/api/event`.
Only the local `main` window has these capabilities.

```ts
interface OpenBatch {
  documents: Array<{
    name: string;
    text: string;
    bytes: number;
    token: string | null;
    path: string;
    dir: string;
    encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be";
    eol: "lf" | "crlf" | "cr" | "mixed" | "none";
  }>;
  errors: Array<{ name: string; message: string }>;
  canceled: boolean;
}

const batch = await invoke<OpenBatch>("open_files");
const pending = await invoke<OpenBatch>("take_pending_files");
await invoke<void>("open_external", { url: "https://example.com" });
if (blob.size > 128 * 1024 * 1024) throw new Error("Export exceeds 128 MiB");
const saved = await invoke<{ canceled: boolean }>(
  "save_export", new Uint8Array(await blob.arrayBuffer()),
  { headers: { "x-mdviewer-filename": encodeURIComponent(filename) } },
);
```

`open_files` opens a native multi-file picker. It accepts no file path from the
frontend. `take_pending_files` drains OS launch arguments exactly once, including
arguments forwarded by a second launch. Register the `mdviewer:files-pending`
listener **before** the initial drain. Serialize frontend drains and drain again
if a notification arrives while a drain is in progress. An event contains no file
data; the native queue remains authoritative.

Windows passes quoted file paths as individual arguments. The host preserves each
argument, resolves relative paths against the launching process's working
directory, and never splits a path on spaces. Native drag/drop is disabled so the
reader's regular browser `File` drop handling can be used.

The native reader accepts Markdown (`.md`, `.markdown`) and, for Readable data
(docs/design/READABLE_DATA.md; owner-requested boundary change 2026-11-12), data and
plain text (`.json`, `.jsonc`, `.jsonl`, `.ndjson`, `.txt`, `.log`), all case-insensitive
and read as raw text under the same rules (`file_policy::DATA_EXTENSIONS`): UTF-8 with or
without a BOM, and UTF-16 LE/BE with a BOM. Invalid encodings are rejected rather
than silently replaced. Metadata and the actual read are both bounded. Each file
and each batch is limited to 25,000,000 disk/decoded bytes, and one batch/launch
queue is limited to 32 files. Errors are returned alongside successfully opened
documents. Display paths (`path` and `dir`) are returned for opened documents
(owner-authorized boundary change, companion push 2026-11-11); the webview still
cannot supply a path. Paths and document contents are never logged. Errors retain
only a basename and a closed message.

A process-lifetime capability registry behind a mutex holds at most 32 bindings,
each with a random 128-bit token, native path, same-read-handle Windows identity,
SHA-256 of the raw bytes, byte length, encoding, original line-ending style and
generation. Duplicate opens receive distinct tokens; at capacity (or if secure
randomness is unavailable), files still open with `token: null` and no existing
binding is evicted. `release_document(token)` revokes a closed document's binding.
Opened documents stay in memory. UNC and device paths are rejected.

`open_external` accepts only HTTP(S) URLs without embedded credentials or control
characters. Call it only for an explicit user link action. Other schemes and
remote top-level navigation/new windows are denied. There are no generic filesystem, shell, HTTP, updater, or telemetry commands.
The only window permissions are `core:window:allow-destroy` (guarded close) and
`core:window:allow-set-always-on-top` (the reader's "Keep on top of other windows"
command, which only toggles the main window's z-order); `core:window:default` is not granted.
The opener plugin's automatic JavaScript link handler is disabled. Native dialogs
use `rfd` directly so browser `confirm()` retains its synchronous semantics.

`patch_document(token, patches)` (actionable Markdown write-back, A2) applies line patches
`{line, id?, expect, replace}` to a bound file as one change. It reads raw bytes and identity
through one handle (`replace::snapshot_read`), splits lines over raw UTF-8 bytes or UTF-16
code units after a BOM, and changes only the placed lines' content bytes: the BOM, every line
terminator (mixed endings included) and a final terminator are kept. Placement: the remembered
`line` (1-based, as the webview parser numbers lines; 0 is invalid) if it still equals `expect`,
and only that natively; `unplaced.index` is the patch's 0-based position in the change. The contract's later steps (the
one line carrying the id, then the one equal line) need the Markdown syntax (code blocks,
control kinds), so when the remembered line does not match, nothing is written and `unplaced` returns the current text so the parser can re-derive
the patch (syntax-aware span edits stay in the webview). A replacement with a line break is
refused; patches are all-or-nothing. The commit goes through `replace_if_unchanged` against
the bytes just read, with one re-read and retry on conflict; the binding then moves to the new
bytes, so the watcher sees no outside change.

`save_document` and `save_document_as` are the owned writes (FILE_LIFECYCLE.md,
#196). Each takes the UTF-8 text as a raw body plus headers: an opaque
`x-mdviewer-token`, the `x-mdviewer-generation` the frontend last saw, and
`x-mdviewer-accept-lf` for a mixed-line-ending source. Neither accepts a path.
`save_document` re-encodes to the binding's encoding and line endings and calls
`replace::replace_if_unchanged` with the identity and digest the binding read;
`save_document_as` opens the native dialog, compares an existing destination with
what it held at selection (or with this binding's read, for its own file), uses
`create_new` otherwise, registers the new binding and revokes the old token. A data or
text document's Save As offers and requires a data or text extension (its own first); any
other document saves as Markdown.
Results are `{outcome: "saved" | "canceled" | "conflict" | "mixed-line-endings" |
"failed", ...}` with stable codes and no paths. One dialog or write runs at a time;
each save first reconciles interrupted saves in its folder.

Live reload: `watch.rs` follows the parent folder of each bound file through OS
change notifications (`notify` 8.2.0, ReadDirectoryChangesW; no polling). It starts
with the first bound document, watches each folder once and non-recursively, and
unwatches a folder with its last file. Bursts are coalesced (150 ms quiet) into one
`mdviewer:files-changed` event whose payload is capability tokens only.
`read_document(token, adopt)` then reports `unchanged` (the bytes this binding last
read or saved, so this app's own save never echoes), `missing`, or `changed`; only
`adopt: true` returns the text and moves the binding to the new bytes, so a dirty
document's Save still conflicts.

Library (`library.rs`, `commands/library.rs`): `library.json` in the app's local data folder
holds recent files (500), pinned files and project folders (64 each) and last-seen stamps —
absolute paths and Unix-millisecond times only, written atomically. It is loaded on first
library use; a corrupt file is renamed `library.json.corrupt-<ms>` and replaced by an empty
library. Opens and Save As record recents. Commands take opaque per-process ids (`library_list`,
`library_scan`, `library_open`, `library_pin` by token or id, `library_unpin`, `library_forget`,
`library_mark_seen`, `library_add_project` via the native folder picker, `library_clear`); the
webview never supplies a path. `library_scan` walks a pinned project for `.md`/`.markdown` files
(depth 8, 5,000 files), skips `node_modules`, `.git`, `target`, `dist`, `build` and `.venv`,
includes dot-folders such as `.claude`, never follows junctions or symlinks, and marks agent
files (`CLAUDE.md`, `AGENTS.md`, `SKILL.md`, `.claude/agents/*.md`, `MEMORY.md`, `memory/*.md`,
`HUMAN_TODO.md`, `ACTION_ITEMS.md`, `ORCHESTRATOR.md`) and files changed since last seen.

`library_read_template(id) -> { name, text }` (A4; boundary change: one read-only command and its
permission) reads a template to fill a new note. The id must come from `library_scan` and name a
Markdown file directly inside a pinned project's `templates/` folder; a junction or symlink at the
folder or the file is refused; the usual local-path and encoding rules apply, with a 1 MB cap
(`MAX_TEMPLATE_BYTES`). Nothing is bound, watched, recorded as recent or seen, or written to
`library.json`.

Session (S7): `library.json` also keeps the bound files open when the open set last changed
(`session`, 32 paths with timestamps) and `restore_off` (reopen on launch is on by default; Clear
library keeps the preference). `session_record(tokens)` maps tokens to paths natively;
`session_restore()` reopens what is not already open after the launch queue drains, without
taking focus from launch files; `session_setting(restore?)` reads or changes the preference.

Relative references (`assets.rs`, `commands/links.rs`): `open_relative(token, href)` opens a
Markdown file a document links to (`other.md`, `../x.md#part`, `@CLAUDE.md`, or an
extensionless wiki-style name, which gets `.md`; a link to any other extension, data and
text files included, is refused, since a link opens and binds its target with no dialog), and `read_asset(token, src)` returns the raw
bytes of a local image it shows (PNG, JPEG, GIF, WebP, SVG; 20 MB). Both resolve against the
folder of that document's own binding, refuse URLs, absolute, rooted, drive-relative, UNC and
device forms, never climb above the drive root, refuse a path through a symlink or junction
the document's own folder path does not already contain (one could point at a network
share and start an SMB connection unasked), and re-apply the local-file policy (opens go
through `read_batch`). The webview sends only the token and the reference as written.

`save_export` writes explicit copies (Save Markdown, PDF, and a data or text copy). It accepts a raw binary body and an
encoded safe basename, never a destination path. Markdown, data and text must be UTF-8; PDFs
must have a PDF signature. The frontend checks the 128 MiB cap before reading a
Blob into memory, and the host checks it before copying the request or opening a
dialog. A native Save dialog runs on a background thread. Only its chosen path
can be written. The host writes a temporary file in that directory, syncs it,
and atomically replaces the chosen destination; cancellation and validation
failure preserve existing bytes. Documents are never saved automatically; a line patch
runs only for an explicit actionable-Markdown gesture (enforced by the webview).

Browser download events are denied. This avoids opening modal UI inside
WebView2's synchronous download event, which does not support reentrancy. The
async save command reports cancellation as `{ canceled: true }`, success as
`{ canceled: false }`, and failures as closed messages without paths or content.

## Build and test

Use the Rust toolchain pinned in `rust-toolchain.toml` and the committed
`Cargo.lock`. On a Windows build machine, after the repository's `npm ci`:

```powershell
npm run desktop:build:web
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run desktop:build
```

The repository npm scripts provide the desktop Vite entry point, development
host, locked native build and native notice generation. Follow the root desktop
build documentation for the current packaging commands.

The host requires an actual `dist-desktop/desktop.html` for release builds.
`cargo test` exercises file bounds/encoding/path policy, launch queue behavior,
export filename/size rules, atomic save behavior, and external navigation policy.
The Windows smoke script exercises a running WebView2 window and native Save dialogs.
The standard-library file policy also supports an isolated portability check:

```sh
rustc --edition=2021 --test src-tauri/src/file_policy.rs -o file-policy-tests
./file-policy-tests
```

Windows artifacts are the release `mdviewer.exe` (frontend assets embedded) and
the per-user NSIS installer in `target/.../release/bundle/nsis`. Keep the executable,
source/provenance and third-party notices together in the portable ZIP. The
portable executable needs an installed WebView2 Evergreen runtime. The installer
downloads that runtime only if needed. App operation and bundled features work
offline after installation. The installer registers Markdown file handling;
Windows still controls the user's selected default app.

## Conflict-safe replace (experimental)

`src/replace.rs` is an isolated primitive; no production IPC calls it. Eligible
files are ordinary single-link files on local **fixed NTFS/ReFS volumes**. This
experiment was run on Windows/NTFS; ReFS has not been qualified. UNC/network
drives, device/extended input paths, alternate-stream paths, ambiguous DOS names,
reparse points at the file or any ancestor, multiple hard links, and the reserved
`.mdv-replace-` filename namespace are refused. Non-Windows implementations return
`Unsupported`. Input paths must be absolute ordinary drive paths.

`snapshot_read` reads identity and bounded raw bytes through one handle. Saves
compare the volume, 128-bit file ID (legacy file-index fallback if unsupported),
length and SHA-256 (the pinned `sha2` crate the registry also uses, checked against
four known-answer vectors). Read-only originals are refused as `Locked`, the written
temporary is read back and must match the requested bytes before commit, and
recovery keeps scanning past a journal it cannot reconcile.
The original and every ancestor stay open without write/delete sharing through
verification and commit. Existing writable handles or mapped views cause a
`Locked` refusal, including a writable view retained after its file handle closes.
The two no-clobber renames use `NtSetInformationFile` with a leaf name and NULL
root, relative to the source handle's directory. This avoids reopening a locked
parent for writes. See Microsoft's [rename-information contract](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)
and [sharing contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).

A sibling `.journal` records the destination leaf and old/new identities and
digests; `.tmp` and `.old` names derive from its unique basename. Scratch files
start with delete-on-close until the flushed journal owns them; the extended
on-close disposition explicitly cancels that creation flag before renaming.
The destination can be briefly absent between renames: this is **not an atomic
namespace exchange**. A process claiming that name wins; its file is never
overwritten. `create_new` uses the same no-clobber commit without an original.
`recover_journal` rolls the verified aside back when the name is empty and the save
never committed. If an outside file took the name, or the committed file was later
moved away, the original's bytes are kept as a visible `name (MDviewer recovered
<id>).ext` sibling rather than deleted. Otherwise it preserves the existing
destination and cleans only verified transaction artifacts. Repeated recovery is
harmless, and one stuck journal does not stop the rest of the folder. Modified
artifacts, malformed journals or locked files are refused and retained. Once the
new file is in place a save returns success even if cleanup failed; the leftover
aside or journal is reconciled by the next recovery. New files inherit directory defaults; timestamps, custom
ACLs, alternate streams and other metadata are not preserved by this byte API.

The release tests re-invoke their own executable as a separate OS process. Four
forced interleavings (before open, after verification, between renames and after
commit) cover writes, truncation, replacement, delete/recreate, equal-size/time
edits, mapped writes, parent/ancestor swaps and create-new collisions. On NTFS:
184 trials, **100 saved / 84 refused**, with no acknowledged external-byte loss;
28 injected-error/process-exit cases recovered, plus external-claimant and
tampered-artifact recovery checks. The full 33-test suite ran within the 60-second
budget. File-symlink creation was unavailable to the sandbox; junction rejection
was exercised. `cargo fmt --check` passes; strict Clippy is blocked by two existing
`file_policy.rs` lints, with no new-module warnings. The standalone file-policy
tests pass, and the non-Windows module compiles for Android.

Successful file flushes are **not a power-loss durability claim**. These tests
exercise process exit and injected disk/flush/rename failures, not sudden power
loss or a physically exhausted disk. ReFS, the legacy identity fallback and native
Save IPC/UI integration remain unverified. The `ReplaceFileW` fallback is not used.

## Validation limits

WebView2 is a multiprocess web renderer. A small application download does not
establish a small working set. Measure the host and **all associated WebView2
processes** for cold launch, ordinary reading, a large code/diagram document,
entering the PDF workspace, and repeated opens. Do not publish RAM or startup
claims based only on the executable size or the frontend bundle size.

Windows runtime smoke tests must cover file associations, a second launch with a
space/Unicode filename, file picking, drag/drop, native close behavior while
editing, print/PDF, and operation without a network connection. Browser-only tests
cannot substitute for that native integration check.

Primary API references:

- [Tauri Vite integration](https://v2.tauri.app/start/frontend/vite/)
- [Windows installers and runtime options](https://v2.tauri.app/distribute/windows-installer/)
- [Single-instance arguments](https://v2.tauri.app/plugin/single-instance/)
- [App command permissions](https://docs.rs/tauri-build/2.7.3/tauri_build/struct.AppManifest.html)
- [Native file dialog](https://docs.rs/rfd/0.16.0/rfd/struct.FileDialog.html)
- [Navigation and new-window hooks](https://docs.rs/tauri/2.12.4/tauri/webview/struct.WebviewWindowBuilder.html)
- [Opener automatic link handling](https://docs.rs/tauri-plugin-opener/2.7.2/tauri_plugin_opener/struct.Builder.html)
- [Tauri raw IPC bodies](https://v2.tauri.app/develop/calling-rust/#accessing-raw-request)
- [WebView2 threading and reentrancy](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model)
- [WebView2 process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)
