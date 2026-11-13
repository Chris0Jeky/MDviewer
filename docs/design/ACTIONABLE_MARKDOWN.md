# Actionable Markdown, version 1

Status: **specification drafted 2026-11-11. A1 to A4 are merged; A5 (the embeddable
element, #300) is implemented and in review.** Added to the
companion push by the owner on 11 November 2026 (asked "Add actionable Markdown (clickable
checkboxes, marks, fields, chips) to this push?", answered "Yes, add it"). MDviewer owns this
contract. It answers the Lumenfold coordinator's v0 proposal (owner request, 11 November 2026) and
supersedes it. Tools that generate documents build to this file and to the fixtures it names.

## The idea

A document is the control surface. The reader marks things in it; a separate program reads the
marks and acts.

- **MDviewer never runs anything.** It renders, lets the reader change a few characters, and saves.
- **Generators need no interface of their own.** They write Markdown files, watch them for marks,
  do the work and write the result back. MDviewer reloads the file when it changes.
- **Every convention is readable plain text** in any other Markdown viewer, in a diff and to an
  agent.

## Parties and compatibility

| Party | Reads | Writes |
| --- | --- | --- |
| MDviewer | The whole file | One control's span at a time, on a user gesture |
| A generator | The control spans | The whole file, atomically |

A document may declare `actionable: 1` in its front matter. It is optional. MDviewer warns when it
sees a higher number than it supports and still renders what it understands. An MDviewer without
this feature shows every control as literal text, so old and new versions can share files.
One behaviour changes for ordinary documents: a task-list checkbox in the reading view becomes
clickable and, for a saved file, the click is written to disk.

## Controls

Each control lives on one source line and has one editable span. A line counts only where the
CommonMark parse puts it: never inside a fenced or indented code block, a code span or an HTML
block. `LIST` below means a list marker (`-`, `*`, `+`, or digits followed by `.` or `)`) with its
indentation, optionally inside blockquote prefixes.

### 1. Marks

`LIST [c] text`, where `c` is exactly one of:

| `c` | Meaning | Rendered as |
| --- | --- | --- |
| space | To do | Empty box |
| `x` or `X` | Done | Checked box |
| `/` | In progress | Half-filled box |
| `-` | Dropped | Struck-through item |
| `!` | Blocked | Box with a warning mark |
| `?` | Question | Box with a question mark |

The editable span is the one character between the brackets. MDviewer writes `x` in lower case.
A click moves to the next mark in the document's cycle. The default cycle is `[" ", "x"]`, so
ordinary task lists behave as they do everywhere. A document sets its own cycle in front matter,
for example `marks: [" ", "/", "x"]`; every entry must be one of the six marks and the list must
contain the space. A menu (right click, or the context-menu key) offers all six. A click on a mark
that is not in the cycle opens the menu.

### 2. Choices

`LIST ( ) text` and `LIST (x) text`. All choice items in one list form a single-choice group.
Selecting one writes `x` into it and a space into every other item of the group, as one atomic
change. Selecting the chosen item again clears it. The editable span is the character between the
parentheses.

### 3. Fields

A paragraph line or list item of the form `key:: value`. The key matches
`[A-Za-z][A-Za-z0-9_-]{0,39}`. The value is the rest of the line, may be empty, and cannot contain
a line break. It renders as a label and a value; activating it shows a one-line input, Enter
commits and Escape cancels. The editable span is the value. Writing a value into an empty field
puts one space after `::`. A line that is a mark or a choice is not also a field.

### 4. Status chips

A front matter scalar `key: value` that has a sibling `key.options: [a, b, c]` renders as a chip
above the document. A click moves to the next option and wraps; a menu picks any. The options are a
one-line flow list of plain or quoted scalars. The editable span is the scalar on the `key:` line;
its quoting style and any trailing comment are kept. A value that is not among the options shows
as it is, tinted, and a click sets the first option. Keys without `.options` stay in the
Properties card and are not interactive.

### 5. Copy

Every fenced block has a Copy button. It copies the block's content as CommonMark defines it (the
lines between the fences, container indentation and quote prefixes removed, joined with line
feeds, no final line feed). The word `copy` after the language in the info string, or an info
string that is exactly `copy`, marks the block as the primary one and gives it a larger button.

### 6. Stable ids

A mark, choice or field may end with `<!-- id: name -->`, where the name matches
`[A-Za-z0-9][A-Za-z0-9._-]{0,63}` and is unique in the document. The comment is invisible when
rendered. For a chip, the key is its id. Duplicate ids are ignored for placement and reported on
the Properties card.

### 7. Templates

A `templates/` folder inside a pinned folder offers "New from template". `{{name}}` placeholders
(`[A-Za-z][A-Za-z0-9_-]*`) become a short form that asks for each distinct name once. `{{date}}`,
`{{time}}` and `{{title}}` are filled in without asking. The result is saved through Save As.

## Write-back

- A change is a list of line patches, `{ line, id?, expect, replace }`: the 1-based line the
  reader saw the control on (as the parser numbers lines), the full old text of the line and its
  full new text. A change with several patches (a choice group) is applied as one.
- **Byte exact.** Only the editable span changes. Every other byte stays: the byte order mark, each
  line terminator (mixed endings included) and whether the file ends with one.
- **Atomic.** MDviewer writes through its conflict-safe replace and never truncates in place.
- **When it saves.** If the document is bound to a file and has no unsaved edits, the change is
  saved at once and a short notice offers Undo. Otherwise it is applied in memory and saved with
  the document. In the web build it is always in memory.
- **Overwritten after saving.** If the file changes outside while the Undo notice is showing and
  the span is back at its old value, the notice says another program overwrote the change and
  offers to apply it again.
- **Placement after an outside change.** MDviewer re-reads the file and places each patch on the
  first of these that exists: the remembered line, if it still equals `expect`; the one line
  carrying the same id and the same kind of control; the one line equal to `expect`.
- **A line found by id that no longer equals `expect`.** A generator changed the item's text.
  MDviewer changes only the editable span on the line as it now stands, and only if that span
  still holds the value the reader saw. If the span itself changed, the patch cannot be placed.
  The `replace` text is never written over a line that differs from `expect`.
- If any patch of a change cannot be placed, nothing is written and the reader is told which item
  could not be saved.
- **Gesture only.** A write needs a trusted click or key press on a control MDviewer built from the
  source text. Authored HTML inputs are inert. A value containing a line break is refused.
- MDviewer's own save does not count as an outside change, and Undo applies the inverse patch.

## What a generator must do

1. Replace the file atomically: write a temporary file in the same folder, then rename over it.
2. Read the file immediately before writing and carry every editable span forward. Match by id.
   Never reset a mark you did not mean to change.
3. Give every control you will read back an id. Keep ids stable across rewrites and never reuse
   one for a different item.
4. Never depend on line numbers.
5. Rewrite a file at most once a second; coalesce your changes.
6. Prefer UTF-8 without a byte order mark, line feeds and a final line feed.
7. Just before the rename, read the file again. If an editable span differs from what you read in
   step 2, carry it forward into your output and repeat this step.

Steps 2 and 7 narrow the window in which a generator can overwrite a mark the reader has just
made. They do not close it: a mark saved between a generator's last read and its rename is lost.
MDviewer shows the reader when that happens (see "Overwritten after saving"). Version 1 has no
lock protocol.

## Elsewhere

The paginated preview and the PDF render marks and choices as static glyphs and fields as text;
chips are omitted with the front matter. Nothing in a document can run a command, reach the
network, query other files or compute a table. Multi-line fields, nested front matter directives
and reordering by drag are not part of version 1.

## The same view inside another tool

The reading view ships as an embeddable element, `<mdviewer-reader>`, that takes Markdown text and
emits a change event carrying the same line patches. The host page applies them and saves. One
renderer, two hosts: the element runs `renderReaderDocument` and `decorateControls` from the app.

```html
<script type="module" src="/mdviewer-reader.js"></script>
<mdviewer-reader id="doc"></mdviewer-reader>
<script>
  const doc = document.getElementById("doc");
  doc.markdown = text;                         // also the `markdown` attribute
  doc.addEventListener("change", event => {
    const lines = text.split("\n");
    for (const patch of event.detail.patches) { // { line (1-based), id?, expect, replace }
      if (lines[patch.line - 1] !== patch.expect) return; // stale: render again
      lines[patch.line - 1] = patch.replace;
    }
    save(text = lines.join("\n"));
    doc.markdown = text;                       // the element re-renders from the host's text
  });
</script>
```

- **The event.** `change` (a `CustomEvent`, bubbling and composed) with `detail: { patches: LinePatch[] }`,
  the same patches `planChange` gives the app, against the text last given to the element. A gesture
  that changes nothing gives no event. The element never writes anywhere and never edits its own
  text; until the host sets `markdown` again the view is unchanged.
- **Trusted gestures only.** As in the app (`event.isTrusted`), a script that clicks the element
  writes nothing and opens no menu.
- **Per element.** Each element has its own handler, its own menus (inside its shadow root) and its
  own keyboard groups. Two elements on a page do not reach each other.
- **Look.** The reader's stylesheets are inlined into the shadow root. Set `data-app-theme="dark"` or
  `"sepia"` on the element for another palette. The math fonts are the one thing a shadow root cannot
  hold: the bundle adds a `<link>` to its own `mdviewer-reader.css` (next to it) to the page head.
- **What it leaves out.** The Copy buttons (they speak through the page body), the outline and every
  desktop shell feature. A render failure shows an alert in the element.
- **No network, no persistence.** The element makes no request of its own beyond loading its bundle's
  chunks (code grammars, diagrams, math fonts) from the bundle's own origin, and stores nothing.
- **Build.** `npm run embed:build` writes `dist-embed/` (gitignored): `mdviewer-reader.js`, the chunks
  it loads on demand, the stylesheet and the fonts. Serve the folder as is; `npm run embed:test` is the
  Playwright e2e (a real click on a plain page, one event with the exact patches, the host applies
  them, two elements apart), and CI runs it.

## Conformance

`tests/fixtures/actionable/` holds invented documents. Each `name.md` has a `name.items.json`
listing the controls MDviewer must find (`kind`, `id`, `state` or `value`, `key`, `group`) and a
`name.patches.json` listing changes with the exact bytes the file must contain afterwards. A
generator can copy these as its own golden tests. No real document ever becomes a fixture.

## Slices

| Slice | Content | Needs |
| --- | --- | --- |
| A1 | Pure parser, static rendering of all controls in the reader, the fixtures | Source map (S2a), front matter (S2b) |
| A2 | Native line-patch command on the conflict-safe replace, with byte-exact and placement tests | Registry (S0a), replace primitive (S1a) |
| A3 | Interaction: click, keyboard, menus, Undo notice, placement messages; in-memory path for the web build | A1, A2, live reload (S1c) |
| A4 | Templates | Library folders (S4), Save As (S1b) |
| A5 | Embeddable element and its change event (#300) | A3 |

## Changes from v0

1. A click toggles to do and done by default. The three-step cycle applies only when the document
   declares `marks:`. v0 made three steps the default, which would surprise in ordinary task lists.
2. The marks are a closed set of six. v0 allowed any character, which would turn `- [1] note` into
   a control.
3. Chips use a flat `key.options: [...]` beside the key. v0 used a nested `cycle: {key: [...]}`
   map, which the line-based front matter reader cannot edit byte-exactly.
4. The field key, the id name and the placement order are pinned, and a choice group is one atomic
   change.
5. Saving is immediate only for a bound document without unsaved edits.
6. The generator's obligations and the optional `actionable: 1` key are new.
7. `copy` is a word after the language, because an info string's first word is the language.
