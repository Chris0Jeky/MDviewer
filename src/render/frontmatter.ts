/**
 * Leading YAML front matter: recognise it, blank it for rendering, read it tolerantly.
 *
 * Both pipelines call `readFrontMatter` before parsing. The block is replaced by the same
 * number of empty lines so markdown-it source maps keep pointing at the original lines;
 * a document without front matter is returned unchanged (paginated output stays identical).
 * The reader shows the result as a Properties card; pagination omits it.
 *
 * No YAML dependency: a line reader for flat keys, one level of nesting, lists, quoted
 * strings and block scalars. Anything else leaves `entries` null and the card shows raw text.
 */

export interface FrontMatterEntry {
  key: string;
  value: string | string[];
}

export interface FrontMatterProblem {
  /** 1-based line in the original document. */
  line: number;
  message: string;
}

export interface FrontMatter {
  /** The YAML between the fences ("" when the block never closes). */
  raw: string;
  /** Lines blanked from the body, fences included; 0 when unterminated. */
  lineCount: number;
  /** Parsed fields, or null when the reader does not understand the YAML. */
  entries: FrontMatterEntry[] | null;
  problems: FrontMatterProblem[];
}

const FENCE_OPEN = /^\uFEFF?---[ \t]*$/;
const FENCE_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY_LINE = /^( *)([A-Za-z0-9_][\w.-]*|"[^"]*"|'[^']*')[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const LOOKS_LIKE_YAML = /^(?:[A-Za-z0-9_"'][^:]*:(?:\s|$)|- |#)/;
const BLOCK_SCALAR = /^[|>][-+]?\d?$/;

/** Split `text` into lines lazily: front matter is small, documents may be 25 MB. */
function* lines(text: string): Generator<{ line: string; end: number }> {
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf("\n", start);
    const stop = newline === -1 ? text.length : newline;
    yield { line: text.slice(start, stop).replace(/\r$/, ""), end: newline === -1 ? stop : stop + 1 };
    if (newline === -1) return;
    start = newline + 1;
  }
}

export function readFrontMatter(text: string): { body: string; frontMatter: FrontMatter | null } {
  const iterator = lines(text);
  const first = iterator.next();
  if (first.done || !FENCE_OPEN.test(first.value.line)) return { body: text, frontMatter: null };
  const inner: string[] = [];
  for (const { line, end } of iterator) {
    if (FENCE_CLOSE.test(line)) {
      if (!looksLikeYaml(inner)) return { body: text, frontMatter: null };
      const lineCount = inner.length + 2;
      const raw = inner.join("\n");
      return {
        body: "\n".repeat(lineCount) + text.slice(end),
        frontMatter: { raw, lineCount, ...parseYaml(inner) },
      };
    }
    inner.push(line);
  }
  // A leading thematic break is ordinary Markdown; only YAML-shaped text is a broken block.
  if (!inner.length || !LOOKS_LIKE_YAML.test(inner[0]!)) return { body: text, frontMatter: null };
  return {
    body: text,
    frontMatter: {
      raw: "", lineCount: 0, entries: null,
      problems: [{ line: 1, message: "Front matter starts on line 1 but never closes with ---. Tools that read it will ignore the file's properties." }],
    },
  };
}

function looksLikeYaml(inner: readonly string[]): boolean {
  const first = inner.find(line => line.trim());
  return first === undefined || LOOKS_LIKE_YAML.test(first);
}

function unquoteKey(key: string): string {
  return /^["']/.test(key) ? key.slice(1, -1) : key;
}

/** Returns the scalar value, or undefined when this reader does not understand it. */
function scalar(value: string): string | string[] | undefined {
  if (value.startsWith('"')) {
    const match = /^"((?:[^"\\]|\\.)*)"(?:\s+#.*)?$/.exec(value);
    return match ? match[1]!.replace(/\\(["\\/])/g, "$1").replace(/\\n/g, "\n").replace(/\\t/g, "\t") : undefined;
  }
  if (value.startsWith("'")) {
    const match = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(value);
    return match ? match[1]!.replace(/''/g, "'") : undefined;
  }
  if (value.startsWith("[")) {
    const match = /^\[(.*)\](?:\s+#.*)?$/.exec(value);
    if (!match) return undefined;
    const items: string[] = [];
    for (const item of match[1]!.split(",").map(part => part.trim()).filter(Boolean)) {
      const parsed = scalar(item);
      if (typeof parsed !== "string") return undefined;
      items.push(parsed);
    }
    return items;
  }
  if (/^[{&*!%@`]/.test(value)) return undefined;
  return value.replace(/\s+#.*$/, "");
}

function plainColonProblem(value: string, key: string, line: number): FrontMatterProblem | null {
  if (/^["'[{|>]/.test(value) || !/: /.test(value.replace(/\s+#.*$/, ""))) return null;
  return { line, message: `The value of "${key}" contains ": " but is not quoted, so YAML rejects the whole block. Wrap the value in quotes.` };
}

function parseYaml(inner: readonly string[]): Pick<FrontMatter, "entries" | "problems"> {
  const entries: FrontMatterEntry[] = [];
  const problems: FrontMatterProblem[] = [];
  let understood = true;
  let parent: string | null = null; // a key whose value is a nested map
  let list: string[] | null = null; // the list currently being filled
  for (let index = 0; index < inner.length; index++) {
    const line = inner[index]!;
    const documentLine = index + 2;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/\t/.test(line.match(/^\s*/)![0])) { understood = false; continue; }
    const item = /^( *)- +(.*?)\s*$/.exec(line);
    if (item && list && (item[1]!.length > 0 || parent === null)) {
      const parsed = scalar(item[2]!);
      if (typeof parsed === "string") list.push(parsed); else understood = false;
      continue;
    }
    const keyLine = KEY_LINE.exec(line);
    if (!keyLine) { understood = false; continue; }
    const indent = keyLine[1]!.length;
    if (indent > 0 && parent === null) { understood = false; continue; }
    if (indent === 0) parent = null;
    const key: string = indent > 0 ? `${parent}.${unquoteKey(keyLine[2]!)}` : unquoteKey(keyLine[2]!);
    const value = keyLine[3] ?? "";
    list = null;
    const problem = plainColonProblem(value, key, documentLine);
    if (problem) problems.push(problem);
    if (!value) {
      // Either a list, a nested map, or an empty value; the next lines decide.
      const next = inner.slice(index + 1).find(candidate => candidate.trim() && !/^\s*#/.test(candidate)) ?? "";
      if (/^ *- /.test(next)) { list = []; entries.push({ key, value: list }); }
      else if (indent === 0 && /^ +\S/.test(next)) parent = key;
      else entries.push({ key, value: "" });
      continue;
    }
    if (BLOCK_SCALAR.test(value)) {
      const body: string[] = [];
      while (index + 1 < inner.length && (!inner[index + 1]!.trim() || /^\s/.test(inner[index + 1]!))
        && (inner[index + 1]!.match(/^ */)![0].length > indent || !inner[index + 1]!.trim())) {
        body.push(inner[++index]!.trim());
      }
      while (body.length && !body[body.length - 1]) body.pop();
      entries.push({ key, value: value.startsWith("|") ? body.join("\n") : body.join(" ").replace(/ {2,}/g, " ") });
      continue;
    }
    const parsed = scalar(value);
    if (parsed === undefined) { understood = false; continue; }
    entries.push({ key, value: parsed });
  }
  return { entries: understood ? entries : null, problems };
}

export type FrontMatterKind = "skill" | "agent" | "memory";

/**
 * Which Claude Code file this is, from its path when known, else its keys.
 * ponytail: basename + key heuristic until bound documents carry display paths (S0).
 */
export function frontMatterKind(fileName: string, frontMatter: FrontMatter): FrontMatterKind | null {
  const path = fileName.replace(/\\/g, "/").toLowerCase();
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base === "skill.md") return "skill";
  if (/(?:^|\/)\.claude\/agents\/[^/]+\.md$/.test(path)) return "agent";
  if (/(?:^|\/)memory\/[^/]+\.md$/.test(path) && base !== "memory.md") return "memory";
  const keys = new Set((frontMatter.entries ?? []).map(entry => entry.key));
  if (keys.has("metadata.type")) return "memory";
  if (keys.has("tools")) return "agent";
  return null;
}

const KIND_LABEL: Record<FrontMatterKind, string> = { skill: "skill", agent: "agent definition", memory: "memory file" };

/** Structural problems plus the required keys for skills, agents and memory files. */
export function frontMatterProblems(fileName: string, frontMatter: FrontMatter): FrontMatterProblem[] {
  const problems = [...frontMatter.problems];
  const kind = frontMatterKind(fileName, frontMatter);
  if (!kind || !frontMatter.entries) return problems;
  const present = new Set(frontMatter.entries.filter(entry => entry.value.length).map(entry => entry.key));
  for (const key of ["name", "description"]) {
    if (!present.has(key)) {
      problems.push({ line: 1, message: `This ${KIND_LABEL[kind]} has no "${key}". Claude Code needs a name and a description to load it.` });
    }
  }
  return problems;
}
