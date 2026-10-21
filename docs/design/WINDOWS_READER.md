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

Open, drag/drop, document switching, text size, screen themes and a heading outline
are available in the reader. The Edit & PDF action imports the existing App lazily
and transfers documents in memory. Returning to reading flushes pending edits,
clears the pagination host and destroys the workspace. Unsaved work requires an
explicit discard confirmation when closing. Documents never persist automatically.
The old reader source list is released once the workspace safely owns its documents
and dirty baselines. Closed-document baselines are pruned; successful return clears
them. Failed return validation keeps the workspace intact, and a failed teardown
flush restores its original document identities, edits and selection for retry.
Workspace input is paused during return so a late edit or Save shortcut cannot race
that ownership transfer; a failed return restores interaction as well as source.

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

## Verification and distribution

Unit tests cover ingestion limits, late results and host queue draining. Real
Chromium tests cover rendered Markdown, absence of initial pagination/editor/network
requests, switching documents, the lazy workspace round trip and PDF exports under
the production CSP. Windows Actions compiles/tests the locked native host, builds
an unsigned per-user NSIS installer and portable executable, and records a native
launch smoke. Existing web CI and no-slice checks remain required.

No RAM or startup target is claimed from executable size. Native measurements must
include the host plus the complete associated WebView2 process tree, with empty,
ordinary and large documents, before and after entering the PDF workspace.

## Limits

Local/remote linked images remain blocked by the existing sanitizer; embedded raster
images work. There is no watcher, autosave, recents list or shell preview extension.
File associations, both native export dialogs and startup/memory on Chris's Windows
machine require acceptance. Existing AI-6/7/8/9 remain open and separate.
