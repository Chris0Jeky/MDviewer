import { cellText, fence } from "./escape";
import { conversationList, conversationOverview, conversationRecord, isConversation, renderConversation } from "./conversation";
import { parseJson, type ParseResult } from "./json";
import { budget, count, Lens, shape } from "./lens";
import type { DataKind, Problem, Readable, ReadableOptions } from "./types";
export type { DataKind, Problem, Readable, ReadableOptions } from "./types";

export function dataKindOf(fileName: string): DataKind | null {
  const extension = /\.([^.\\/]+)$/.exec(fileName)?.[1]?.toLowerCase();
  switch (extension) {
    case "json": case "jsonc": return "json";
    case "jsonl": case "ndjson": return "jsonl";
    case "yaml": case "yml": return "yaml";
    case "toml": return "toml";
    case "csv": case "tsv": return "csv";
    case "txt": case "log": return "text";
    default: return null;
  }
}

/** UTF-8 byte count without DOM APIs, including replacement encoding of lone surrogates. */
function size(text: string): string {
  let bytes = 0;
  for (const c of text) {
    const cp = c.codePointAt(0)!;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes < 1000 ? `${bytes} B` : bytes < 1e6 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

export function toReadable(text: string, kind: DataKind, options: ReadableOptions = {}): Readable {
  const lens = new Lens(options);
  const problems: Problem[] = [];
  lens.line(`# ${cellText(options.fileName ?? "Data")}`, "$");
  if (kind === "text") return plainText(text, options, lens);
  if (kind !== "json" && kind !== "jsonl") {
    const message = `${kind.toUpperCase()} is not supported yet.`;
    problems.push({ message, line: 1, column: 1 });
    lens.line(`${kind.toUpperCase()} · ${size(text)}`); lens.line(); lens.line(message);
    return { markdown: lens.finish(), problems, truncated: false, map: lens.map };
  }
  let recordsShown = 0;
  let recordsTotal = 0;
  if (kind === "json") {
    const strict = parseJson(text);
    const parsed = strict.value ? strict : parseJson(text, true);
    if (parsed.value) {
      lens.line(`JSON · ${size(text)} · ${shape(parsed.value)}`); lens.line();
      if (!strict.value) { lens.line("Parsed as JSON with comments and trailing commas."); lens.line(); }
      lens.total = lens.count(parsed.value);
      const conversation = conversationList(parsed.value);
      if (conversation) renderConversation(lens, parsed.value, conversation);
      else lens.render(parsed.value);
    } else {
      lens.line(`JSON · ${size(text)} · invalid document`); lens.line();
      // Report the tolerant parser's first error: it can get past valid JSONC prefixes.
      problems.push(parsed.problem);
      lens.line(`Line ${parsed.problem.line}, column ${parsed.problem.column}: ${cellText(parsed.problem.message)}`);
      lens.line(); lens.line(fence(text));
    }
  } else {
    const records: { parsed: ParseResult; source: string; line: number }[] = [];
    for (const [index, source] of text.split(/\r\n|\r|\n/).entries()) {
      // Blank means JSON whitespace only; any other character is a record (possibly a bad one).
      if (/[^ \t\r\n]/.test(source)) records.push({ parsed: parseJson(source, false, index), source, line: index + 1 });
    }
    recordsTotal = records.length;
    for (const record of records) {
      if (record.parsed.value) lens.total += lens.count(record.parsed.value);
      else problems.push(record.parsed.problem);
    }
    lens.line(`JSON Lines · ${size(text)} · ${count(recordsTotal, "record")}`); lens.line();
    const conversation = isConversation(records.map(r => r.parsed.value));
    if (conversation) conversationOverview(lens, records.map(r => r.parsed.value));
    const maxRecords = budget(options.maxRecords, 500);
    for (const [index, record] of records.entries()) {
      if (recordsShown >= maxRecords || lens.truncated) break;
      if (lens.shown >= budget(options.maxValues, 20000) && record.parsed.value) { lens.truncated = true; break; }
      recordsShown++;
      if (conversation) {
        conversationRecord(lens, record.parsed.value, `$[${index}]`, index, record);
        continue;
      }
      lens.line(`## Record ${index + 1} (line ${record.line})`, `$[${index}]`); lens.line();
      if (record.parsed.value) lens.render(record.parsed.value, `$[${index}]`, 3);
      else {
        const p = record.parsed.problem;
        lens.line(`Line ${p.line}, column ${p.column}: ${cellText(p.message)}`); lens.line();
        lens.line(fence(record.source)); lens.line();
      }
    }
    if (recordsShown < recordsTotal) {
      lens.truncated = true;
      lens.line(`Showing ${recordsShown.toLocaleString("en-US")} of ${recordsTotal.toLocaleString("en-US")} records.`); lens.line();
    }
    // Bad lines remain discoverable even beyond the record display budget.
    if (problems.length) {
      lens.line("## Problems", "$"); lens.line();
      for (const p of problems.slice(0, 100)) lens.line(`- Line ${p.line}, column ${p.column}: ${cellText(p.message)}`, "$");
      if (problems.length > 100) lens.line(`- And ${count(problems.length - 100, "more problem")}.`, "$");
      lens.line();
    }
  }
  if (lens.shown < lens.total && (kind === "json" || recordsShown === recordsTotal || lens.truncated)) {
    lens.truncated = true;
    lens.line(`Showing ${lens.shown.toLocaleString("en-US")} of ${lens.total.toLocaleString("en-US")} values.`);
  }
  if (lens.problems.length) {
    problems.push(...lens.problems);
    lens.line(); lens.line("## Expansion problems", "$"); lens.line();
    for (const p of lens.problems) lens.line(`- Line ${p.line}, column ${p.column}: ${cellText(p.message)}`, "$");
  }
  return { markdown: lens.finish(), problems, truncated: lens.truncated, map: lens.map };
}

/**
 * Plain text is never interpreted: it is set as one fenced block with no info string, which
 * Markdown leaves literal (no escaping needed) and which keeps every line break, blank line and
 * space exactly. The app's code blocks wrap and paginate (Tier 4 splits a long one).
 */
function plainText(text: string, options: ReadableOptions, lens: Lens): Readable {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop(); // a final line break ends the last line
  const max = budget(options.maxLines, 20000);
  const shown = lines.slice(0, max);
  lens.line(`Plain text · ${size(text)} · ${count(lines.length, "line")}`); lens.line();
  lens.line(fence(shown.join("\n")), "line 1");
  const truncated = shown.length < lines.length;
  if (truncated) { lens.line(); lens.line(`Showing ${shown.length.toLocaleString("en-US")} of ${lines.length.toLocaleString("en-US")} lines.`); }
  return { markdown: lens.finish(), problems: [], truncated, map: lens.map };
}
