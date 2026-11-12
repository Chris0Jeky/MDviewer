import { cellText, fence } from "./escape";
import { parseJson, type JsonValue } from "./json";
import type { Problem, ReadableOptions } from "./types";

/** Flat tables wider than this are shown as records. */
const MAX_COLUMNS = 32;
/** Headings to level 4, then nested lists: markdown-it drops content past ~50 list levels. */
const MAX_LEVEL = 4 + 24;

const proseKeys = new Set(["description", "prompt", "content", "text", "message", "body", "summary", "instructions", "system"]);
const labels = ["name", "title", "id", "key", "label", "type"];
const jsonNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

interface Column { name: string; keys: string[]; numeric: boolean }
export interface RecordTable { columns: Column[]; flatten: boolean }
export interface TableRow { value: JsonValue; path: string; line?: number }

export function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function scalar(value: JsonValue): boolean { return value.kind !== "object" && value.kind !== "array"; }
function raw(value: JsonValue): string {
  if (value.kind === "string") return value.value === "" ? '"" (empty string)' : value.value;
  if (value.kind === "object") return "{}";
  if (value.kind === "array") return "[]";
  return value.raw;
}
function clearlyMarkdown(text: string): boolean {
  return /^ {0,3}#{1,6} /m.test(text) || /^ {0,3}(?:`{3,}|~{3,})/m.test(text)
    || (text.match(/^ {0,3}(?:[-+*]|\d+[.)])\s+\S/gm)?.length ?? 0) >= 2;
}
export function hint(value: JsonValue, key: string, timeZone: string): string {
  const text = raw(value);
  if (/(^|_)(time|date|at|ts|timestamp|created|updated)$/i.test(key)
    || /[a-z](?:Time|Date|At|Ts|Timestamp)$/.test(key)) {
    let date: Date | undefined;
    if (value.kind === "number" || (value.kind === "string" && /^-?\d+(?:\.\d+)?$/.test(text))) {
      const n = Number(text);
      date = new Date(Math.abs(n) < 1e11 ? n * 1000 : n);
      if (date.getTime() < Date.UTC(2000, 0, 1) || date.getTime() > Date.UTC(2100, 0, 1)) date = undefined;
    } else if (value.kind === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(text)) {
      // Only a full timestamp with a zone: a date alone is already readable and names no instant.
      date = new Date(text);
    }
    if (date && Number.isFinite(date.getTime())) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(date);
      const get = (name: string): string => parts.find(p => p.type === name)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${timeZone}`;
    }
  }
  if (value.kind !== "number") return "";
  const n = Number(text);
  if (!Number.isFinite(n)) return "";
  const human = (amount: number): string => String(Number(amount.toFixed(2)));
  if (/bytes|^size$/i.test(key) && n >= 0) {
    if (n >= 1024 ** 3) return `${human(n / 1024 ** 3)} GiB`;
    if (n >= 1024 ** 2) return `${human(n / 1024 ** 2)} MiB`;
    if (n >= 1024) return `${human(n / 1024)} KiB`;
    return `${human(n)} B`;
  }
  // Only when the key names the unit: `elapsed_ms`, `durationMs`, `timeout_seconds`, `waitSecs`.
  const ms = /(^|_)ms$|[a-z]Ms$/.test(key);
  if (ms || /(^|_)(seconds|secs)$|[a-z](Seconds|Secs)$/.test(key)) {
    const seconds = ms ? n / 1000 : n;
    if (Math.abs(seconds) >= 3600) return `${human(seconds / 3600)} h`;
    if (Math.abs(seconds) >= 60) return `${human(seconds / 60)} min`;
    return `${human(seconds)} s`;
  }
  return "";
}

export function shape(value: JsonValue): string {
  if (value.kind === "object") return `object with ${count(value.entries.length, "key")}`;
  if (value.kind === "array") return `list of ${count(value.items.length, "item")}`;
  return value.kind === "literal" ? value.raw : value.kind;
}

/** Layout is written line by line so maps always refer to the final Markdown, not source offsets. */
export class Lens {
  readonly lines: string[] = [];
  readonly map = new Map<number, string>();
  readonly problems: Problem[] = [];
  shown = 0;
  total = 0;
  truncated = false;
  private stopped = false;
  private prepaid = 0;
  private readonly maxValues: number;
  readonly timeZone: string;
  private literalStrings = false;
  csv = false;
  private readonly counts = new WeakMap<JsonValue, number>();
  private readonly embedded = new WeakMap<JsonValue, JsonValue>();

  constructor(options: ReadableOptions) {
    this.maxValues = budget(options.maxValues, 20000);
    const zone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); this.timeZone = zone; }
    catch { this.timeZone = "UTC"; }
  }

  line(text = "", path?: string): void {
    // Every terminator, so no raw CR can reach markdown-it (which reads it as a line break
    // and would end an indented block early).
    for (const part of text.split(/\r\n|\r|\n/)) {
      this.lines.push(part);
      if (path !== undefined) this.map.set(this.lines.length, path);
    }
  }

  count(value: JsonValue, depth = 0): number {
    const cached = this.counts.get(value);
    if (cached !== undefined) return cached;
    let count = 1;
    if (value.kind === "object") count += value.entries.reduce((n, e) => n + this.count(e.value, depth + 1), 0);
    if (value.kind === "array") count += value.items.reduce((n, v) => n + this.count(v, depth + 1), 0);
    if (value.kind === "string" && /^[{[]/.test(value.value.trim())) {
      const parsed = parseJson(value.value);
      if (parsed.value) {
        if (depth >= 512) {
          this.problems.push({ message: "JSON in a string exceeds the maximum combined depth of 512; showing the string.", line: value.line, column: value.column });
        } else {
          this.embedded.set(value, parsed.value);
          count += this.count(parsed.value, depth + 1);
        }
      }
    }
    this.counts.set(value, count);
    return count;
  }

  take(n = 1): boolean {
    if (this.prepaid >= n) { this.prepaid -= n; return true; }
    if (this.stopped) return false;
    if (this.shown + n > this.maxValues) {
      this.truncated = true; this.stopped = true; return false;
    }
    this.shown += n;
    return true;
  }

  /** No more can be shown: no credit was prepaid for this value and the budget is spent. */
  private exhausted(): boolean {
    return this.prepaid === 0 && (this.stopped || this.shown >= this.maxValues);
  }

  private block(value: JsonValue): boolean {
    return value.kind === "string" && (this.embedded.has(value)
      || (!this.literalStrings && clearlyMarkdown(value.value)) || value.value.length > 160 || /[\r\n]/.test(value.value));
  }

  private quoted(text: string): boolean {
    return jsonNumber.test(text) || /^(?:true|false|null)$/.test(text) || (!/[\r\n]/.test(text) && /^\s|\s$/.test(text));
  }

  private scalarText(value: JsonValue, compound = false): string {
    if (value.kind !== "string") return cellText(raw(value));
    if (this.csv) return cellText(value.value);
    const quote = value.value !== "" && (this.quoted(value.value) || (compound && /, | · |: /.test(value.value)));
    return quote ? `${cellText('"')}${cellText(value.value)}${cellText('"')}` : cellText(raw(value));
  }

  private compoundText(value: JsonValue): string {
    if (value.kind === "array" && value.items.length) return value.items.map(v => this.scalarText(v, true)).join(", ");
    if (value.kind === "object" && value.entries.length) return value.entries.map(e => `${cellText(e.key)}: ${this.scalarText(e.value, true)}`).join(" · ");
    return this.scalarText(value);
  }

  private rowSized(value: JsonValue): boolean {
    if (scalar(value)) return !this.block(value);
    if (value.kind === "array") return !value.items.length || (value.items.length <= 8
      && value.items.every(v => scalar(v) && !this.block(v)) && this.compoundLength(value) < 80);
    return value.kind === "object" && (!value.entries.length || (value.entries.length <= 4
      && value.entries.every(e => scalar(e.value) && !this.block(e.value)) && this.compoundLength(value) < 80));
  }

  /** Measure visible text, before Markdown escaping expands punctuation and whitespace. */
  private compoundLength(value: JsonValue): number {
    const item = (v: JsonValue): string => v.kind === "string" && v.value && (this.quoted(v.value) || /, | · |: /.test(v.value)) ? `"${v.value}"` : raw(v);
    return (value.kind === "array" ? value.items.map(item).join(", ")
      : value.kind === "object" ? value.entries.map(e => `${e.key}: ${item(e.value)}`).join(" · ") : item(value)).length;
  }

  private inline(value: JsonValue, key = ""): string {
    if (!scalar(value)) return this.compoundText(value);
    const text = this.scalarText(value);
    const annotation = hint(value, key, this.timeZone);
    return annotation ? `${text} (${cellText(annotation)})` : text;
  }

  private heading(label: string, path: string, level: number, indent: string): string {
    if (level <= 4) { this.line(`${"#".repeat(level)} ${cellText(label)}`, path); this.line(); return indent; }
    this.line(`${indent}- ${cellText(label)}`, path);
    this.line();
    return indent + "  ";
  }

  private string(value: Extract<JsonValue, { kind: "string" }>, key: string, path: string, level: number, indent: string, prose = false): void {
    const inside = prose ? undefined : this.embedded.get(value);
    if (inside) {
      const next = this.heading("(JSON in a string)", path, level, indent);
      this.render(inside, path, level + 1, next);
    } else if (!this.literalStrings && value.value && (proseKeys.has(key.toLowerCase()) || clearlyMarkdown(value.value))) {
      for (const line of value.value.split(/\r\n|\r|\n/)) this.line(`${indent}> ${line}`, path);
      this.line();
    } else if (/[\r\n]/.test(value.value)) {
      for (const line of fence(value.value).split(/\r\n|\r|\n/)) this.line(indent + line, path);
      this.line();
    } else {
      // The inline span keeps a leading <br> in a paragraph (rather than an HTML block).
      // Layout-owned <br> elements preserve real line breaks, including blank lines.
      this.line(`${indent}<span>${this.inline(value, key)}</span>`, path); this.line();
    }
  }

  render(value: JsonValue, path = "$", level = 2, indent = "", key = ""): void {
    if (level > MAX_LEVEL && !scalar(value)) {
      // Deeper nested lists would pass the renderer's nesting limit and vanish; show the rest
      // of this value literally instead, charged to the budget as a whole.
      if (!this.take(this.count(value))) return;
      for (const line of fence(jsonText(value)).split("\n")) this.line(indent + line, path);
      this.line();
      return;
    }
    if (!this.take()) return;
    if (value.kind === "string") { this.string(value, key, path, level, indent); return; }
    if (scalar(value) || (value.kind === "array" && !value.items.length) || (value.kind === "object" && !value.entries.length)) {
      this.line(indent + this.inline(value, key), path); this.line(); return;
    }
    if (value.kind === "object") {
      let table = false;
      const fits = (entry: typeof value.entries[number]): boolean => this.rowSized(entry.value);
      const rows = value.entries.filter(fits);
      const sections = value.entries.filter(e => !fits(e));
      for (const entry of [...rows, ...sections]) {
        if (this.exhausted()) break;
        const target = childPath(path, entry.key);
        if (fits(entry)) {
          if (!this.take(this.count(entry.value))) break;
          if (!table) {
            this.line(`${indent}| Key | Value |`, path); this.line(`${indent}| --- | --- |`); table = true;
          }
          this.line(`${indent}| ${cellText(entry.key)} | ${this.inline(entry.value, entry.key)} |`, target);
        } else {
          if (table) { this.line(); table = false; }
          // Do not emit a heading for a value the budget cannot show.
          if (this.exhausted()) { this.take(); break; }
          const next = this.heading(entry.key, target, level, indent);
          this.render(entry.value, target, level + 1, next, entry.key);
        }
      }
      if (table) this.line();
      return;
    }
    if (value.kind !== "array") return;
    const plan = this.recordTable(value.items);
    if (plan) {
      this.renderTable(value.items.map((item, index) => ({ value: item, path: `${path}[${index}]` })), plan, path, level, indent);
      return;
    }
    if (value.items.every(scalar) && value.items.length <= 8
      && this.compoundLength(value) < 80 && !value.items.some(v => this.block(v))
      && this.shown + value.items.length <= this.maxValues) {
      if (this.take(value.items.length)) { this.line(indent + this.compoundText(value), path); this.line(); }
      return;
    }
    for (const [index, item] of value.items.entries()) {
      if (this.exhausted()) break;
      const target = `${path}[${index}]`;
      if (scalar(item) && !this.block(item)) {
        if (!this.take()) break;
        this.line(`${indent}- ${this.inline(item, key)}`, target);
      } else {
        if (this.exhausted()) { this.take(); break; }
        let label = `${key}[${index}]`;
        if (item.kind === "object") {
          for (const name of labels) {
            const member = item.entries.find(e => e.key === name);
            if (member && scalar(member.value)) { label = raw(member.value); break; }
          }
        }
        const next = this.heading(label, target, level, indent);
        this.render(item, target, level + 1, next, item.kind === "array" ? "" : key);
      }
    }
    this.line();
  }

  /** One bounded schema pass over all records, independent of the display budget. */
  recordTable(items: readonly JsonValue[]): RecordTable | undefined {
    for (const flatten of [true, false]) {
      const columns = new Map<string, Column>();
      const seen = new Set<string>();
      let valid = items.length > 0;
      for (const item of items) {
        const cells = this.tableCells(item, flatten);
        if (!cells) { valid = false; break; }
        for (const [name, cell] of cells) {
          const column = columns.get(name);
          if (column && JSON.stringify(column.keys) !== JSON.stringify(cell.keys)) { valid = false; break; }
          const next = column ?? { name, keys: cell.keys, numeric: true };
          if (!column) columns.set(name, next);
          if (columns.size > MAX_COLUMNS) { valid = false; break; }
          if (raw(cell.value) !== "" && !(this.csv && cell.value.kind === "string" && cell.value.value === "")) {
            seen.add(name);
            next.numeric &&= cell.value.kind === "number" || (this.csv && cell.value.kind === "string" && jsonNumber.test(cell.value.value));
          }
        }
        if (!valid) break;
      }
      if (valid && columns.size) return { columns: [...columns.values()].map(c => ({ ...c, numeric: seen.has(c.name) && c.numeric })), flatten };
    }
    return undefined;
  }

  private tableCells(value: JsonValue, flatten: boolean): Map<string, { value: JsonValue; keys: string[] }> | undefined {
    if (value.kind !== "object" || new Set(value.entries.map(e => e.key)).size !== value.entries.length) return;
    const cells = new Map<string, { value: JsonValue; keys: string[] }>();
    const flatValue = (v: JsonValue): boolean => scalar(v) || (v.kind === "array" && v.items.length <= 8 && v.items.every(scalar));
    for (const entry of value.entries) {
      if (flatten && entry.value.kind === "object") {
        const nested = entry.value.entries;
        if (new Set(nested.map(e => e.key)).size !== nested.length || !nested.every(e => flatValue(e.value))) return;
        if (!nested.length) {
          if (cells.has(entry.key)) return;
          cells.set(entry.key, { value: entry.value, keys: [entry.key] });
        }
        for (const child of nested) {
          const name = `${entry.key}.${child.key}`;
          if (cells.has(name)) return;
          cells.set(name, { value: child.value, keys: [entry.key, child.key] });
        }
      } else {
        if (!flatValue(entry.value) || cells.has(entry.key)) return;
        cells.set(entry.key, { value: entry.value, keys: [entry.key] });
      }
    }
    return cells;
  }

  /** Whole rows are charged once; JSON Lines may charge them while choosing its shown range. */
  renderTable(rows: readonly TableRow[], plan: RecordTable, path = "$", level = 2, indent = "", lineColumn?: string, charged = false): void {
    let header = false;
    const details: { value: JsonValue; key: string; path: string; label: string }[] = [];
    for (const [index, row] of rows.entries()) {
      if (!charged && !this.take(this.count(row.value))) break;
      if (!header) {
        this.line(`${indent}| ${[...(lineColumn ? [cellText(lineColumn)] : []), ...plan.columns.map(c => cellText(c.name))].join(" | ")} |`, path);
        this.line(`${indent}| ${[...(lineColumn ? ["---:"] : []), ...plan.columns.map(c => c.numeric ? "---:" : "---")].join(" | ")} |`);
        header = true;
      }
      const cells = this.tableCells(row.value, plan.flatten)!;
      this.line(`${indent}| ${[...(lineColumn ? [String(row.line)] : []), ...plan.columns.map(c => {
        const cell = cells.get(c.name);
        return cell ? this.inline(cell.value, cell.keys[cell.keys.length - 1]) : "";
      })].join(" | ")} |`, row.path);
      for (const [name, cell] of cells) {
        const key = cell.keys[cell.keys.length - 1]!;
        const target = cell.keys.reduce(childPath, row.path);
        const detail = (v: JsonValue): boolean => v.kind === "string" && (this.embedded.has(v)
          || (v.value !== "" && !this.literalStrings && (proseKeys.has(key.toLowerCase()) || clearlyMarkdown(v.value))));
        if (detail(cell.value)) details.push({ value: cell.value, key, path: target, label: `${index}: ${name}` });
        else if (cell.value.kind === "array") for (const [i, v] of cell.value.items.entries()) {
          if (detail(v)) details.push({ value: v, key, path: `${target}[${i}]`, label: `${index}: ${name}[${i}]` });
        }
      }
    }
    if (header) this.line();
    // A detail shows a second representation of values already paid for by its row.
    const outer = this.prepaid;
    for (const detail of details) {
      this.prepaid = this.count(detail.value);
      const next = this.heading(detail.label, detail.path, level, indent);
      this.render(detail.value, detail.path, level + 1, next, detail.key);
    }
    this.prepaid = outer;
  }

  /** Generic data inside a conversation must not opt into message Markdown. */
  renderLiteral(value: JsonValue, path: string, level = 3): void {
    this.literalStrings = true;
    try { this.render(value, path, level); }
    finally { this.literalStrings = false; }
  }

  /** Reuse the generic object layout for members of an already charged container. */
  renderMembers(value: Extract<JsonValue, { kind: "object" }>, path: string, level = 3): void {
    // Credit for the container only; an enclosing detail keeps whatever credit it has left.
    const outer = this.prepaid;
    this.prepaid = outer + 1;
    try { this.renderLiteral(value, path, level); }
    finally { this.prepaid = Math.min(this.prepaid, outer); }
  }

  /** A message is prose even when its text happens to parse as JSON. */
  renderProse(value: Extract<JsonValue, { kind: "string" }>, path: string): void {
    if (this.take(this.count(value))) this.string(value, "content", path, 3, "", true);
  }

  finish(): string { return this.lines.join("\n").trimEnd() + "\n"; }
}

/** The value as compact JSON, numbers and literals exactly as written. */
function jsonText(value: JsonValue): string {
  switch (value.kind) {
    case "object": return `{${value.entries.map(e => `${JSON.stringify(e.key)}: ${jsonText(e.value)}`).join(", ")}}`;
    case "array": return `[${value.items.map(jsonText).join(", ")}]`;
    case "string": return JSON.stringify(value.value);
    default: return value.raw;
  }
}

export function budget(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.floor(value));
}

/** "1 key", "12 keys", "1,234 records". */
export function count(n: number, noun: string): string {
  return `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
}
