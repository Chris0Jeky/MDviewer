# Readable data, version 1

Status: **specification drafted 2026-11-12 on the owner's request; nothing here is implemented
yet.** Owner direction: MDviewer should "take structured JSON and other similar difficult to read
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
| 2 | YAML, TOML, CSV and TSV | `.yaml`, `.yml`, `.toml`, `.csv`, `.tsv` | One parser each for YAML and TOML, loaded only when needed |
| 1 | Plain text | `.txt`, `.log` | None |

The kind comes from the extension. A `.json` file that fails strict parsing is retried as JSON with
comments, and the view says so.

**Plain text** (owner request 2026-11-12: MDviewer should work as a notepad). Its readable view is
the text itself, wrapped, with no Markdown interpretation: every line is escaped like any other data
value, so nothing in it becomes structure. No lens and no parsing. Edit shows the raw text. A `.txt`
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

It must make any valid file readable. Rules, in source order throughout:

- **Top.** A title (the file name) and one overview line: format, size and top-level shape, for
  example "object with 12 keys" or "list of 340 records".
- **Object.** Scalar members form a two-column key and value table. Each member that holds an
  object or a list becomes a section headed by its key. Sections nest as headings down to level 4,
  then as nested lists.
- **List of flat records** (objects that share keys and hold only scalars or short lists of
  scalars) becomes a table, one column per key.
- **List of other objects** becomes one subsection per item, labelled by the first of `name`,
  `title`, `id`, `key`, `label`, `type` that the item has, else by its index.
- **List of scalars** is an inline list when short, else a bulleted list.
- **Long or multi-line strings** are set as a block with their real line breaks. A string is
  rendered as Markdown when its key is a prose key (`description`, `prompt`, `content`, `text`,
  `message`, `body`, `summary`, `instructions`, `system`) or it clearly contains Markdown; code-like
  strings become a fenced block. A string that itself holds JSON is expanded and labelled as such.
- **Hints are appended, never substituted.** An epoch or ISO time under a time-like key gains a
  local date in muted text. Durations and byte sizes gain a human form when the key names the unit.
- **Empty values** (`{}`, `[]`, `""`, `null`) are shown as what they are.

## Fidelity

1. Keys are shown verbatim and order is the file's order.
2. Every scalar is shown exactly as written. Numbers keep their source text, so large integers and
   `1.0` are not altered. This needs MDviewer's own small parser, which also gives line and column
   for errors, tolerates comments, keeps duplicate keys and records where each value sits.
3. Nothing is dropped silently. Anything collapsed or cut states how much, and offers the rest.
4. Data cannot create structure. Every value is escaped, so a string holding `|`, a backtick,
   `# heading`, `- [ ]` or HTML shows as that text. Strings rendered as Markdown pass the same
   sanitiser as any document. Actionable controls are off in data documents.

## The conversation lens

Recognised by shape, not by file name: a list or JSON Lines file whose records carry a role and
content (the common chat-message shape), or agent transcript records that wrap such a message.

- One section per turn, labelled by role, with its time when present.
- Message text is rendered as Markdown.
- Tool calls, tool results and thinking are collapsed, each with its name and a one-line summary.
- The overview counts turns and tool calls by name, and gives the time span and token totals when
  the file has them.
- A record the lens does not understand is shown with the generic lens, collapsed. It is never
  skipped.

## Errors and size

- **Invalid file.** Read shows what is wrong with line and column, then the raw text. Edit works.
  In JSON Lines, good lines render and bad lines are listed.
- **Large file.** The 25 MB file limit stays (native read, `MAX_FILE_BYTES`; web input,
  `SIZE_HARD_BYTES`). The readable view is built to a budget
  (initially 20,000 values, or 500 records of a JSON Lines file), then offers the next part and
  "Show all". The overview always describes the whole file. Budgets are set by measurement.
- **PDF.** The existing large-document confirmation (`SIZE_SOFT_BYTES`, about 250 KB, "Pagination
  may briefly freeze the page") counts the readable view, which can be larger than the file.

## Boundaries that change

| Boundary | Change |
| --- | --- |
| Native open (`file_policy.rs`) | Accepts the listed extensions; same local-path, size and encoding rules |
| Save and Save As | Write the raw text through the same conflict-safe replace; the destination keeps a data extension |
| Web build | File picker and drop accept the listed extensions |
| File associations | None registered; MDviewer does not become the default app for data files |
| Network, telemetry | No change |

File paths inside data are shown as text, not links. Web links follow the existing link rule.

## Copy

Copying a block gives its Markdown from day one, so a table pastes straight into an issue. Later
(slice D5): copy a value, copy its path in JSONPath and `jq` form, copy a subtree as JSON.

## The seam

One module, `src/data/`, with no DOM and no dependencies in phase 1:

```ts
export type DataKind = "json" | "jsonl" | "yaml" | "toml" | "csv" | "text";
export function dataKindOf(fileName: string): DataKind | null;
export function toReadable(text: string, kind: DataKind, options?: ReadableOptions): Readable;
export interface Readable {
  markdown: string;      // the readable view
  problems: Problem[];   // parse errors with line and column
  truncated: boolean;    // a budget cut the view short
  map: ReadonlyMap<number, string>; // line of the readable view -> path of the value it shows
}
```

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
| D5 | Copy value, path and subtree; agent data files in the Library; save the readable view as Markdown | D3 |

## Later, not in version 1

Changing a value from the readable view with a byte-exact write-back. More lenses (package
manifests, API and schema descriptions, notebooks, test and scan reports). Sorting and filtering
tables. Marking what changed after a reload.
