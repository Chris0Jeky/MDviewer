import { parseCsv } from "./csv";
import { parseJson, type JsonValue } from "./json";
import { parseToml } from "./toml";
import type { DataKind } from "./types";
import { parseYaml } from "./yaml";

/** Only the path grammar emitted by the lenses, including their `$` identifier characters. */
function pathParts(path: string): (string | number)[] | undefined {
  if (!path.startsWith("$")) return undefined;
  const parts: (string | number)[] = [];
  let at = 1;
  while (at < path.length) {
    const rest = path.slice(at);
    const key = /^\.([A-Za-z_$][\w$]*)/.exec(rest);
    if (key) { parts.push(key[1]!); at += key[0].length; continue; }
    const index = /^\[(0|[1-9]\d*)\]/.exec(rest);
    if (index) {
      const n = Number(index[1]);
      if (!Number.isSafeInteger(n)) return undefined;
      parts.push(n); at += index[0].length; continue;
    }
    const quoted = /^\[("(?:[^"\\]|\\.)*")\]/.exec(rest);
    if (!quoted) return undefined;
    try { parts.push(JSON.parse(quoted[1]!) as string); }
    catch { return undefined; }
    at += quoted[0].length;
  }
  return parts;
}

function list(items: JsonValue[]): JsonValue {
  return { kind: "array", items, line: 1, column: 1 };
}

/**
 * The parsed value a readable-view path names, or undefined for a stale, unknown or malformed path.
 * Duplicate keys select the first occurrence. A table row path selects the whole record.
 * JSON expanded inside a string still selects that string at its own path; its displayed children
 * are not paths into the parsed file and return undefined. Text has no parsed values.
 * YAML requires `await prepare("yaml")`, just as toReadable does, and throws if unprepared.
 * CSV takes its delimiter from `fileName` as toReadable does: a tab for `.tsv`, else a comma.
 * JSON Lines keeps bad records' indices: those records, and a root containing any, are undefined.
 */
export function valueAt(text: string, kind: DataKind, path: string, fileName = ""): JsonValue | undefined {
  const parts = pathParts(path);
  if (!parts || kind === "text" || kind === "html") return undefined;
  let value: JsonValue | undefined;
  switch (kind) {
    case "json": value = parseJson(text).value ?? parseJson(text, true).value; break;
    case "jsonl": {
      const records = text.split(/\r\n|\r|\n/)
        .flatMap((source, index) => /[^ \t\r\n]/.test(source) ? [parseJson(source, false, index)] : []);
      if (typeof parts[0] === "number") value = records[parts.shift() as number]?.value;
      else if (parts.length === 0 && records.every(record => record.value !== undefined)) {
        value = list(records.map(record => record.value!));
      }
      break;
    }
    case "yaml": {
      const result = parseYaml(text);
      // Documents past the compose cap are unread: a root list of them would claim to be all.
      if (!result.invalid) value = result.values.length === 1 ? result.values[0] : result.unread && !parts.length ? undefined : list(result.values);
      break;
    }
    case "toml": value = parseToml(text).value; break;
    case "csv": value = parseCsv(text, /\.tsv$/i.test(fileName) ? "\t" : ",").value; break;
  }
  for (const part of parts) {
    if (typeof part === "number") value = value?.kind === "array" ? value.items[part] : undefined;
    else value = value?.kind === "object" ? value.entries.find(entry => entry.key === part)?.value : undefined;
    if (value === undefined) return undefined;
  }
  return value;
}

/** Scalars retain their source spelling, except strings are decoded and unquoted; containers use JSON. */
export function copyValue(value: JsonValue): string {
  if (value.kind === "string") return value.value;
  if (value.kind === "number" || value.kind === "literal") return value.raw;
  return subtreeJson(value);
}

/**
 * Pretty JSON with 2-space indentation, preserving key order, duplicate keys and JSON number lexemes.
 * Duplicate-key output is not strict JSON. Non-JSON scalars (including non-JSON numeric spellings)
 * become JSON strings of their source text, so every scalar/collection remains JSON.parse-compatible.
 */
export function subtreeJson(value: JsonValue): string {
  function render(node: JsonValue, depth: number): string {
    const indent = "  ".repeat(depth);
    const childIndent = indent + "  ";
    switch (node.kind) {
      case "object": return node.entries.length
        ? `{\n${node.entries.map(entry => `${childIndent}${JSON.stringify(entry.key)}: ${render(entry.value, depth + 1)}`).join(",\n")}\n${indent}}`
        : "{}";
      case "array": return node.items.length
        ? `[\n${node.items.map(item => childIndent + render(item, depth + 1)).join(",\n")}\n${indent}]`
        : "[]";
      case "string": return JSON.stringify(node.value);
      case "number": return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(node.raw) ? node.raw : JSON.stringify(node.raw);
      case "literal": return /^(?:true|false|null)$/.test(node.raw) ? node.raw : JSON.stringify(node.raw);
    }
  }
  return render(value, 0);
}

/**
 * Both spellings of a path into the PARSED data, for YAML, TOML and CSV as much as JSON;
 * this is not a position in the file. CSV `$[n].column` names row n (0-based, header excluded).
 * JSON Lines jq paths index the slurped array (`jq -s`), which jq can only build when every line
 * parses. A multi-document YAML file also indexes a list of documents (`$[n]`), but jq reads YAML
 * only through a converter, so no slurp flag is claimed for it (`jqSlurp` is false).
 * jsonPath retains the given normalised readable-view path. Throws for malformed paths.
 */
export function pathForms(path: string, kind: DataKind): { jsonPath: string; jq: string; jqSlurp: boolean } {
  const parts = pathParts(path);
  if (!parts) throw new Error("Malformed readable-view path");
  let jq = ".";
  for (const part of parts) {
    if (typeof part === "number") jq += `[${part}]`;
    // `.a.b`, `.a["odd key"]`, `.["odd"]`: bracket form without a leading dot after a key, which
    // every jq version accepts (`.a.["k"]` needs jq 1.7).
    else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) jq += (jq === "." ? "" : ".") + part;
    else jq += `[${JSON.stringify(part)}]`;
  }
  return { jsonPath: path, jq, jqSlurp: kind === "jsonl" };
}
