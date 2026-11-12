import { cellText, fence } from "./escape";
import { parseJson, type JsonValue } from "./json";
import type { Problem, ReadableOptions } from "./types";

/** Flat tables wider than this are shown as records. */
const MAX_COLUMNS = 32;
/** Headings to level 4, then nested lists: markdown-it drops content past ~50 list levels. */
const MAX_LEVEL = 4 + 24;

const proseKeys = new Set(["description", "prompt", "content", "text", "message", "body", "summary", "instructions", "system"]);
const labels = ["name", "title", "id", "key", "label", "type"];

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
function codeLike(text: string): boolean {
  return /\n/.test(text) && /^(?:\s*(?:const |let |def |class |import |SELECT |#!)|\s*[{}]\s*$)/m.test(text);
}

export function hint(value: JsonValue, key: string, timeZone: string): string {
  const text = raw(value);
  if (/(^|_)(time|date|at|ts|timestamp|created|updated)$/i.test(key)) {
    let date: Date | undefined;
    if (value.kind === "number" || (value.kind === "string" && /^-?\d+(?:\.\d+)?$/.test(text))) {
      const n = Number(text);
      date = new Date(Math.abs(n) < 1e11 ? n * 1000 : n);
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

  private block(value: JsonValue, key: string): boolean {
    return value.kind === "string" && (this.embedded.has(value) || proseKeys.has(key.toLowerCase())
      || (!this.literalStrings && clearlyMarkdown(value.value)) || value.value.length > 160 || /[\r\n]/.test(value.value));
  }

  private inline(value: JsonValue, key = ""): string {
    const text = value.kind === "array" && value.items.length ? value.items.map(v => this.inline(v, key)).join(", ") : cellText(raw(value));
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
    } else if (codeLike(value.value)) {
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
      for (const entry of value.entries) {
        if (this.exhausted()) break;
        const target = childPath(path, entry.key);
        if (scalar(entry.value) && !this.block(entry.value, entry.key)) {
          if (!this.take()) break;
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
    const flat = value.items.every(v => v.kind === "object"
      && new Set(v.entries.map(e => e.key)).size === v.entries.length
      && v.entries.every(e => scalar(e.value) || (e.value.kind === "array" && e.value.items.length <= 8 && e.value.items.every(scalar))));
    if (flat) {
      const keys = Array.from(new Set(value.items.flatMap(v => v.kind === "object" ? v.entries.map(e => e.key) : [])));
      // Empty records still need a visible value rather than an invisible zero-column table.
      // Too many distinct keys make an unreadable (and unbounded) table: show records instead.
      if (keys.length && keys.length <= MAX_COLUMNS) {
        let header = false;
        const details: { value: JsonValue; key: string; path: string; label: string }[] = [];
        for (const [index, item] of value.items.entries()) {
          if (!this.take(this.count(item))) break;
          if (!header) {
            this.line(`${indent}| ${keys.map(cellText).join(" | ")} |`, path);
            this.line(`${indent}| ${keys.map(() => "---").join(" | ")} |`); header = true;
          }
          const entries = item.kind === "object" ? item.entries : [];
          this.line(`${indent}| ${keys.map(k => {
            const v = entries.find(e => e.key === k)?.value;
            return v ? this.inline(v, k) : "";
          }).join(" | ")} |`, `${path}[${index}]`);
          for (const entry of entries) {
            const target = childPath(`${path}[${index}]`, entry.key);
            if (this.block(entry.value, entry.key)) {
              details.push({ ...entry, path: target, label: `${index}: ${entry.key}` });
            } else if (entry.value.kind === "array") {
              for (const [i, v] of entry.value.items.entries()) {
                if (this.block(v, entry.key)) details.push({ value: v, key: entry.key, path: `${target}[${i}]`, label: `${index}: ${entry.key}[${i}]` });
              }
            }
          }
        }
        this.line();
        // Retain the mandatory flat table and add block views for prose, code, or embedded JSON.
        // These values were charged with their row, so the detail must not spend the budget twice.
        // A table nested inside a prepaid detail keeps the outer detail's unspent credit.
        const outer = this.prepaid;
        for (const detail of details) {
          this.prepaid = this.count(detail.value);
          const next = this.heading(detail.label, detail.path, level, indent);
          this.render(detail.value, detail.path, level + 1, next, detail.key);
        }
        this.prepaid = outer;
        return;
      }
    }
    if (value.items.every(scalar) && value.items.length <= 8
      && value.items.map(raw).join(", ").length < 80 && !value.items.some(v => this.block(v, key))
      && this.shown + value.items.length <= this.maxValues) {
      if (this.take(value.items.length)) { this.line(indent + value.items.map(v => this.inline(v, key)).join(", "), path); this.line(); }
      return;
    }
    for (const [index, item] of value.items.entries()) {
      if (this.exhausted()) break;
      const target = `${path}[${index}]`;
      if (scalar(item) && !this.block(item, key)) {
        if (!this.take()) break;
        this.line(`${indent}- ${this.inline(item, key)}`, target);
      } else {
        if (this.exhausted()) { this.take(); break; }
        let label = String(index);
        if (item.kind === "object") {
          for (const name of labels) {
            const member = item.entries.find(e => e.key === name);
            if (member && scalar(member.value)) { label = raw(member.value); break; }
          }
        }
        const next = this.heading(label, target, level, indent);
        this.render(item, target, level + 1, next, key);
      }
    }
    this.line();
  }

  /** Generic data inside a conversation must not opt into message Markdown. */
  renderLiteral(value: JsonValue, path: string, level = 3): void {
    this.literalStrings = true;
    try { this.render(value, path, level); }
    finally { this.literalStrings = false; }
  }

  /** Reuse the generic object layout for members of an already charged container. */
  renderMembers(value: Extract<JsonValue, { kind: "object" }>, path: string, level = 3): void {
    this.prepaid = 1;
    try { this.renderLiteral(value, path, level); }
    finally { this.prepaid = 0; }
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
