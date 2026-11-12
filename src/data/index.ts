import { cellText, fence } from "./escape";
import { conversationList, conversationOverview, conversationRecord, isConversation, renderConversation } from "./conversation";
import { parseJson, type ParseResult } from "./json";
import { budget, count, Lens, shape, type TableRow } from "./lens";
import { parseCsv } from "./csv";
import { parseToml } from "./toml";
import { parseYaml, prepareYaml } from "./yaml";
import type { DataKind, Problem, Readable, ReadableOptions } from "./types";
export type { DataKind, Problem, Readable, ReadableOptions } from "./types";
export { valueAt, copyValue, subtreeJson, pathForms } from "./copy";

/** Load optional readers before the synchronous conversion seam is used. */
export function prepare(kind: DataKind): Promise<void> {
  return kind === "yaml" ? prepareYaml() : Promise.resolve();
}

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
    return structured(text, kind, options, lens);
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
    const conversation = isConversation(records.map(r => r.parsed.value));
    lens.line(`JSON Lines · ${size(text)} · ${count(recordsTotal, "record")}${!conversation && problems.length ? `, ${problems.length.toLocaleString("en-US")} not valid JSON` : ""}`); lens.line();
    if (conversation) conversationOverview(lens, records.map(r => r.parsed.value));
    const maxRecords = budget(options.maxRecords, 500);
    const valid = records.flatMap(r => r.parsed.value ? [r.parsed.value] : []);
    const table = conversation ? undefined : lens.recordTable(valid);
    const names = new Set(table?.columns.map(c => c.name));
    const lineColumn = names.has("line") ? names.has("#") ? undefined : "#" : "line";
    const badRecord = (record: typeof records[number], index: number): void => {
      lens.line(`## Record ${index + 1} (line ${record.line})`, `$[${index}]`); lens.line();
      if (record.parsed.problem) {
        const p = record.parsed.problem;
        lens.line(`Line ${p.line}, column ${p.column}: ${cellText(p.message)}`); lens.line();
        lens.line(fence(record.source)); lens.line();
      }
    };
    if (table && lineColumn) {
      const rows: TableRow[] = [];
      const bad: { record: typeof records[number]; index: number }[] = [];
      for (const [index, record] of records.entries()) {
        if (recordsShown >= maxRecords || lens.truncated) break;
        if (record.parsed.value) {
          if (!lens.take(lens.count(record.parsed.value))) break;
          rows.push({ value: record.parsed.value, path: `$[${index}]`, line: record.line });
        } else bad.push({ record, index });
        recordsShown++;
      }
      lens.renderTable(rows, table, "$", 2, "", lineColumn, true);
      for (const { record, index } of bad) badRecord(record, index);
    } else for (const [index, record] of records.entries()) {
      if (recordsShown >= maxRecords || lens.truncated) break;
      if (lens.shown >= budget(options.maxValues, 20000) && record.parsed.value) { lens.truncated = true; break; }
      recordsShown++;
      if (conversation) {
        conversationRecord(lens, record.parsed.value, `$[${index}]`, index, record);
        continue;
      }
      if (record.parsed.value) {
        lens.line(`## Record ${index + 1} (line ${record.line})`, `$[${index}]`); lens.line();
        lens.render(record.parsed.value, `$[${index}]`, 3);
      } else badRecord(record, index);
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
    // A loop, not a spread: a hostile file can carry more problems than a call has arguments.
    for (const p of lens.problems) problems.push(p);
    lens.line(); lens.line("## Expansion problems", "$"); lens.line();
    for (const line of problemLines(lens.problems)) lens.line(`- ${line}`, "$");
  }
  return { markdown: lens.finish(), problems, truncated: lens.truncated, map: lens.map };
}

/** At most 100 problems are listed; the rest are counted (the full list stays in `problems`). */
function problemLines(problems: readonly Problem[]): string[] {
  const lines = problems.slice(0, 100).map(p => `Line ${p.line}, column ${p.column}: ${cellText(p.message)}`);
  if (problems.length > 100) lines.push(`And ${count(problems.length - 100, "more problem")}.`);
  return lines;
}

function structured(text: string, kind: "yaml" | "toml" | "csv", options: ReadableOptions, lens: Lens): Readable {
  let problems: Problem[];
  const format = kind === "csv" && /\.tsv$/i.test(options.fileName ?? "") ? "TSV" : kind.toUpperCase();
  let invalid = false;
  const render = (value: import("./json").JsonValue, path = "$", level = 2): void => {
    const conversation = conversationList(value);
    if (conversation) renderConversation(lens, value, conversation);
    else lens.render(value, path, level);
  };
  if (kind === "csv") {
    lens.csv = true;
    const csv = parseCsv(text, format === "TSV" ? "\t" : ",");
    problems = csv.problems;
    lens.line(`${format} · ${size(text)} · ${count(csv.value.items.length, "row")}, ${count(csv.columns, "column")}`); lens.line();
    // A header with no rows (a template) still names its columns.
    if (!csv.value.items.length && csv.keys.length) { lens.line(`Columns: ${csv.keys.map(cellText).join(", ")}`, "$"); lens.line(); }
    lens.total = lens.count(csv.value);
    // Charge whole rows to the values budget, including their containers and cells. No 500-row cap.
    let cost = 1, shown = 0;
    const max = budget(options.maxValues, 20000);
    for (const row of csv.value.items) {
      cost += lens.count(row);
      if (cost > max) break;
      shown++;
    }
    render({ ...csv.value, items: csv.value.items.slice(0, shown) });
    if (shown < csv.value.items.length) {
      lens.truncated = true;
      lens.line(`Showing ${shown.toLocaleString("en-US")} of ${csv.value.items.length.toLocaleString("en-US")} rows.`); lens.line();
    }
  } else {
    const result = kind === "yaml" ? parseYaml(text) : (() => {
      const parsed = parseToml(text);
      return { values: parsed.value ? [parsed.value] : [], problems: parsed.problem ? [parsed.problem] : [], invalid: !parsed.value };
    })();
    problems = result.problems;
    invalid = result.invalid;
    const values = result.values;
    lens.line(`${format} · ${size(text)} · ${invalid ? "invalid document" : values.length > 1 ? count(values.length, "document") : cellText(shape(values[0]!))}`); lens.line();
    if (invalid) {
      for (const line of problemLines(problems)) { lens.line(line); lens.line(); }
      lens.line(fence(text));
    } else {
      lens.total = values.reduce((n, value) => n + lens.count(value), 0);
      if (values.length === 1) render(values[0]!);
      else {
        const conversation = isConversation(values);
        if (conversation) conversationOverview(lens, values);
        let shown = 0;
        for (const [index, value] of values.entries()) {
          if (shown >= budget(options.maxRecords, 500) || lens.truncated) break;
          if (lens.shown >= budget(options.maxValues, 20000)) { lens.truncated = true; break; }
          shown++;
          if (conversation) conversationRecord(lens, value, `$[${index}]`, index, { parsed: { value }, source: "", line: value.line });
          else {
            lens.line(`## Document ${index + 1} (line ${value.line})`, `$[${index}]`); lens.line();
            render(value, `$[${index}]`, 3);
          }
        }
        if (shown < values.length) {
          lens.truncated = true;
          lens.line(`Showing ${shown.toLocaleString("en-US")} of ${values.length.toLocaleString("en-US")} documents.`); lens.line();
        }
      }
      if (lens.shown < lens.total) {
        lens.truncated = true;
        lens.line(`Showing ${lens.shown.toLocaleString("en-US")} of ${lens.total.toLocaleString("en-US")} values.`);
      }
    }
  }
  if (!invalid && (problems.length || lens.problems.length)) {
    for (const p of lens.problems) problems.push(p);
    lens.line(); lens.line("## Problems", "$"); lens.line();
    for (const line of problemLines(problems)) lens.line(`- ${line}`, "$");
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
