# Markdown writing commands (#198)

## Design and boundaries

The source pane offers a collapsed **Format** disclosure beside Find. Opening it
reveals a labelled group of ordinary keyboard-focusable buttons. Bold, Italic,
Code, Code block, H1–H3, Link, Bullets, Numbers, and Tasks cover common writing
operations without a permanent extra toolbar. Escape closes the group and returns
focus to the source. Ctrl/Command+B, I, and K work only in the source textarea;
they retain their browser/application meanings elsewhere.

The native textarea remains the editing host. There is no added editor framework,
document parser, storage, telemetry, or reader dependency. The source text is the
only input to a command. The formatting panel is screen chrome, outside the
rendered document and paged styles. Opening it does not repaginate or change the
preview. Its bounded, wrapping row scrolls when the pane or window is small.
In a short Split window, an open Find or Format panel temporarily gives source
the available workspace; closing both restores the chosen split. The preview
stays measurable while parked, following the existing Find behavior.

## Command behavior

Offsets and selections use the textarea's UTF-16 coordinates. A command refuses
invalid ranges or a boundary inside a surrogate pair; it never slices an emoji
surrogate pair. Existing text, whitespace, indentation, and blank lines remain
unchanged except for the requested Markdown markers. Backward selections remain
backward unless the command explicitly selects a new placeholder.

| Command | Empty selection | Selected text | Existing formatting |
| --- | --- | --- | --- |
| Bold / Italic | Insert `**text**` / `*text*`; select `text`. | Wrap each nonblank selected line, leaving surrounding whitespace and blank lines intact. For a single line, keep its content selected without the surrounding whitespace. Multiline results select the complete replacement. | A single recognized `*` or `_` span can be removed from either a complete or content selection. Nested bold and italic toggle independently. Escaped, unmatched, intraword underscore, and multiple-span boundaries are refused unchanged. In multiline selections, remove markers when every nonblank segment is one recognized span; otherwise add only missing markers. An ambiguous segment refuses the whole command. |
| Inline code | Insert a code span; select `code`. | A single line uses a backtick delimiter longer than any internal run, with CommonMark padding when required. Keep the original content selected. Multiline selections are refused with guidance to use Code block. | Remove delimiters only when they enclose one complete span with no earlier matching closing run. A complete selection containing multiple code spans is safely wrapped with a longer delimiter, preserving the selected source. A selection across the bodies of separate spans, escaped openers, or partial delimiters is refused. Generated padding is removed only when it matches the span's actual padding; literal all-space content is retained. |
| Code block | Fence the current line; on an empty line, leave the caret between the fences. | Expand to complete affected lines and fence them. Use at least three backticks and a longer run than any existing backticks in the body. Select the body. | Remove a complete selected fenced block, or the matching fence lines immediately surrounding the selected body. Backtick/tilde fences and an opening language tag are recognized. |
| H1 / H2 / H3 | Add or toggle a prefix on the current line; preserve the caret's content offset. | Expand to complete affected lines, preserve indentation and blank lines, and select the result. | Remove the requested level when every nonblank affected line uses it; otherwise replace existing ATX opening prefixes with that level. Trailing text, including optional closing hashes, is retained. |
| Link | Insert `[text](url)`; select `text`. | Wrap a plain single-line label and select `url` for replacement. Multiline selections are refused. | A complete `[label](destination)` selection, or its selected label, unwraps to the label. Destination parentheses are balanced and escaped delimiters are respected before any text is removed. Nested labels, optional titles, angle-delimited destinations, images, escaped openers, incomplete links, and selections across multiple links are refused unchanged. |
| Bullets / Numbers / Tasks | Add or toggle the current line's prefix; retain the caret's content offset. | Expand to complete affected lines; preserve indentation and blank lines; select the result. Numbered lists count nonblank affected lines from 1. | If all nonblank affected lines have the requested kind, remove their prefixes. Otherwise replace existing bullet, ordered, or task prefixes. Converting mixed lines to Tasks preserves checked items and creates unchecked items for the rest. |

A selection ending exactly at the start of another line does not include that
next line in a line command. An empty line is a valid insertion target. Emphasis,
heading, and list commands leave whitespace-only multiline selections unchanged. Line commands transform the
selected source without trying to infer surrounding Markdown nesting or fenced
code context; the user chooses the source to format.

Inline toggles use conservative source recognizers, not a complete Markdown
parser. Ambiguous selections produce no edit and no Undo entry. The refusal
opens the Format disclosure with an accurate explanation while retaining source
focus and selection; multiline code/link guidance is reserved for multiline
selections.

## Transaction and ownership contract

`MarkdownCommands.ts` is a pure transformation from source, selection, and command
to one replacement range plus the desired final selection. `EditorFormatting.ts`
owns disclosure, shortcut handling, a polite refusal status, and cancellation of
pending UI work. It calls `Editor.replaceRange`; it never assigns textarea values.

`replaceRange` retains its existing document identity, edit revision, exact value,
selection revision/direction, focus, composition, abort, attachment, readonly,
disabled, inert, and UTF-8 admission checks. Its optional final selection is
validated before admission and applied synchronously after the one native
`insertText` transaction. The final selection also requires the same textarea,
expected value/revision, source focus, and untouched native insertion caret. The
revision check counts the input events belonging to the native command, because
a multiline insertion may produce more than one event. Re-entrant host callbacks
and nested commands invalidate that count's ownership. A
re-entrant document switch, edit, or selection change cannot receive an old
command's selection. The first typed-document adoption is the sole ownership
transition allowed to keep that native editing host.

Accepted commands use one native undo entry in supported browser engines. The
existing manual fallback remains for engines without textarea `insertText`; that
fallback cannot supply native history. No synthetic input event or value assignment
is added on the native path; each browser's actual native input events retain their
existing notification behavior. A real document switch
continues to replace the textarea, separating its native undo history even for
equal names and equal contents. Formatting rebinds to the new input and aborts
its old operation. Closing the disclosure also cancels a pending command.

## Implementation plan and validation

1. Add and unit-test the pure transformations, including templates, toggles,
   mixed multiline selections, backtick collision avoidance, Unicode, direction,
   line boundaries, and refused ranges.
2. Add the compact disclosure and source-only shortcuts; integrate it with the
   existing replacement seam and document-switch/destroy lifecycle.
3. Verify admission, IME, passive/switch ownership, stale confirmations, observer
   re-entrancy, placeholder selections, refusal atomicity, and single/multiple
   native input-event sequences without an extra synthetic notification.
4. Exercise the production bundle in real browsers: every command's native Undo,
   consecutive Undo entries, first-command adoption, multiline toggle Undo,
   document switches, keyboard focus, narrow/short geometry, authored headings
   whose IDs match panel names, unchanged preview when opening controls, and print exclusion. The existing reader/layout and
   editor ownership suites remain regression gates.

Local execution uses the installed locked Firefox engine with
`MOZ_DISABLE_CONTENT_SANDBOX=1`, required by this container's user namespace
restriction. Exact locked Chromium coverage is delegated to repository CI; a
local environment restriction is not evidence that Chromium passed.

### Local verification

Feature code commit `019cff9a735fcdb3851c105cfe2ca58c551a2052` passes typecheck,
lint, all **908 unit tests**, the clean production build including source/license
notices, and **25 production Firefox tests without retries**. The browser run
includes the 17 formatting cases plus existing native-edit ownership and Find
regressions. The authored-heading test first failed against the unscoped styles
because the preview became hidden with both panels closed; it passes after the
styles and parking selectors are scoped to the actual editor children.

Chromium, native Windows, and the integrated final branch remain CI gates owned
by the parent integration task. These local results do not claim those gates.
