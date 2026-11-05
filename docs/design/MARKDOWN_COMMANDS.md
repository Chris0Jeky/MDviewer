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
| Bold / Italic | Insert `**text**` / `*text*`; select `text`. | Wrap each nonblank selected line, leaving surrounding whitespace and blank lines intact. For a single line, keep its content selected without the surrounding whitespace. Multiline results select the complete replacement. | Selecting the content inside matching adjacent `*` or `_` markers, or selecting complete markup, removes this command's markers. Nested bold and italic toggle independently. In multiline selections, remove markers when every nonblank selected segment has them; otherwise add only missing markers. |
| Inline code | Insert a code span; select `code`. | A single line uses a backtick delimiter longer than any internal run, with CommonMark padding when required. Keep the original content selected. Multiline selections are refused with guidance to use Code block. | Remove matching adjacent delimiters (including generated padding), or unwrap a completely selected code span. |
| Code block | Fence the current line; on an empty line, leave the caret between the fences. | Expand to complete affected lines and fence them. Use at least three backticks and a longer run than any existing backticks in the body. Select the body. | Remove a complete selected fenced block, or the matching fence lines immediately surrounding the selected body. Backtick/tilde fences and an opening language tag are recognized. |
| H1 / H2 / H3 | Add or toggle a prefix on the current line; preserve the caret's content offset. | Expand to complete affected lines, preserve indentation and blank lines, and select the result. | Remove the requested level when every nonblank affected line uses it; otherwise replace existing ATX opening prefixes with that level. Trailing text, including optional closing hashes, is retained. |
| Link | Insert `[text](url)`; select `text`. | Wrap a single-line label and select `url` for replacement. Multiline selections are refused. | A complete simple `[label](destination)` selection, or its selected label, unwraps to the label. Nested labels, escaped closing delimiters, and parenthesized destinations are outside this deliberately small toggle recognizer. Images are not unwrapped by a label selection. |
| Bullets / Numbers / Tasks | Add or toggle the current line's prefix; retain the caret's content offset. | Expand to complete affected lines; preserve indentation and blank lines; select the result. Numbered lists count nonblank affected lines from 1. | If all nonblank affected lines have the requested kind, remove their prefixes. Otherwise replace existing bullet, ordered, or task prefixes. Converting mixed lines to Tasks preserves checked items and creates unchecked items for the rest. |

A selection ending exactly at the start of another line does not include that
next line in a line command. An empty line is a valid insertion target. Emphasis,
heading, and list commands leave whitespace-only multiline selections unchanged. Line commands transform the
selected source without trying to infer surrounding Markdown nesting or fenced
code context; the user chooses the source to format.

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
expected value/revision, source focus, and untouched native insertion caret. A
re-entrant document switch, edit, or selection change cannot receive an old
command's selection. The first typed-document adoption is the sole ownership
transition allowed to keep that native editing host.

Accepted commands use one native undo entry in supported browser engines. The
existing manual fallback remains for engines without textarea `insertText`; that
fallback cannot supply native history. No second input event, value assignment,
or separate selection edit is used on the native path. A real document switch
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
   re-entrancy, placeholder selections, and exactly one observable input.
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
