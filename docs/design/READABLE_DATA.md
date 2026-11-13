# Readable data, version 1

Status: **specification drafted 2026-11-12 on the owner's request. D0 to D3 (including both halves of
D3), D4 (parsers #281, native #284, webview #288), the D6 readability pass (#293) and D5's pure copy functions
(#289) and the D5 webview (copy menu and Save readable view as Markdown, #299) are done.** Owner direction: MDviewer should "take structured JSON and other similar difficult to read
files" and create "structured more human readable versions".

## The idea

A data file opens as a readable document. MDviewer derives Markdown from the data with a pure,
deterministic function and shows that Markdown in the reader it already has.

- **Everything the reader does for Markdown then works for data**: outline, search, copy, themes,
  live reload when an agent rewrites the file, and the paginated PDF.
- **The file is never changed by viewing it.** Edit shows the raw text, like a notepad.
- **Nothing leaves the machine and nothing is guessed by a model.** The same input always gives the
  same view. An AI-written explanation of a file is out of scope: it would break the local-only
  contract. A generator outside MDviewer can write one as Markdown.

## Terms

| Term | Meaning |
| --- | --- |
| Data document | A file of a supported data format, open in MDviewer |
| Readable view | The Markdown derived from a data document |
| Lens | A recogniser for one known shape of data plus the layout for it |

## Formats

| Phase | Formats | Extensions | New dependency |
| --- | --- | --- | --- |
| 1 | JSON, JSON with comments and trailing commas, JSON Lines | `.json`, `.jsonc`, `.jsonl`, `.ndjson` | None |
| 1 | Plain text | `.txt`, `.log` | None |
| 2 | YAML, TOML, CSV and TSV | `.yaml`, `.yml`, `.toml`, `.csv`, `.tsv` | One parser each for YAML and TOML, loaded only when needed |

The kind comes from the extension. A `.json` file that fails strict parsing is retried as JSON with
comments, and the view says so.

**Plain text** (owner request 2026-11-12: MDviewer should work as a notepad). Its readable view is
the text itself in one unhighlighted block, wrapped like the reader's code blocks. A Markdown fence
leaves its content literal, so nothing in the text becomes structure, and every line break, blank
line and space is kept exactly (escaped paragraphs would collapse leading spaces). No lens and no
parsing; the budget is 20,000 lines, cut like the other budgets. Edit shows the raw text. A `.txt`
file is never read as Markdown, even when it looks like Markdown (an assumption the owner can
reverse).

Not in version 1: notebooks, XML, INI and `.env`, and log parsing (a `.log` file opens as plain
text).

## The three modes

| Mode | Data document shows |
| --- | --- |
| Read | The readable view |
| Edit | The raw source text; the preview pane shows the readable view |
| PDF | The readable view, paginated with the usual guarantees |

No new chrome. The status bar names the format.

## The generic lens

It must make any valid file readable:

The same generic layout applies inside YAML multi-document and conversation views; their framing stays intact.

- **Top.** A title (the file name) and one overview line: format, size and top-level shape, for
  example "object with 12 keys" or "list of 340 records".
- **Object.** One key and value table comes first, then sections for the larger members. Both
  groups keep file order, at every depth. Sections use headings down to level 4, then nested lists.
- **Row-sized values** stay in that table: non-block scalars, empty objects and lists, lists of
  at most eight non-block scalars, and objects of at most four non-block scalar members. Inline
  lists use commas; inline objects use `key: value · key: value`. Either must be under 80 characters.
  String items containing a separator (`, `, ` · ` or `: `) are quoted. Inline values spend their
  full value count; hints apply to scalar rows, not inside inline collections.
- **Lists of records** become tables when their objects have unique keys and scalar or short
  scalar-list values (at most eight items). One nested object level is flattened as `parent.child`;
  an empty nested object stays `{}`. Columns follow first appearance across all records, with
  blanks for missing members. A collision or more than 32 columns falls back to the unflattened
  test, then sections. Columns containing only non-empty numbers are right-aligned; CSV numbers
  must match JSON's number grammar. A cell's string gets a detail section only when it holds embedded JSON, is clearly Markdown, or
  sits under a prose key and is a block on its own account (a line break, or longer than 160
  characters); not where literal strings are forced (generic data inside a conversation). Anything
  else is already whole in its cell.
- **JSON Lines records** use the same table when all valid records qualify, even beyond the shown
  range. A right-aligned `line` column gives source line numbers (`#` if `line` collides; sections
  if both collide). Invalid records in the shown range follow the table, with their original record
  numbers and source. The overview includes the invalid count; record and value budgets still apply.
- **List of other objects** becomes one subsection per item, labelled by the first of `name`,
  `title`, `id`, `key`, `label`, `type` that the item has, else by `key[index]` using the list's key,
  or `[index]` for a root list or a list directly inside another list. Labels use plain text.
- **List of scalars** is an inline list when short, else a bulleted list.
- **Block strings** exceed 160 characters, contain line breaks, clearly contain Markdown, or hold
  embedded JSON. A prose key alone never makes a short string a block. Embedded JSON is expanded
  and labelled first; otherwise a prose key (`description`, `prompt`, `content`, `text`, `message`,
  `body`, `summary`, `instructions`, `system`) or clear Markdown gives a Markdown blockquote unless
  literal text is forced. Other multi-line strings use an unlabelled fence, preserving indentation;
  other long lines use a literal span. Cells keep their full text with line breaks as `<br>`.
- **Typed-looking strings** are double-quoted: JSON numbers, `true`, `false`, `null`, or text with
  leading or trailing whitespace in a string with no line break. Empty strings keep
  `"" (empty string)`. CSV and TSV cells stay plain text, including empty cells.
- **Hints are appended, never substituted.** An epoch or ISO time under a time-like key gains a
  local date in muted text. Time-like keys include camelCase endings such as `createdAt`,
  `startTime` and `lastSeenTs`; numeric epochs must fall between 2000-01-01 and 2100-01-01 UTC.
  Durations and byte sizes gain a human form when the key names the unit.
- **Empty values** (`{}`, `[]`, `""`, `null`) are shown as what they are.

## Fidelity

1. Keys are shown verbatim. Within an object's table and among its sections the order is the file's order; the table comes before the sections.
2. Every scalar is shown exactly as written. Numbers keep their source text, so large integers and
   `1.0` are not altered. This needs MDviewer's own small parser, which also gives line and column
   for errors, tolerates comments, keeps duplicate keys and records where each value sits.
   Columns count UTF-16 code units in every format (an emoji is two).
   A YAML alias reads `alias of &name (anchor at line N)`; an alias with no anchor before it is
   reported as a problem.
3. Nothing is dropped silently. Anything collapsed or cut states how much, and offers the rest.
4. Data cannot create structure. Every value is escaped, so a string holding `|`, a backtick,
   `# heading`, `- [ ]` or HTML shows as that text. Strings rendered as Markdown pass the same
   sanitiser as any document. Actionable controls are off in data documents.

## The conversation lens

Recognised by shape, not by file name: a list or JSON Lines file whose records carry a role and
content (the common chat-message shape), or agent transcript records that wrap such a message.

- One section per turn, labelled by role, with its time when present.
- A turn carrying only tool results is headed as a tool result, with its actual role in parentheses.
- Message text is rendered as Markdown.
- Tool calls, tool results and thinking are collapsed, each with its name and a one-line summary.
- An OpenAI-style assistant turn with `tool_calls` and no content is a turn; its calls are counted
  by function name.
- The overview counts turns and tool calls by name, and gives the time span (earliest to latest
  readable time, whatever the file order) and token totals when the file has them. Plain decimals
  add exactly; other spellings (an exponent) are shown as "about".
- A record the lens does not understand is shown with the generic lens, collapsed. It is never
  skipped.

## Errors and size

- **Invalid file.** Read shows what is wrong with line and column, then the raw text. Edit works.
  In JSON Lines, good lines render and bad lines are listed.
- **Large file.** The 25 MB file limit stays (native read, `MAX_FILE_BYTES`; web input,
  `SIZE_HARD_BYTES`). The readable view is built to a budget
  (initially 20,000 values, or 500 records of a JSON Lines file), then offers the next part and
  "Show all". The overview always describes the whole file. Budgets are set by measurement.
  Memory is bounded before the budget applies: a YAML stream composes at most 10,000 documents
  (the rest are counted, not read or checked), and CSV and TSV keep cells only for the rows the
  values budget can hold, while still counting every row and column.
- **Large view.** The large-document confirmation (`SIZE_SOFT_BYTES`, about 250 KB, "Pagination
  may briefly freeze the page") today measures the file's bytes at open. For a data document it
  also counts the readable view, which can be larger than the file (listed under Boundaries).

## Boundaries that change

| Boundary | Change |
| --- | --- |
| Native open (`file_policy.rs`) | Accepts the listed extensions; same local-path, size and encoding rules |
| Relative links (`open_relative`) | Stay Markdown-only, enforced in `open_relative` (not left to the open policy): a link would open and bind its target with no dialog, so it never opens a data or text file |
| Save and Save As | Write the raw text through the same conflict-safe replace; the destination keeps a data extension |
| Web build | File picker and drop accept the listed extensions |
| Large-document confirmation | For a data document, also counts the readable view's size at open |
| File associations | None registered; MDviewer does not become the default app for data files |
| Network, telemetry | No change |

File paths inside data are shown as text, not links. Web links follow the existing link rule.

## Copy

Copying a block gives its Markdown from day one, so a table pastes straight into an issue.

Slice D5 adds, for JSON, JSON Lines, YAML, TOML and CSV (not plain text), four reader commands in the
More menu and the palette: Copy value, Copy path (JSONPath), Copy path (jq) and Copy subtree as JSON.
The target is the value the reader's last selection sits on: the stamped `data-src` line of its block (a
table row is one line, and a cell takes its row's line) maps through `Readable.map` to a path, and
`src/data/copy.ts` does the rest. A flattened table cell therefore names its row; a table header
names the table; with no selection the target is the whole document. A path the parsed file does not
hold (JSON expanded inside a string) copies nothing and says so. For JSON Lines the jq form indexes
the slurped array, and the notice says `jq -s`. "Copy reference" for a data document appends the value
path (`file.json#$.owners[1]`) instead of readable-view line numbers. "Save readable view as Markdown…"
(any data kind) saves exactly the render text as `name.readable.md` through the Save a copy path; the open
document, its binding and its dirty baseline do not change. Code: `src/desktop/reader/dataCopy.ts`.

## The seam

One module, `src/data/`, with no DOM and no dependencies in phase 1:

```ts
export type DataKind = "json" | "jsonl" | "yaml" | "toml" | "csv" | "text";
export function dataKindOf(fileName: string): DataKind | null;
export function prepare(kind: DataKind): Promise<void>;
export function toReadable(text: string, kind: DataKind, options?: ReadableOptions): Readable;
export interface Readable {
  markdown: string;      // the readable view
  problems: Problem[];   // parse errors with line and column
  truncated: boolean;    // a budget cut the view short
  map: ReadonlyMap<number, string>; // line of the readable view -> path of the value it shows
}
```

Call `await prepare(kind)` before conversion: YAML is loaded dynamically and cached; other kinds resolve immediately.
The reader and the workspace each call it at the one point where document text becomes render
text. The document keeps its raw text; only the render text is derived.

## Conformance

`tests/fixtures/data/` holds invented files. Each `name.json` (or other format) has a
`name.readable.md` with the exact readable view. One property test covers rule 4 of Fidelity: for
generated strings, the rendered text equals the input and no element appears that the layout did
not make. No real file ever becomes a fixture.

## Slices

| Slice | Content | Needs |
| --- | --- | --- |
| D0 | This specification | — |
| D1 | `src/data/`: parser for JSON, JSON with comments and JSON Lines; the generic lens; plain text; budgets; fixtures | — |
| D2 | The conversation lens | D1 |
| D3 | Opening and showing data documents: native and web open, Read, Edit and PDF, errors, live reload, Save | D1; the shell (S3) on main |
| D4 | YAML, TOML, CSV and TSV | D1, D3 |
| D5 | Copy value, path and subtree; agent data files in the Library; save the readable view as Markdown (done: #289, #290, #299) | D3 |
| D6 | Readability pass: one table per object, row-sized values inline, record tables with shallow nesting and for JSON Lines, typed strings quoted, literal blocks | D1 to D4 |
| D7 | More text-shaped kinds ([complete push](2026-11-13-complete-push.md), Track D). **HTML (`.html`, `.htm`):** the body is shown as HTML through the reader's own pipeline, so the one sanitizer decides what survives (no scripts, styles, frames, forms, autoloading or remote resources; relative images load as for Markdown; authored inputs stay inert). The view is a title, an overview line naming the title, links and images, a line naming what was not run or loaded, and the body as one HTML block (blank lines become empty comments so the block cannot end early, also inside `<pre>`). Edit shows the source, which Save writes unchanged; no copy menu (no values). | D3 |

## Later, not in version 1

Changing a value from the readable view with a byte-exact write-back. More lenses (package
manifests, API and schema descriptions, notebooks, test and scan reports). Sorting and filtering
tables. Marking what changed after a reload.
