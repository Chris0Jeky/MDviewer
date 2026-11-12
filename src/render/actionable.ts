/**
 * Actionable Markdown v1 (docs/design/ACTIONABLE_MARKDOWN.md): find the controls in a document
 * and plan byte-exact line patches for them. Pure: no DOM, no app state, so the reader, the
 * paginated pipeline and the later embeddable element share it.
 *
 * Lines are 1-based. A control's `span` is the [start, end) range of its editable text inside
 * its line, in UTF-16 code units, excluding the line terminator (and the byte order mark on
 * line 1). Only lines the CommonMark parse puts in a paragraph count, so code blocks, code spans
 * and HTML blocks never hold controls.
 */
import MarkdownItCtor from "markdown-it";
import container from "markdown-it-container";
import footnote from "markdown-it-footnote";
import { readFrontMatter, type FrontMatterEntry } from "./frontmatter";

export const MARKS = [" ", "x", "/", "-", "!", "?"] as const;
export type Mark = (typeof MARKS)[number];
export const MARK_LABELS: Record<Mark, string> = {
  " ": "To do", x: "Done", "/": "In progress", "-": "Dropped", "!": "Blocked", "?": "Question",
};
export const SUPPORTED_VERSION = 1;

interface Base {
  line: number;
  span: [number, number];
  /** Stable id from a trailing `<!-- id: name -->`; absent when missing or duplicated. */
  id?: string;
}
export type Control =
  | (Base & { kind: "mark"; state: Mark })
  | (Base & { kind: "choice"; state: " " | "x"; group: number })
  | (Base & { kind: "field"; key: string; value: string })
  | (Base & { kind: "chip"; key: string; value: string; options: string[] });

export interface ActionableDocument {
  controls: Control[];
  /** The click cycle for marks: the document's `marks:` or the default `[" ", "x"]`. */
  cycle: Mark[];
  /** The declared `actionable:` version, or null. */
  version: number | null;
  problems: string[];
}

export interface LinePatch {
  line: number;
  id?: string;
  expect: string;
  replace: string;
}

export type ControlAction =
  | { kind: "mark"; to: Mark }
  | { kind: "choice" }
  | { kind: "field"; value: string }
  | { kind: "chip"; value: string };

// List marker with indentation, optionally inside blockquote prefixes.
const LIST = String.raw`(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+`;
const MARK_LINE = new RegExp(`^(${LIST})\\[([ xX/!?-])\\](?=[ \\t])`);
const CHOICE_LINE = new RegExp(`^(${LIST})\\(([ x])\\)(?=[ \\t])`);
const FIELD_LINE = new RegExp(`^((?:${LIST}|(?:[ \\t]*>[ \\t]?)*[ \\t]*))([A-Za-z][A-Za-z0-9_-]{0,39})::(?=[ \\t]|$)`);
const ID_COMMENT = /[ \t]*<!--[ \t]*id:[ \t]*([A-Za-z0-9][A-Za-z0-9._-]{0,63})[ \t]*-->[ \t]*$/;
const FRONT_KEY = /^([A-Za-z0-9_][\w.-]*)[ \t]*:(?:([ \t]+)(.*))?$/;

/** Split into line contents and their terminators, as markdown-it numbers lines. */
export function splitLines(text: string): { bom: string; lines: string[]; eols: string[] } {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const lines: string[] = [];
  const eols: string[] = [];
  const pattern = /\r\n|\r|\n/g;
  let start = bom.length;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    lines.push(text.slice(start, match.index));
    eols.push(match[0]);
    start = match.index + match[0].length;
  }
  lines.push(text.slice(start));
  eols.push("");
  return { bom, lines, eols };
}

let parser: InstanceType<typeof MarkdownItCtor> | null = null;
function blockParser(): InstanceType<typeof MarkdownItCtor> {
  if (!parser) {
    // The block structure of the app's parser: callouts and footnotes hold paragraphs too.
    parser = new MarkdownItCtor({ html: true }).use(footnote);
    for (const name of ["note", "tip", "warning", "danger"]) {
      parser.use(container as unknown as (md: InstanceType<typeof MarkdownItCtor>, name: string) => void, name);
    }
  }
  return parser;
}

/** Where a line's id comment starts (or the line's end) and the id it names. */
function idOf(line: string): { end: number; id?: string } {
  const match = ID_COMMENT.exec(line);
  return match ? { end: match.index, id: match[1] } : { end: line.length };
}

export function parseActionable(text: string): ActionableDocument {
  const { lines } = splitLines(text);
  const { body, frontMatter } = readFrontMatter(text);
  const tokens = blockParser().parse(body, {});
  const controls: Control[] = [];
  const problems: string[] = [];
  const lists: Array<{ group: number | null }> = [];
  let groups = 0;
  const seen = new Set<number>();

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") lists.push({ group: null });
    if (token.type === "bullet_list_close" || token.type === "ordered_list_close") lists.pop();
    if (token.type !== "inline" || tokens[index - 1]?.type !== "paragraph_open" || !token.map) continue;
    const firstOfItem = tokens[index - 2]?.type === "list_item_open";
    for (let number = token.map[0]; number < token.map[1]; number++) {
      const line = lines[number] ?? "";
      if (seen.has(number)) continue;
      seen.add(number);
      const { end, id } = idOf(line);
      const base = { line: number + 1, ...(id ? { id } : {}) };
      if (firstOfItem && number === token.map[0]) {
        const mark = MARK_LINE.exec(line);
        if (mark) {
          const at = mark[1]!.length + 1;
          controls.push({ ...base, kind: "mark", state: (mark[2] === "X" ? "x" : mark[2]) as Mark, span: [at, at + 1] });
          continue;
        }
        const choice = CHOICE_LINE.exec(line);
        if (choice) {
          const list = lists[lists.length - 1]!;
          list.group ??= groups++;
          const at = choice[1]!.length + 1;
          controls.push({ ...base, kind: "choice", state: choice[2] as " " | "x", group: list.group, span: [at, at + 1] });
          continue;
        }
      }
      // A field line is the list item's first line or a line of a plain paragraph.
      const field = (firstOfItem && number !== token.map[0]) ? null : FIELD_LINE.exec(line);
      if (field) {
        let at = field[0].length;
        if (/[ \t]/.test(line[at] ?? "") && at < end) at += 1; // the one separating space
        const valueEnd = Math.max(at, end);
        controls.push({ ...base, kind: "field", key: field[2]!, value: line.slice(at, valueEnd), span: [at, valueEnd] });
      }
    }
  }

  // Ids are unique or ignored for placement.
  const counts = new Map<string, number>();
  for (const control of controls) if (control.id) counts.set(control.id, (counts.get(control.id) ?? 0) + 1);
  for (const [id, count] of counts) {
    if (count < 2) continue;
    problems.push(`The id "${id}" is used ${count} times; these items cannot be found again after an outside change.`);
    for (const control of controls) if (control.id === id) delete control.id;
  }

  const entries = frontMatter?.entries ?? [];
  const entry = (key: string): FrontMatterEntry | undefined => entries.find(item => item.key === key);
  let cycle: Mark[] = [" ", "x"];
  const declared = entry("marks")?.value;
  if (declared !== undefined) {
    const valid = Array.isArray(declared) && declared.includes(" ") && declared.length > 1
      && declared.every(mark => (MARKS as readonly string[]).includes(mark)) && new Set(declared).size === declared.length;
    if (valid) cycle = declared as Mark[];
    else problems.push(`"marks" must list distinct marks from ${MARKS.map(mark => `"${mark}"`).join(", ")} and include " "; the default cycle is used.`);
  }
  let version: number | null = null;
  const actionable = entry("actionable")?.value;
  if (typeof actionable === "string" && /^\d+$/.test(actionable)) {
    version = Number(actionable);
    if (version > SUPPORTED_VERSION) problems.push(`This document declares actionable: ${version}; this MDviewer supports version ${SUPPORTED_VERSION} and shows what it understands.`);
  }

  if (frontMatter?.lineCount) {
    for (let number = 1; number < frontMatter.lineCount - 1; number++) {
      const line = lines[number] ?? "";
      const match = FRONT_KEY.exec(line);
      if (!match || match[1]!.endsWith(".options")) continue;
      const key = match[1]!;
      const options = entry(`${key}.options`)?.value;
      if (!Array.isArray(options) || !options.length) continue;
      const span = scalarSpan(line, match[1]!.length, match[3]);
      if (!span) { problems.push(`The value of "${key}" is not a one-line scalar, so its chip is not interactive.`); continue; }
      controls.push({ line: number + 1, id: key, kind: "chip", key, value: unquote(line.slice(...span), line[span[0] - 1]), options, span });
    }
  }
  controls.sort((a, b) => a.line - b.line);
  return { controls, cycle, version, problems };
}

/** The editable range of a front matter scalar: inside its quotes, or the plain text before a comment. */
function scalarSpan(line: string, keyLength: number, rest: string | undefined): [number, number] | null {
  const valueStart = rest === undefined ? line.length : line.length - rest.length;
  if (rest === undefined || rest === "") return [valueStart, valueStart];
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    const body = quote === '"' ? /^"((?:[^"\\]|\\.)*)"(?:[ \t]+#.*)?[ \t]*$/ : /^'((?:[^']|'')*)'(?:[ \t]+#.*)?[ \t]*$/;
    const match = body.exec(rest);
    return match ? [valueStart + 1, valueStart + 1 + match[1]!.length] : null;
  }
  if (/^[[{|>&*!%@`]/.test(rest)) return null;
  const comment = rest.search(/[ \t]#/);
  const plain = (comment === -1 ? rest : rest.slice(0, comment)).trimEnd();
  void keyLength;
  return [valueStart, valueStart + plain.length];
}

function unquote(raw: string, quote: string | undefined): string {
  if (quote === '"') return raw.replace(/\\(.)/g, (_, char: string) => ({ n: "\n", t: "\t" } as Record<string, string>)[char] ?? char);
  if (quote === "'") return raw.replace(/''/g, "'");
  return raw;
}

function quoteFor(value: string, quote: string | undefined): string {
  if (quote === '"') return value.replace(/["\\]/g, char => `\\${char}`);
  if (quote === "'") return value.replace(/'/g, "''");
  return value;
}

/** The next mark of the cycle, or null when the current mark is not in it (open the menu). */
export function nextMark(state: Mark, cycle: readonly Mark[]): Mark | null {
  const at = cycle.indexOf(state);
  return at === -1 ? null : cycle[(at + 1) % cycle.length]!;
}

/** The next chip option; a value outside the options moves to the first. */
export function nextOption(value: string, options: readonly string[]): string {
  const at = options.indexOf(value);
  return options[(at + 1) % options.length]!;
}

function replaceSpan(line: string, span: [number, number], text: string): string {
  return line.slice(0, span[0]) + text + line.slice(span[1]);
}

/**
 * The line patches for one gesture on one control. A choice may patch its whole group; every
 * other action patches one line. Throws for a value containing a line break.
 */
export function planChange(text: string, document: ActionableDocument, control: Control, action: ControlAction): LinePatch[] {
  const { lines } = splitLines(text);
  const patch = (target: Control, value: string): LinePatch => {
    const line = lines[target.line - 1] ?? "";
    return { line: target.line, ...(target.id ? { id: target.id } : {}), expect: line, replace: replaceSpan(line, target.span, value) };
  };
  if ((action.kind === "field" || action.kind === "chip") && /[\r\n]/.test(action.value)) {
    throw new Error("A value cannot contain a line break.");
  }
  if (control.kind === "mark" && action.kind === "mark") return action.to === control.state ? [] : [patch(control, action.to)];
  if (control.kind === "choice" && action.kind === "choice") {
    if (control.state === "x") return [patch(control, " ")];
    return [
      patch(control, "x"),
      ...document.controls.filter((item): item is Extract<Control, { kind: "choice" }> =>
        item.kind === "choice" && item.group === control.group && item !== control && item.state === "x")
        .map(item => patch(item, " ")),
    ].sort((a, b) => a.line - b.line);
  }
  if (control.kind === "field" && action.kind === "field") {
    if (action.value === control.value) return [];
    const line = lines[control.line - 1] ?? "";
    // An empty field gains exactly one space after `::`.
    const gap = control.span[0] === control.span[1] && line[control.span[0] - 1] === ":" && action.value ? " " : "";
    return [{ ...patch(control, gap + action.value) }];
  }
  if (control.kind === "chip" && action.kind === "chip") {
    if (action.value === control.value) return [];
    const line = lines[control.line - 1] ?? "";
    const quote = line[control.span[0] - 1];
    const quoted = quote === '"' || quote === "'" ? quote : undefined;
    // A plain scalar that would change meaning gets double quotes.
    const unsafe = !quoted && (/^[\s"'[\]{}#&*!|>%@`,?:-]|: |\s#|\s$/.test(action.value) || action.value === "");
    const value = unsafe ? `"${quoteFor(action.value, '"')}"` : quoteFor(action.value, quoted);
    return [patch(control, value)];
  }
  throw new Error(`A ${action.kind} action does not apply to a ${control.kind}.`);
}

/**
 * Apply line patches to the text, changing nothing else: the byte order mark, every line
 * terminator and the final newline are kept. Throws when a line no longer equals `expect`.
 */
export function applyPatches(text: string, patches: readonly LinePatch[]): string {
  const { bom, lines, eols } = splitLines(text);
  for (const patch of patches) {
    if (/[\r\n]/.test(patch.replace)) throw new Error("A patch cannot add a line break.");
    if (lines[patch.line - 1] !== patch.expect) throw new Error(`Line ${patch.line} changed; the patch cannot be placed.`);
  }
  for (const patch of patches) lines[patch.line - 1] = patch.replace;
  return bom + lines.map((line, index) => line + eols[index]).join("");
}
