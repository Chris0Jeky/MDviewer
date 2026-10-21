# MDviewer for Windows

The experimental Windows app opens Markdown directly in a continuous reading view.
It uses Windows' WebView2 runtime in its own window. The source editor and paginated
PDF workspace load when you choose **Edit & PDF**.

## Get the app

Open the [Windows Desktop workflow](https://github.com/Chris0Jeky/MDviewer/actions/workflows/desktop.yml)
and select a successful run for the commit you want to try. Download the
`mdviewer-windows-x64` artifact and extract it. GitHub may require you to sign in to
download Actions artifacts.

- **Installer:** run the `*-setup.exe` file. It installs for your Windows account,
  registers `.md` and `.markdown` file handling, and installs the Microsoft WebView2
  Evergreen runtime if needed. Windows still controls the default application;
  choose MDviewer through **Open with** if it is not your default.
- **Portable:** keep `mdviewer.exe` together with its license, source and third-party
  notice files. Run the executable or pass it a Markdown filename. The portable
  app needs WebView2 already installed.

These CI builds are unsigned previews. Windows may display an unknown-publisher
prompt. There is no automatic updater; use a newer successful workflow artifact to
update. Download/build size is not a promise about memory use.

## Read and edit

Open a file with **Open Markdown**, drop files into the window, or open a file from
Explorer. Launching another file reuses the existing MDviewer window. A document
selector keeps multiple files open. The reader includes a heading outline, text-size
controls, and light, dark and sepia screen themes. Code highlighting, math,
diagrams, tables and footnotes use the same rendering modules as the web app.

Choose **Edit & PDF** to edit source and use the existing page-safe preview. **Reader
view** returns with your open documents and edits preserved. **Save Markdown** saves
a copy of the source; **Print / Save as PDF** uses the print dialog, and **Download
PDF** creates the raster fallback. Exports do not overwrite the original file
automatically. Closing an edited document asks before discarding changes. During
export, returning to the reader or closing the app waits for the operation to finish.

`Ctrl+O` opens a file. In the editing workspace, `Ctrl+S` saves Markdown. In the
reader, `Ctrl+W` closes the current document. Native window controls close the app.

## Local files and limits

Documents stay in memory until you explicitly export them. The app has no account,
document uploads, autosave, recently opened list or document telemetry. It saves
only display settings. Bundled rendering assets work without a network connection
after WebView2 is installed. Clicking a normal HTTP(S) link opens your default
browser; other link schemes and automatic remote resource loads are blocked.

The host accepts local `.md` and `.markdown` files, including names containing spaces
or Unicode. It reads UTF-8, UTF-8 with a BOM, and UTF-16 LE/BE with a BOM. Malformed
text is rejected. UNC/network and device paths are not accepted. File batches and
open-document imports are bounded to 32 documents and 25,000,000 bytes. Large
browser-picker/drop imports ask before rendering; native reads remain hard-bounded.
Editing a document can increase its size; returning to reading reports any exceeded
session limit and keeps the editing workspace intact so you can save or close files.

Linked local images and remote images are blocked by the shared sanitizer. Embedded
raster images work. There is no file watcher, direct in-place save, Explorer preview
handler or shell extension in this first version.

## Build on Windows

Install Node 24, the Rust toolchain from `src-tauri/rust-toolchain.toml`, the Microsoft
C++ build tools required by Tauri, and WebView2. From a clean checkout:

```powershell
npm ci --engine-strict
npm run desktop:dev
```

For a release executable and installer:

```powershell
npm run desktop:build
```

The build uses the checked-in npm and Cargo lockfiles and generates source/license
notices. The executable is `src-tauri/target/release/mdviewer.exe`; the installer is
under `src-tauri/target/release/bundle/nsis/`. The existing source-provenance guard
requires a clean Git checkout, or an honestly labelled source-archive build.

The reader can also be inspected without Rust using `npm run desktop:dev:web` and
opening `/desktop.html` on the reported port. That mode cannot validate Explorer
integration, native dialogs, native window-close behavior or WebView2 memory use.

## Verification and measurements

The Windows workflow runs the production reader browser suite, native file/URL
policy tests, the locked release build, and a smoke test of the actual executable.
The smoke test opens ordinary and Unicode filenames, verifies rendered headings,
forwards a second launch to the original app, and records the host **and all of its
WebView2 descendants**. The `windows-desktop-smoke` artifact contains `metrics.json`
and screenshots where the runner supports capture. Browser tests cover the reading
path, absent initial editor/pagination, hostile Markdown, file limits, repeated
edit/read transitions, and both PDF paths under the production CSP.

Memory figures from a hosted runner are diagnostic observations. A useful comparison
on your PC should include cold start, an ordinary file, a large code/diagram file,
the PDF workspace, and repeated opens. WebView2 uses multiple processes; measuring
only `mdviewer.exe` would understate its footprint. The app has not established a
lower-RAM claim than an additional tab in an already-running browser.

Explorer associations, install/uninstall, SmartScreen experience and your preferred
print driver still need acceptance on a normal Windows desktop. Existing web human
acceptance items AI-6/AI-7/AI-8/AI-9 remain separate and open.

See [the design](design/WINDOWS_READER.md) and [native host contract](../src-tauri/README.md)
for implementation details.
