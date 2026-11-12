import type { Problem } from "./types";

interface Position { line: number; column: number }
export type JsonValue = Position & (
  | { kind: "object"; entries: { key: string; value: JsonValue }[] }
  | { kind: "array"; items: JsonValue[] }
  | { kind: "string"; value: string }
  | { kind: "number"; raw: string }
  | { kind: "literal"; raw: string }
);

export type ParseResult = { value: JsonValue; problem?: never } | { value?: never; problem: Problem };
class SyntaxProblem extends Error {
  constructor(readonly problem: Problem) { super(problem.message); }
}

/** A source-preserving JSON parser. Numbers never pass through a JS numeric value. */
export function parseJson(text: string, comments = false, lineOffset = 0): ParseResult {
  let at = 0;
  let line = lineOffset + 1;
  let column = 1;
  function advance(): string {
    const c = text[at++] ?? "";
    if (c === "\n" || (c === "\r" && text[at] !== "\n")) { line++; column = 1; }
    else column++;
    return c;
  }
  function fail(message: string): never { throw new SyntaxProblem({ message, line, column }); }
  function space(): void {
    while (at < text.length) {
      if (/[ \t\r\n]/.test(text[at]!)) { advance(); continue; }
      if (!comments || text[at] !== "/") return;
      if (text[at + 1] === "/") {
        while (at < text.length && !/[\r\n]/.test(text[at]!)) advance();
      } else if (text[at + 1] === "*") {
        advance(); advance();
        while (at < text.length && !(text[at] === "*" && text[at + 1] === "/")) advance();
        if (at === text.length) fail("Unterminated comment");
        advance(); advance();
      } else return;
    }
  }
  function string(): string {
    advance();
    let value = "";
    while (at < text.length) {
      const c = text[at]!;
      if (c === '"') { advance(); return value; }
      if (c.charCodeAt(0) < 32) fail("Unescaped control character in a string");
      advance();
      if (c !== "\\") { value += c; continue; }
      const escape = text[at];
      if (escape === "u") {
        advance();
        let hex = "";
        for (let i = 0; i < 4; i++) {
          if (!/[0-9a-fA-F]/.test(text[at] ?? "")) fail("Expected four hexadecimal digits after '\\u'");
          hex += advance();
        }
        value += String.fromCharCode(parseInt(hex, 16));
      } else {
        const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (escape === undefined || !Object.hasOwn(escapes, escape)) fail("Invalid string escape");
        value += escapes[advance()];
      }
    }
    return fail("Unterminated string");
  }
  function value(depth: number): JsonValue {
    space();
    if (depth > 512) fail("JSON nesting exceeds the maximum depth of 512");
    const position = { line, column };
    const c = text[at];
    if (c === '"') return { ...position, kind: "string", value: string() };
    if (c === "{" || c === "[") {
      const object = c === "{";
      const close = object ? "}" : "]";
      advance(); space();
      const entries: { key: string; value: JsonValue }[] = [];
      const items: JsonValue[] = [];
      if (text[at] !== close) {
        while (true) {
          if (object) {
            if (text[at] !== '"') fail("Expected a quoted object key");
            const key = string(); space();
            if (text[at] !== ":") fail("Expected ':' after a key");
            advance();
            entries.push({ key, value: value(depth + 1) });
          } else items.push(value(depth + 1));
          space();
          if (text[at] === close) break;
          if (text[at] !== ",") fail(`Expected ',' or '${close}' after a value`);
          advance(); space();
          if (comments && text[at] === close) break;
        }
      }
      advance();
      return object ? { ...position, kind: "object", entries } : { ...position, kind: "array", items };
    }
    for (const raw of ["true", "false", "null"] as const) {
      if (text.startsWith(raw, at)) {
        for (let i = 0; i < raw.length; i++) advance();
        return { ...position, kind: "literal", raw };
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
    if (number) {
      for (let i = 0; i < number[0].length; i++) advance();
      return { ...position, kind: "number", raw: number[0] };
    }
    return fail("Expected a JSON value");
  }
  try {
    const result = value(0); space();
    if (at !== text.length) fail("Unexpected text after a value");
    return { value: result };
  } catch (error) {
    if (error instanceof SyntaxProblem) return { problem: error.problem };
    throw error;
  }
}
