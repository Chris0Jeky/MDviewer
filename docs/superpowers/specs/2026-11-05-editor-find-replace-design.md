# Source Find and Replace

The owner asked to continue autonomous desktop development toward a simple,
powerful, efficient editor. This slice makes finding and changing source text
available without adding an editor framework or changing PDF rendering.

## Behavior

- A compact Find button in the source header opens an inline, nonmodal panel.
  Ctrl/Cmd+F opens Find; Ctrl/Cmd+H opens Replace. Shortcuts apply only while the
  source pane is available. Preview-only mode keeps the host's normal Find.
- Search is literal, with an explicit Match case toggle. Enter/Shift+Enter and
  previous/next buttons wrap through matches. Escape closes the panel and returns
  focus to the source. A selected single line can seed Find.
- Queries are capped at 2,000 characters with an explicit recoverable message.
  The panel reports the current match and total. At most 10,000 ranges are held;
  an explicit refine-search notice explains a truncated result, and Replace all
  is disabled rather than silently replacing only a prefix of the matches.
- Replace changes the selected result; Replace all changes the complete result
  set as one native undo operation. Replacement text is literal, including `$&`.
- All programmatic edits pass through the editor's byte admission and asynchronous
  identity/selection/focus guards. A late confirmation never edits another document
  or reclaims a control after the user moves. Bulk UTF-8 size is checked before
  constructing multiplied replacements.
- Search state is in memory. Closing cancels scheduled search and releases the
  result ranges. No document storage, network requests or dependency additions.

## Architecture

`EditorSearchModel.ts` owns bounded literal matching, navigation and replacement
construction. `EditorSearch.ts` owns accessible controls and ephemeral search
state. `Editor.ts` owns the textarea, document identity, source notifications,
native undo, size checks and destruction. Search receives a narrow guarded edit
callback; it never mutates the textarea value itself. `setInput` rebinds Search
selection listeners whenever Editor replaces its textarea at a document boundary.

The panel occupies its own auto-sized grid row above the existing source layers.
Both source layers retain identical metrics. It inherits the source pane's print
suppression. Results update after a short idle debounce while open; closed search
does not scan source text. Native selection and a measured source rectangle reveal
the active result without approximate character-to-scroll ratios.

## Scope and verification

Own `src/ui/EditorSearch*.ts`, source-editor integration, `src/app/dom.ts`,
`src/styles/editor.css`, focused unit and production browser tests, and matching
spec/index documentation. New-document admission and offline PDF capture belong
to independent slices.

Verify literal punctuation, Unicode indices, case matching, wrapping, bounded
results, replacements with special characters, empty queries, document switches,
keyboard accessibility, cancellation, destruction and byte admission. Real
Chromium verifies undo/redo, deep-source navigation, responsive geometry, source
layer alignment and print suppression. No local browser is available in this
session: exact-head hosted Chromium and Windows checks are the browser/native
evidence. Human acceptance gates AI-6/7/8/9 and #169 stay open.

At viewport heights up to 600px, open Find temporarily gives the source the Split
workspace and hides its redundant header. The canvas remains measurable and fatal
feedback remains visible. Closing Find restores the previous split geometry;
view mode, split ratio and document layout settings are not changed or persisted.
This also keeps source text usable in the supported 560×420 desktop window.
