import type { JsonValue } from "./json";
import type { Problem } from "./types";

export interface CsvResult { value: Extract<JsonValue, { kind: "array" }>; columns: number; keys: string[]; problems: Problem[] }

/** RFC 4180 fields, with all three common record terminators. No scalar coercion. */
export function parseCsv(text: string, delimiter = ","): CsvResult {
  type Cell = Extract<JsonValue, { kind: "string" }>;
  const rows: Cell[][] = [];
  const problems: Problem[] = [];
  let at = 0, line = 1, column = 1;
  function next(): string {
    const c = text[at++]!;
    if (c === "\r") { line++; column = 1; }
    else if (c === "\n") { if (text[at - 2] !== "\r") line++; column = 1; }
    else column++;
    return c;
  }
  while (at < text.length) {
    const row: Cell[] = [];
    while (true) {
      const pos = { line, column };
      let value = "";
      if (text[at] === '"') {
        next();
        let closed = false;
        while (at < text.length) {
          const c = next();
          if (c !== '"') value += c;
          else if (text[at] === '"') { next(); value += '"'; }
          else { closed = true; break; }
        }
        if (!closed) problems.push({ ...pos, message: "Unterminated quoted field" });
        if (at < text.length && ![delimiter, "\r", "\n"].includes(text[at]!)) {
          problems.push({ line, column, message: "Unexpected text after a quoted field" });
          while (at < text.length && ![delimiter, "\r", "\n"].includes(text[at]!)) value += next();
        }
      } else {
        let quoted = false; // one problem per field, however many stray quotes it holds
        while (at < text.length && ![delimiter, "\r", "\n"].includes(text[at]!)) {
          if (text[at] === '"' && !quoted) { quoted = true; problems.push({ line, column, message: "Quote in an unquoted field" }); }
          value += next();
        }
      }
      row.push({ ...pos, kind: "string", value });
      if (text[at] !== delimiter) break;
      next();
    }
    rows.push(row);
    if (text[at] === "\r") { next(); if (text[at] === "\n") next(); }
    else if (text[at] === "\n") next();
  }
  const header = rows.shift() ?? [];
  const columns = rows.reduce((n, row) => Math.max(n, row.length), header.length);
  // Reserve names globally: literal headers such as "x (2)" or "column 3" must not collide.
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>(); // per base name, so many duplicates stay linear
  const keys = Array.from({ length: columns }, (_, index) => {
    const base = header[index]?.value || `column ${index + 1}`;
    let key = base, suffix = nextSuffix.get(base) ?? 2;
    while (used.has(key)) key = `${base} (${suffix++})`;
    nextSuffix.set(base, suffix);
    used.add(key);
    return key;
  });
  return {
    value: { kind: "array", line: 1, column: 1, items: rows.map(row => ({
      kind: "object", line: row[0]!.line, column: row[0]!.column,
      entries: row.map((value, index) => ({ key: keys[index]!, value })),
    })) },
    columns, keys, problems,
  };
}
