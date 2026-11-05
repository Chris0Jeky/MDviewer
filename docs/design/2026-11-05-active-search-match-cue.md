# Active source match visibility — issue 189

Find keeps focus in its query field so repeated Enter/Shift+Enter navigation stays
fast. Chromium does not reliably paint an inactive textarea selection, so the
native selection alone did not visibly locate the active result.

## Bounded approach

`EditorMatchCue.ts` paints one active match as empty rectangles in an aria-hidden,
non-interactive layer inside the source scroll frame. The textarea retains sole
ownership of text, selection, focus, IME and native undo. Search still commits
replacement through the existing guarded `Editor.replaceRange` seam. No source
text is duplicated in the cue, persisted, sent over the network or added to the
accessibility tree. The existing live match count remains its accessible status.

For a highlighted source, a DOM Range covers the full active match across the
existing syntax text nodes. Its client rectangles are merged where nested spans
repeat a row. For the existing large plain-text mode, a temporary hidden text-only
mirror copies the textarea's exact font, padding and wrapping metrics and ends at
the final matched logical line. It uses the textarea client width so the native
scrollbar gutter is excluded exactly once. The mirror is removed immediately
after measurement. A zero-width newline gets a two-pixel cue.

The measured rectangles are retained in source content coordinates. Match reveal
uses the first row of this same measurement. Scroll only translates and clips
cached rectangles; it does not walk syntax DOM or create another source mirror.
An active ResizeObserver, window resize and completed font loading can schedule
one geometry refresh per animation frame. Identical active ranges reuse their
cache. The query's existing 90 ms debounce remains the only incremental-search
cadence; this does not add a source-input geometry scan.

Query/source changes clear the old cue before deferred counting. Closing Find,
losing the exact matched selection, replacing the document textarea, detaching
the input or destroying the editor removes the painted cue. Clearing also cancels
queued painting, disconnects layout observation and removes font/resize listeners.
Closed Search performs no geometry reads. The cue remains inside the existing
source pane, which the print stylesheet already excludes from print and PDF.

## Verification

The regression in `tests/editor-search.test.ts` failed against the previous source
because no cue existed. It checks query focus, unchanged source, no edit callback
and immediate removal after a changed query. `tests/editor-match-cue.test.ts`
checks cross-token and multiline ranges, duplicate rectangle merging, cached
scroll clipping, delayed backdrop scrolling, coalesced resize, inactive cleanup,
fresh-input rebinding, destruction and temporary plain-source mirror removal.
These tests use explicit geometry fixtures; they do not claim browser rendering.

`tests/e2e/editor-search-cue.spec.ts` supplies actual Chromium proof: full active
range coverage against independently measured syntax text, wrapped matching,
scroll and resize, query focus, visible fill/outline, print exclusion, plain-source
native caret visibility, exact source contents, document switches and close.
It writes `find-active-wrapped-cue.png`, `find-active-resized-cue.png` and
`find-active-large-plain-cue.png` for visual inspection. Existing source native
undo/redo regressions remain unchanged. The desktop Search tests additionally
require a visible cue while Find keeps focus, including both short-window sizes.

Actual browser results and screenshot review must be recorded against the
published candidate before this change is qualified. No rendering claim follows
from jsdom tests alone.
