import { cellText, fence } from "./escape";
import type { JsonValue, ParseResult } from "./json";
import { childPath, count, hint, type Lens } from "./lens";

type ObjectValue = Extract<JsonValue, { kind: "object" }>;
type ArrayValue = Extract<JsonValue, { kind: "array" }>;
export interface ConversationRecord { parsed: ParseResult; source: string; line: number }

function member(value: JsonValue | undefined, key: string): JsonValue | undefined {
  if (value?.kind !== "object") return undefined;
  const entries = value.entries.filter(e => e.key === key);
  // Ambiguous duplicate discriminators belong to the lossless generic lens.
  return entries.length === 1 ? entries[0]!.value : undefined;
}

function string(value: JsonValue | undefined): string | undefined {
  return value?.kind === "string" ? value.value : undefined;
}

function message(value: JsonValue | undefined): ObjectValue | undefined {
  if (value?.kind !== "object" || member(value, "role")?.kind !== "string") return undefined;
  const content = member(value, "content");
  return content?.kind === "string" || (content?.kind === "array" && content.items.every(part =>
    part.kind === "object" && member(part, "type")?.kind === "string")) ? value : undefined;
}

function turn(value: JsonValue | undefined): ObjectValue | undefined {
  return message(value) ?? message(member(value, "message"));
}

export function isConversation(records: readonly (JsonValue | undefined)[]): boolean {
  const matches = records.filter(v => turn(v)).length;
  return matches >= 2 && matches * 5 >= records.length * 3;
}

/** Only top-level lists or a request's unambiguous messages member qualify. */
export function conversationList(value: JsonValue): ArrayValue | undefined {
  const list = value.kind === "array" ? value : member(value, "messages");
  return list?.kind === "array" && isConversation(list.items) ? list : undefined;
}

function clip(text: string): string {
  const chars = Array.from(text);
  return chars.length > 80 ? chars.slice(0, 80).join("") + "…" : text;
}

function firstString(value: JsonValue | undefined): string | undefined {
  if (!value) return undefined;
  if (value.kind === "string") return value.value;
  // A content block's `type` names the block, not its content; its `text` is the content.
  const text = member(value, "text");
  if (text?.kind === "string") return text.value;
  const children = value.kind === "object" ? value.entries.filter(e => e.key !== "type").map(e => e.value)
    : value.kind === "array" ? value.items : [];
  for (const child of children) {
    if (child.kind === "string") return child.value;
    const found = firstString(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Raw HTML blocks do not interpret Markdown backslash escapes. Keep D1's escaping,
 * expressing its escaped punctuation as HTML character references in this context. */
function summaryText(text: string): string {
  return cellText(text).replace(/\\([!-/:-@[-`{-~])/g, (_, c: string) => `&#${c.charCodeAt(0)};`);
}

function details(lens: Lens, label: string, path: string, body: () => void): void {
  lens.line(`<details><summary>${summaryText(label)}</summary>`, path); lens.line();
  body();
  lens.line("</details>"); lens.line();
}

/** Render unconsumed members without synthesising (and charging) an extra object. */
function metadata(lens: Lens, value: ObjectValue, path: string, used: readonly string[]): void {
  const entries = value.entries.filter(e => !used.includes(e.key));
  if (!entries.length || lens.truncated) return;
  details(lens, "Metadata", path, () => {
    lens.renderMembers({ ...value, entries }, path);
  });
}

function timestamp(record: JsonValue | undefined): JsonValue | undefined {
  return member(record, "timestamp") ?? member(turn(record), "timestamp");
}

function time(lens: Lens, value: JsonValue | undefined): string {
  if (!value) return "";
  return hint(value, "timestamp", lens.timeZone) || (value.kind === "string" ? value.value : value.kind === "number" ? value.raw : "");
}

function total(values: string[]): string {
  if (values.length === 1) return values[0]!;
  if (values.every(v => /^-?\d+$/.test(v))) return values.reduce((n, v) => n + BigInt(v), 0n).toString();
  return String(values.reduce((n, v) => n + Number(v), 0));
}

export function conversationOverview(lens: Lens, records: readonly (JsonValue | undefined)[]): void {
  const roles = new Map<string, number>();
  const tools = new Map<string, number>();
  const stamps: JsonValue[] = [];
  const tokens = { input_tokens: [] as string[], output_tokens: [] as string[] };
  for (const record of records) {
    const msg = turn(record);
    if (msg) {
      const role = string(member(msg, "role"))!;
      roles.set(role, (roles.get(role) ?? 0) + 1);
      const content = member(msg, "content");
      if (content?.kind === "array") for (const part of content.items) {
        if (string(member(part, "type")) !== "tool_use") continue;
        const name = string(member(part, "name")) ?? "(unnamed)";
        tools.set(name, (tools.get(name) ?? 0) + 1);
      }
    }
    const stamp = timestamp(record);
    if (stamp) stamps.push(stamp);
    for (const holder of record === msg ? [record] : [record, msg]) {
      const usage = member(holder, "usage");
      if (usage?.kind !== "object") continue;
      for (const entry of usage.entries) {
        if ((entry.key === "input_tokens" || entry.key === "output_tokens") && entry.value.kind === "number") {
          tokens[entry.key].push(entry.value.raw);
        }
      }
    }
  }
  const facts = [`${count([...roles.values()].reduce((a, b) => a + b, 0), "turn")}: ${[...roles].map(([role, n]) => `${n} ${cellText(role)}`).join(", ")}`];
  if (tools.size) facts.push(`tool calls: ${[...tools].map(([name, n]) => `${cellText(name)} ${n}`).join(", ")}`);
  // Format only what the span shows: the first and last readable timestamps, not every record's.
  let first = "";
  for (const stamp of stamps) { first = time(lens, stamp); if (first) break; }
  let last = "";
  for (let i = stamps.length - 1; i >= 0 && first && !last; i--) last = time(lens, stamps[i]!);
  if (first && last) facts.push(`time span: ${cellText(first)} – ${cellText(last)}`);
  const totals = Object.entries(tokens).filter(([, values]) => values.length).map(([name, values]) => `${cellText(name)}: ${cellText(total(values))}`);
  if (totals.length) facts.push(`tokens: ${totals.join(", ")}`);
  // One fact per visual line: the layout's own break, since soft line breaks would run them together.
  facts.forEach((fact, i) => lens.line(i < facts.length - 1 ? `${fact}<br>` : fact));
  lens.line();
}

function part(lens: Lens, value: JsonValue, path: string): void {
  const type = string(member(value, "type"));
  if (value.kind !== "object" || !["text", "tool_use", "tool_result", "thinking", "image"].includes(type ?? "")) {
    details(lens, "Content part (not understood)", path, () => lens.renderLiteral(value, path));
    return;
  }
  const field = type === "text" ? "text" : type === "tool_use" ? "input" : type === "tool_result" ? "content" : "thinking";
  const body = member(value, field);
  if (type !== "image" && !body) {
    details(lens, "Content part (not understood)", path, () => lens.renderLiteral(value, path));
    return;
  }
  if (!lens.take()) return; // part object
  // The type is represented by the layout; the name is also retained as metadata.
  if (!lens.take()) return;
  if (type === "image") {
    const source = member(value, "source");
    const media = string(member(value, "media_type")) ?? string(member(source, "media_type"));
    // Only the encoded image data is withheld, and the view says how much; every other field
    // (a URL, cache settings) stays visible as metadata.
    // Every `data` entry is withheld (duplicates included), charged and counted in the label.
    const hidden = [...(source?.kind === "object" ? source.entries : []), ...(value.kind === "object" ? value.entries : [])]
      .filter(e => e.key === "data").map(e => e.value);
    const chars = hidden.reduce((n, v) => n + (v.kind === "string" ? v.value.length : 0), 0);
    const size = hidden.length ? `, data not shown${chars ? ` (${count(chars, "character")})` : ""}` : "";
    if (hidden.length && !lens.take(hidden.reduce((n, v) => n + lens.count(v), 0))) return;
    lens.line(cellText(`Image${media ? ` (${media})` : ""}`) + cellText(size), path); lens.line();
    if (source?.kind === "object") {
      if (!lens.take()) return; // the source object
      metadata(lens, source, childPath(path, "source"), ["data"]);
      metadata(lens, value, path, ["type", "source", "data"]);
    } else metadata(lens, value, path, ["type", "data"]);
    return;
  }
  if (type === "text") {
    // The existing prose-string renderer owns Markdown, blockquotes and empty strings.
    if (body!.kind === "string") lens.renderProse(body!, childPath(path, field));
    else lens.renderLiteral(body!, childPath(path, field));
  } else {
    const name = string(member(value, "name")) ?? "(unnamed)";
    const first = firstString(body) ?? "";
    const label = type === "tool_use" ? `Tool call: ${name} · ${clip(first.replace(/\r\n|\r|\n/g, " "))}`
      : type === "tool_result" ? `Tool result${string(member(value, "name")) !== undefined ? `: ${name}` : ""} · ${clip(first.split(/\r\n|\r|\n/, 1)[0]!)}`
      : `Thinking · ${count(string(body)?.length ?? 0, "character")}`;
    details(lens, label, path, () => {
      if (body!.kind === "string") {
        if (lens.take(lens.count(body!))) { lens.line(fence(body!.value), childPath(path, field)); lens.line(); }
      } else lens.renderLiteral(body!, childPath(path, field));
      metadata(lens, value, path, ["type", field]);
    });
    return;
  }
  metadata(lens, value, path, ["type", field]);
}

export function conversationRecord(lens: Lens, value: JsonValue | undefined, path: string, index: number, bad?: ConversationRecord): void {
  const msg = turn(value);
  if (!msg) {
    details(lens, `Record ${index + 1} (not a message)`, path, () => {
      if (value) lens.renderLiteral(value, path);
      else if (bad && bad.parsed.problem) {
        const p = bad.parsed.problem;
        lens.line(`Line ${p.line}, column ${p.column}: ${cellText(p.message)}`); lens.line();
        lens.line(fence(bad.source), path); lens.line();
      }
    });
    return;
  }
  if (!lens.take()) return; // record object
  const wrapped = msg !== value;
  if (wrapped && !lens.take()) return; // message object
  if (!lens.take()) return; // role
  const role = string(member(msg, "role"))!;
  const stamp = time(lens, timestamp(value));
  const content = member(msg, "content")!;
  const toolOnly = content.kind === "array" && content.items.length > 0
    && content.items.every(p => string(member(p, "type")) === "tool_result");
  const label = toolOnly ? `Tool result (${role})` : role.charAt(0).toUpperCase() + role.slice(1);
  lens.line(`## ${cellText(label)}${stamp ? ` · ${cellText(stamp)}` : ""}`, path); lens.line();
  const msgPath = wrapped ? childPath(path, "message") : path;
  const contentPath = childPath(msgPath, "content");
  if (content.kind === "array") {
    if (lens.take()) {
      if (!content.items.length) { lens.line(cellText("[]"), contentPath); lens.line(); }
      for (const [i, item] of content.items.entries()) {
        if (lens.truncated) break;
        part(lens, item, `${contentPath}[${i}]`);
      }
    }
  } else if (content.kind === "string") lens.renderProse(content, contentPath);
  metadata(lens, msg, msgPath, ["role", "content"]);
  if (wrapped) metadata(lens, value as ObjectValue, path, ["message"]);
}

export function renderConversation(lens: Lens, root: JsonValue, list: ArrayValue): void {
  conversationOverview(lens, list.items);
  if (!lens.take()) return; // root
  const path = root === list ? "$" : "$.messages";
  if (root !== list && root.kind === "object") {
    // Request parameters precede the turns, even if messages was the first member.
    const entries = root.entries.filter(e => e.key !== "messages");
    if (entries.length) lens.renderMembers({ ...root, entries }, "$", 2);
    if (!lens.take()) return; // messages list
  }
  for (const [i, value] of list.items.entries()) {
    if (lens.truncated) break;
    conversationRecord(lens, value, `${path}[${i}]`, i);
  }
}
