# MDviewer for Windows

The experimental Windows app opens Markdown directly in a continuous reading view.
It uses Windows' WebView2 runtime in its own window. The source editor and paginated
PDF workspace load when you choose **New** or **Edit & PDF**.

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

Open a file with **Open** in the reader or **Open Markdown** in the editing workspace,
drop files into the window, or open a file from Explorer. Launching another file
reuses the existing MDviewer window. A document selector keeps multiple files open.
The reader includes a heading outline, text-size
controls, and light, dark and sepia screen themes. Code highlighting, math,
diagrams, tables and footnotes use the same rendering modules as the web app.

Choose **New document** from the empty reader, or **New** from either toolbar, to
start writing a blank note. Existing files stay open. New notes use the first
available name (`Untitled.md`, `Untitled 2.md`, and so on), and the source pane is
shown and focused. An untouched blank note can close without a discard prompt.

Choose **Edit & PDF** to edit an opened file and use the existing page-safe preview.
**Reading view** returns with your open documents and edits preserved. **Save Markdown**
saves a copy of the source. The session still compares edits with the original text
that was opened or created, so saving a copy does not clear an edited document's
discard confirmation. You may still be asked before closing it after a successful save.

**Print / Save as PDF** uses the print dialog, and **Download PDF** creates the raster
fallback. Exports do not overwrite the original file automatically. Wait for an
export to finish before returning to the reader or closing the app.

PDF progress stays visible at the bottom of the workspace, including Markdown-only
and short Find layouts. It reports completed pages, then the pending native Save
dialog, and distinguishes saved, canceled and failed outcomes. Failures include a
short reason and permit retry; focus and source position stay where you left them.
The browser build reports “download requested” after handing the file to the browser.

**Document layout** starts collapsed to leave more room for writing. Open it to
adjust typography, paper, margins and page furniture; press Escape within the
controls to collapse it and return focus to its heading. Collapsing the controls
keeps every layout setting and your Markdown unchanged.

| Shortcut | Action | Available in |
| --- | --- | --- |
| `Ctrl+N` | Start a new document, preserving open files | Reader and editing workspace |
| `Ctrl+O` | Open Markdown files | Reader and editing workspace |
| `Ctrl+S` | Save a Markdown copy | Editing workspace |
| `Ctrl+F` | Find source text | Workspace with the source pane visible; reader and Preview-only keep WebView Find |
| `Ctrl+H` | Open source replacement controls | Workspace with the source pane visible |
| `Ctrl+W` | Close the current document | Reader |

Native window controls close the app. Workspace controls stay unavailable while a
mode change is completing. New is unavailable during a mode change, export or native
save dialog.

### Find and change source text

In the editing workspace, choose **Find** above the Markdown source or press
**Ctrl+F**. Type literal text, use **Match case** when needed, and move through
results with **Enter** / **Shift+Enter** in the Find field, or the arrow buttons.
The source scrolls to the selected match while your typing stays in the search field.

Choose **Replace…** or press **Ctrl+H** to reveal replacement controls. **Replace**
changes the selected match; **Replace all** changes every result as one undoable
edit. Replacement text is used exactly as typed; **Enter** in the replacement field
replaces the selected match. **Escape** closes Find and returns to the source.
In Preview-only mode, Ctrl+F keeps the normal browser/WebView Find.

Very broad searches show a refinement notice after 10,000 results and disable
Replace all until the search is narrowed. Search text is limited to 2,000
characters. The usual document size and confirmation limits still apply to edits.
Search state stays in memory and is never added to saved Markdown or PDF output.
In short windows, Find temporarily uses the workspace for source text; closing it
restores your Split layout.

The current match stays visibly marked in the source while the Find field keeps
keyboard focus, so you can follow repeated results without leaving the query.
The marker does not change your Markdown and is excluded from print and PDF output.
In forced-colors mode, the source uses system text colors and the match uses a
visible outline. Syntax colors are suppressed in that mode so the native text
surface follows the selected contrast theme.
See the [authoring checkpoint](design/2026-11-05-authoring-checkpoint.md) for verified
coverage and the remaining human Windows checks.

## Local files and limits

Documents stay in memory until you explicitly export them. The app has no account,
document uploads, autosave, recently opened list or document telemetry. It saves
only display settings. Bundled rendering assets work without a network connection
after WebView2 is installed. Clicking a normal HTTP(S) link opens your default
browser; other link schemes and automatic remote resource loads are blocked.

The host accepts local `.md` and `.markdown` files, including names containing spaces
or Unicode. It reads UTF-8, UTF-8 with a BOM, and UTF-16 LE/BE with a BOM. Malformed
text is rejected. Explicit UNC and device paths are not accepted. File batches and
open documents, including new notes, are bounded to 32 documents and 25,000,000
UTF-8 bytes at admission. Large
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
Local reader tests use port 5183 by default. Set `DESKTOP_E2E_PORT` to another
available port when testing multiple checkouts; the request audit follows that
configured origin. Tests always start their own preview server and fail if the
port is occupied, so an older checkout cannot supply a misleading passing result.
The smoke test opens ordinary and Unicode filenames, verifies rendered headings,
forwards a second launch to the original app, and records the host **and all of its
WebView2 descendants**. The `windows-desktop-smoke` artifact contains `metrics.json`
and screenshots where the runner supports capture. The same smoke enters the
editing workspace, verifies both actual native Save dialogs, compares every saved
Markdown UTF-8 byte with its fixture, and checks the saved PDF header and EOF marker.
Those file checks are separate from the production browser's saved-PDF visual tests.
Browser tests cover the reading path, absent initial editor/pagination, hostile
Markdown, file limits, repeated edit/read transitions, and both PDF paths under the
production CSP.

`npm run test:authoring` checks a bounded set of the production web and desktop
authoring flows in Firefox after both frontend builds. It covers native undo,
Find/Replace, keyboard New/Open/Save, layout/focus, source scrolling, short-window
reflow and accessibility states. The CI `firefox-authoring-evidence` artifact
records screenshots, failure traces and actual browser versions. This is separate
from native WebView2, real Narrator, operating-system IME and Windows contrast-theme
acceptance. Those human checks remain in #169 and AI-6. See
[the coverage and limits](design/AUTHORING_QUALITY.md).

Memory figures from a hosted runner are diagnostic observations. A useful comparison
on your PC should include cold start, an ordinary file, a large code/diagram file,
the PDF workspace, and repeated opens. WebView2 uses multiple processes; measuring
only `mdviewer.exe` would understate its footprint. The app has not established a
lower-RAM claim than an additional tab in an already-running browser.

Explorer associations, install/uninstall, SmartScreen experience, keyboard/Narrator
behavior and your preferred print driver still need acceptance on a normal Windows
desktop. [Issue #169](https://github.com/Chris0Jeky/MDviewer/issues/169) tracks those
checks, representative performance measurements and the signing/distribution decision.
Existing web human acceptance items AI-6/AI-7/AI-8/AI-9 remain separate and open.

## Future work

[Future work](FUTURE_WORK.md) and [tracker #195](https://github.com/Chris0Jeky/MDviewer/issues/195)
record the remaining improvements and product decisions. Native file saving
([#196](https://github.com/Chris0Jeky/MDviewer/issues/196)) and optional recovery
([#197](https://github.com/Chris0Jeky/MDviewer/issues/197)) are design-first proposals.
This preview continues to save copies and does not store documents automatically.

See [the design](design/WINDOWS_READER.md) and [native host contract](../src-tauri/README.md)
for implementation details.
