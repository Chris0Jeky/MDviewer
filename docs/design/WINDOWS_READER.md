# Windows reader experiment

## Goal

Open a Markdown file from Explorer as a readable document, with little setup and
without starting an IDE or a full browser window. Keep the existing rich Markdown
renderer and page-safe PDF workspace available on demand. This is an experimental
Windows distribution until the native acceptance and memory measurements are done.

## Design

The Tauri 2 host uses the system WebView2 runtime. A separate `desktop.html` entry
starts a continuous reader. The initial reading path imports neither the source
editor nor Paged.js, does not create printable pages, and does not register a service
worker or load Pulseboard. Markdown, code, math, diagrams and sanitization reuse the
existing render modules. Footnotes remain endnotes, and heading links work directly.

New, Open, drag/drop, document switching, text size, screen themes and a heading
outline are available in the reader. New and Edit & PDF import the existing App
lazily and transfer documents in memory. New creates a blank source with the first
available Untitled name and an empty clean baseline, preserving the existing session
and its admission limits. An untouched blank source closes without a discard prompt.
Returning to reading flushes pending edits, clears the pagination host and destroys
the workspace. Edited work requires an explicit discard confirmation when closing.
Save Markdown writes a copy and does not reset the original-source dirty baseline.
Documents never persist automatically.
The old reader source list is released once the workspace safely owns its documents
and dirty baselines. Closed-document baselines are pruned; successful return clears
them. Failed return validation keeps the workspace intact, and a failed teardown
flush restores its original document identities, edits and selection for retry.
The workspace stays inert through initial rendering during entry, then releases
readiness and finishes queued imports before focusing the source. It also stays
inert during return so a late edit or Save shortcut cannot race that ownership
transfer. Entry/return failure releases the guard and preserves the appropriate
source owner for recovery; a failed return restores interaction as well as source.
New and Reading view use the same transition, export and native-save busy guards.

Native file reads come only from the OS launch arguments or a native picker. The
renderer cannot request arbitrary paths. The host validates extensions, encodings,
local paths and bounded reads; batches and the reader session are capped at 32 files
and 25,000,000 bytes. Explicit web links may open the default browser. Other schemes
and navigation away from the bundled application are blocked.
Undo Close checks the same open-document count and current UTF-8-byte totals before
consuming recovery. A refusal preserves the latest closed source and offer; reducing
another document's size can allow retry. A new explicit close replaces that offer.
Restored sources retain unsaved-work protection on return to reading. The one-close
snapshot remains memory-only and is cleared by Discard or workspace teardown.

Import failures are reported immediately and remain alongside warnings or a render
failure for the accepted document in the same batch. A coalesced empty native drain
does not erase them. Each render captures its notice revision, so a late warning or
failure cannot overwrite a newer action or errors-only batch. No notice history or
document text is persisted. Regression coverage includes picker/forwarded batches,
obsolete renders and the production browser's empty-plus-invalid-file case.
An empty native drain also leaves pending picker selection intact. A real forwarded
batch claims selection only if no newer user action occurred during its read;
otherwise its documents are appended without replacing the current selection.
Workspace-entry failures also accompany recovery-render warnings or failures, and
Sample admission errors accompany warnings for the retained document. These paths
use the same notice-revision and render-generation fences as imported batches.

## Verification and distribution

Unit tests cover ingestion limits, late results and host queue draining. Real
Chromium tests cover rendered Markdown, absence of initial pagination/editor/network
requests, switching documents, the lazy workspace round trip and PDF exports under
the production CSP. Windows Actions compiles/tests the locked native host, builds
an unsigned per-user NSIS installer and portable executable, and records a native
launch/save smoke. The smoke verifies the two actual Save dialogs, exact saved
Markdown bytes, and the saved PDF header/EOF. Existing web CI and no-slice checks
remain required. Completed authoring and combined-main qualification are recorded
in the [authoring checkpoint](2026-11-05-authoring-checkpoint.md).

No RAM or startup target is claimed from executable size. Native measurements must
include the host plus the complete associated WebView2 process tree, with empty,
ordinary and large documents, before and after entering the PDF workspace.

## Limits

Local/remote linked images remain blocked by the existing sanitizer; embedded raster
images work. There is no watcher, autosave, recents list or shell preview extension.
File associations, both native export dialogs and startup/memory on Chris's Windows
machine require acceptance. [Issue #169](https://github.com/Chris0Jeky/MDviewer/issues/169)
tracks the installation, accessibility, printing, performance and distribution evidence.
Existing AI-6/7/8/9 remain open and separate.

[Future work](../FUTURE_WORK.md) and [#195](https://github.com/Chris0Jeky/MDviewer/issues/195)
track further improvements. Native file saving in #196 and optional recovery in #197
have concrete [file lifecycle](FILE_LIFECYCLE.md) and [recovery](RECOVERY.md) proposals.
They do not change the current copy-saving or memory-only document contracts. Owned
writes remain gated on a tested Windows conflict-safe commit primitive; recovery
remains default-off design work with explicit storage/deletion bounds.
