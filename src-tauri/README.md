# Windows host

This Tauri v2 shell embeds the `dist-desktop` frontend. Its window opens
`desktop.html`, and the existing editor/PDF application is loaded by that reader
only when requested. The host does not load the public website.

## Frontend bridge

Use `invoke` from `@tauri-apps/api/core` and `listen` from `@tauri-apps/api/event`.
Only the local `main` window has these capabilities.

```ts
interface OpenBatch {
  documents: Array<{ name: string; text: string; bytes: number }>;
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

The native reader accepts `.md` and `.markdown` (case-insensitive), UTF-8 with or
without a BOM, and UTF-16 LE/BE with a BOM. Invalid encodings are rejected rather
than silently replaced. Metadata and the actual read are both bounded. Each file
and each batch is limited to 25,000,000 disk/decoded bytes, and one batch/launch
queue is limited to 32 files. Errors are returned alongside successfully opened
documents. Only basenames are returned; absolute paths and document contents are
never logged. Opened documents stay in memory. UNC and device paths are rejected.

`open_external` accepts only HTTP(S) URLs without embedded credentials or control
characters. Call it only for an explicit user link action. Other schemes and
remote top-level navigation/new windows are denied. There are no generic filesystem, shell, HTTP, updater, or telemetry commands.
The opener plugin's automatic JavaScript link handler is disabled. Native dialogs
use `rfd` directly so browser `confirm()` retains its synchronous semantics.

`save_export` is the only write operation. It accepts a raw binary body and an
encoded safe basename, never a destination path. Markdown must be UTF-8; PDFs
must have a PDF signature. The frontend checks the 128 MiB cap before reading a
Blob into memory, and the host checks it before copying the request or opening a
dialog. A native Save dialog runs on a background thread. Only its chosen path
can be written. The host writes a temporary file in that directory, syncs it,
and atomically replaces the chosen destination; cancellation and validation
failure preserve existing bytes. Documents are never saved automatically.

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
