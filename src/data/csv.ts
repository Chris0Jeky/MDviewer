import type { JsonValue } from "./json";
import type { Problem } from "./types";

/** `rows` counts every data row; `value` holds only the first `keep` of them. */
export interface CsvResult { value: Extract<JsonValue, { kind: "array" }>; rows: number; columns: number; keys: string[]; problems: Problem[] }

/**
 * RFC 4180 fields, with all three common record terminators. No scalar coercion. Only the header
 * and the first `keep` data rows are kept as cells; later rows are scanned and counted, so a huge
 * file costs time but not an object per cell.
 */
export function parseCsv(text: string, delimiter = ",", keep = Infinity): CsvResult {
  type Cell = Extract<JsonValue, { kind: "string" }>;
  const rows: Cell[][] = [];
  let seen = 0, widest = 0; // all records, the header included, and the longest of the data rows
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
    if (seen <= keep) rows.push(row); // the header is seen 0
    if (seen++ > 0) widest = Math.max(widest, row.length);
    if (text[at] === "\r") { next(); if (text[at] === "\n") next(); }
    else if (text[at] === "\n") next();
  }
  const header = rows.shift() ?? [];
  const columns = Math.max(widest, header.length);
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
  const items = rows.map(row => ({
    kind: "object" as const, line: row[0]!.line, column: row[0]!.column,
    entries: row.map((value, index): { key: string; value: JsonValue } => ({ key: keys[index]!, value })),
  }));
  // A header column no row reaches would vanish from the table. Name it once, as a blank
  // cell on the first record (not on every row: a ragged file stays linear in its size).
  const reached = widest;
  if (items[0] && reached < keys.length) {
    const { line, column } = items[0];
    for (const key of keys.slice(reached)) items[0].entries.push({ key, value: { line, column, kind: "literal", raw: "" } });
  }
  return {
    value: { kind: "array", line: 1, column: 1, items },
    rows: Math.max(0, seen - 1), columns, keys, problems,
  };
}
