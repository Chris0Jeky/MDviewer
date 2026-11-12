import type { JsonValue, ParseResult } from "./json";
import type { Problem } from "./types";

type Table = Extract<JsonValue, { kind: "object" }>;
type List = Extract<JsonValue, { kind: "array" }>;
class TomlProblem extends Error {
  constructor(readonly problem: Problem) { super(problem.message); }
}

/** TOML 1.0 syntax reader. Ordered entries and scalar lexemes never pass through JS objects/numbers. */
export function parseToml(text: string): ParseResult {
  let at = 0, line = 1, column = 1;
  const pos = (): { line: number; column: number } => ({ line, column });
  // `keys` indexes each table's entries by key, so a wide table is linear, not quadratic.
  const tables = new WeakMap<Table, { defined: boolean; sealed: boolean; dotted: boolean; keys: Map<string, JsonValue> }>();
  const tableArrays = new WeakSet<List>();
  function fail(message: string, location = pos()): never { throw new TomlProblem({ message, ...location }); }
  function next(): string {
    const c = text[at++] ?? "";
    if (c === "\n") { line++; column = 1; }
    else column++;
    return c;
  }
  function newline(): boolean {
    if (text[at] === "\r") {
      if (text[at + 1] !== "\n") fail("Expected LF after CR");
      next(); next(); return true;
    }
    if (text[at] === "\n") { next(); return true; }
    return false;
  }
  function spaces(lines = false): void {
    while (at < text.length) {
      if (text[at] === " " || text[at] === "\t") next();
      else if (lines && text[at] === "#") comment();
      else if (lines && newline()) continue;
      else break;
    }
  }
  function comment(): void {
    while (at < text.length && text[at] !== "\r" && text[at] !== "\n") {
      const code = text.charCodeAt(at);
      if ((code < 32 && code !== 9) || code === 127) fail("Control character in a comment");
      next();
    }
  }
  function table(defined: boolean, location = pos()): Table {
    const value: Table = { ...location, kind: "object", entries: [] };
    tables.set(value, { defined, sealed: false, dotted: false, keys: new Map() });
    return value;
  }
  function string(key = false): string {
    const start = pos();
    const quote = next();
    const basic = quote === '"';
    const multi = !key && text.startsWith(quote + quote, at);
    if (multi) { next(); next(); newline(); }
    let value = "";
    while (at < text.length) {
      if (text[at] === quote) {
        let n = 0;
        while (text[at + n] === quote) n++;
        if (!multi) { next(); return value; }
        if (n >= 3) {
          if (n > 5) fail("Too many closing quotes");
          for (let i = 0; i < n; i++) next();
          return value + quote.repeat(n - 3);
        }
        for (let i = 0; i < n; i++) value += next();
        continue;
      }
      if (text[at] === "\r" || text[at] === "\n") {
        if (!multi) fail("Newline in a single-line string");
        newline(); value += "\n"; continue;
      }
      const code = text.charCodeAt(at);
      if ((code < 32 && code !== 9) || code === 127) fail("Control character in a string");
      if (basic && text[at] === "\\") {
        next();
        if (multi && /[ \t\r\n]/.test(text[at] ?? "")) {
          spaces();
          if (!newline()) fail("Expected newline after a string continuation");
          while (at < text.length) {
            spaces();
            if (!newline()) break;
          }
          continue;
        }
        const escape = next();
        const escapes: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
        if (Object.hasOwn(escapes, escape)) value += escapes[escape];
        else if (escape === "u" || escape === "U") {
          const length = escape === "u" ? 4 : 8;
          const hex = text.slice(at, at + length);
          if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) fail("Invalid Unicode escape");
          const cp = parseInt(hex, 16);
          if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) fail("Invalid Unicode scalar value");
          for (let i = 0; i < length; i++) next();
          value += String.fromCodePoint(cp);
        } else fail("Invalid string escape");
      } else value += next();
    }
    return fail("Unterminated string", start);
  }
  function keyPath(): string[] {
    const keys: string[] = [];
    while (true) {
      spaces();
      if (text[at] === '"' || text[at] === "'") keys.push(string(true));
      else {
        let key = "";
        while (at < text.length && /[A-Za-z0-9_-]/.test(text[at]!)) key += next();
        if (!key) fail("Expected a key");
        keys.push(key);
      }
      if (keys.length > 512) fail("TOML nesting exceeds the maximum depth of 512");
      spaces();
      if (text[at] !== ".") return keys;
      next();
    }
  }
  function descend(parent: Table, key: string, dotted: boolean, location: { line: number; column: number }): Table {
    if (tables.get(parent)!.sealed) fail("Cannot extend an inline table");
    let child = tables.get(parent)!.keys.get(key);
    if (!child) {
      child = table(dotted, location);
      tables.get(child)!.dotted = dotted;
      parent.entries.push({ key, value: child });
      tables.get(parent)!.keys.set(key, child);
    }
    if (child.kind === "array" && tableArrays.has(child)) child = child.items[child.items.length - 1]!;
    if (child.kind !== "object") fail(`Key '${key}' is already a value`);
    if (tables.get(child)!.sealed) fail("Cannot extend an inline table");
    const meta = tables.get(child)!;
    if (dotted) {
      // Only a table defined by its own [header] is closed to dotted keys; a supertable a
      // header created implicitly ([a.b.c] creates a.b) may still be extended, and is then
      // defined by those dotted keys, so a later [a.b] header is a redefinition.
      if (meta.defined && !meta.dotted) fail(`Redefined table '${key}'`);
      meta.dotted = true;
      meta.defined = true;
    }
    return child;
  }
  function assign(parent: Table, keys: string[], value: JsonValue, location: { line: number; column: number }): void {
    for (const key of keys.slice(0, -1)) parent = descend(parent, key, true, location);
    const key = keys[keys.length - 1]!;
    if (tables.get(parent)!.keys.has(key)) fail(`Duplicate key '${key}'`, location);
    parent.entries.push({ key, value });
    tables.get(parent)!.keys.set(key, value);
  }
  function validDate(raw: string): boolean {
    const match = /^(\d{4})-(\d\d)-(\d\d)(?:[Tt ](\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:[Zz]|([+-])(\d\d):(\d\d))?)?$/.exec(raw);
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
      && (match[4] === undefined || (Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 60))
      && (match[8] === undefined || (Number(match[8]) <= 23 && Number(match[9]) <= 59));
  }
  function value(depth: number): JsonValue {
    if (depth > 512) fail("TOML nesting exceeds the maximum depth of 512");
    const start = pos();
    if (text[at] === '"' || text[at] === "'") return { ...start, kind: "string", value: string() };
    if (text[at] === "[") {
      next(); spaces(true);
      const items: JsonValue[] = [];
      while (text[at] !== "]") {
        if (at >= text.length) fail("Unterminated array", start);
        items.push(value(depth + 1)); spaces(true);
        if (text[at] === "]") break;
        if (text[at] !== ",") fail("Expected ',' or ']' after an array value");
        next(); spaces(true);
      }
      next(); return { ...start, kind: "array", items };
    }
    if (text[at] === "{") {
      next(); spaces();
      const result = table(true, start);
      while (text[at] !== "}") {
        const keyStart = pos(), keys = keyPath();
        if (text[at] !== "=") fail("Expected '=' after a key");
        next(); spaces(); assign(result, keys, value(depth + 1), keyStart); spaces();
        if (text[at] === "}") break;
        if (text[at] !== ",") fail("Expected ',' or '}' after an inline table value");
        next(); spaces();
        if (text[at] === "}") fail("Trailing comma in an inline table");
      }
      next();
      function seal(t: Table): void {
        tables.get(t)!.sealed = true;
        for (const entry of t.entries) if (entry.value.kind === "object") seal(entry.value);
      }
      seal(result); return result;
    }
    const offset = at;
    // A date/time's one separating space belongs to the scalar; trailing whitespace does not.
    const datePrefix = /^\d{4}-\d\d-\d\d /.test(text.slice(at));
    while (at < text.length && !/[\s,#\]}]/.test(text[at]!)) next();
    if (datePrefix && at === offset + 10 && text[at] === " " && /\d/.test(text[at + 1] ?? "")) {
      next(); while (at < text.length && !/[\s,#\]}]/.test(text[at]!)) next();
    }
    const raw = text.slice(offset, at);
    if (raw === "true" || raw === "false") return { ...start, kind: "literal", raw };
    const digits = "[0-9](?:_?[0-9])*";
    const decimal = "(?:0|[1-9](?:_?[0-9])*)";
    const integer = new RegExp(`^[+-]?${decimal}$|^0x[0-9a-fA-F](?:_?[0-9a-fA-F])*$|^0o[0-7](?:_?[0-7])*$|^0b[01](?:_?[01])*$`);
    const float = new RegExp(`^[+-]?${decimal}(?:\\.${digits}(?:[eE][+-]?${digits})?|[eE][+-]?${digits})$`);
    if (integer.test(raw) || float.test(raw)) return { ...start, kind: "number", raw };
    if (/^[+-]?(inf|nan)$/.test(raw) || validDate(raw)
      || /^(?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?$/.test(raw)) return { ...start, kind: "literal", raw };
    return fail(raw ? `Invalid TOML scalar '${raw}'` : "Expected a TOML value", start);
  }
  const root = table(true);
  let current = root;
  try {
    while (at < text.length) {
      spaces();
      if (text[at] === "#") comment();
      if (at >= text.length) break;
      if (newline()) continue;
      const start = pos();
      if (text[at] === "[") {
        next();
        const array = text[at] === "[";
        if (array) next();
        const keys = keyPath();
        if (text[at] !== "]") fail("Expected ']' after a table name");
        next();
        if (array) { if (text[at] !== "]") fail("Expected ']]' after an array table name"); next(); }
        let parent = root;
        for (const key of keys.slice(0, -1)) parent = descend(parent, key, false, start);
        const key = keys[keys.length - 1]!;
        const existing = tables.get(parent)!.keys.get(key);
        if (array) {
          if (existing && (existing.kind !== "array" || !tableArrays.has(existing))) fail(`Redefined table '${key}'`, start);
          const list: List = existing as List | undefined ?? { ...start, kind: "array", items: [] };
          if (!existing) { tableArrays.add(list); parent.entries.push({ key, value: list }); tables.get(parent)!.keys.set(key, list); }
          current = table(true, start); list.items.push(current);
        } else {
          if (existing && (existing.kind !== "object" || tables.get(existing)!.defined || tables.get(existing)!.sealed)) fail(`Redefined table '${key}'`, start);
          current = existing as Table | undefined ?? table(true, start);
          tables.get(current)!.defined = true;
          if (!existing) { parent.entries.push({ key, value: current }); tables.get(parent)!.keys.set(key, current); }
        }
      } else {
        const keys = keyPath();
        if (text[at] !== "=") fail("Expected '=' after a key");
        next(); spaces(); assign(current, keys, value(0), start);
      }
      spaces(); if (text[at] === "#") comment();
      if (at < text.length && !newline()) fail("Unexpected text after a statement");
    }
    // Headers, dotted keys and inline values each add depth; cap their combined model depth.
    const pending = [{ value: root as JsonValue, depth: 0 }];
    while (pending.length) {
      const { value: node, depth } = pending.pop()!;
      if (depth > 512) fail("TOML nesting exceeds the maximum depth of 512", node);
      const children = node.kind === "object" ? node.entries.map(e => e.value) : node.kind === "array" ? node.items : [];
      for (const child of children) pending.push({ value: child, depth: depth + 1 });
    }
    return { value: root };
  } catch (error) {
    return { problem: error instanceof TomlProblem ? error.problem : { message: error instanceof Error ? error.message : "Invalid TOML", ...pos() } };
  }
}
