import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dataKindOf, prepare, toReadable } from "../src/data";
import { parseJson } from "../src/data/json";
import { escapeText } from "../src/data/escape";
import { cellText } from "../src/data/escape";

const fixtures = resolve("tests/fixtures/data");
const read = (name: string): string => readFileSync(`${fixtures}/${name}`, "utf8");

describe("readable data fixtures", () => {
  for (const name of readdirSync(fixtures).filter(n => !n.endsWith(".md"))) {
    it(name, async () => {
      const qualified = `${name}.readable.md`;
      const expected = readdirSync(fixtures).includes(qualified) ? qualified : name.replace(/\.[^.]+$/, ".readable.md");
      const options = name === "budget.json" ? { maxValues: 5 } : name === "records-budget.jsonl" ? { maxRecords: 2 } : {};
      const kind = dataKindOf(name)!;
      await prepare(kind);
      const view = toReadable(read(name), kind, { fileName: name, timeZone: "UTC", ...options });
      expect(view.markdown).toBe(read(expected));
    });
  }
});

describe("dataKindOf", () => {
  it.each([
    ["x.json", "json"], ["x.JSONC", "json"], ["x.jsonl", "jsonl"], ["x.NDJSON", "jsonl"],
    ["x.yaml", "yaml"], ["x.YML", "yaml"], ["x.toml", "toml"], ["x.csv", "csv"], ["x.TSV", "csv"], ["notes.txt", "text"], ["server.LOG", "text"], ["page.html", "html"], ["OLD.HTM", "html"],
    ["json", null], ["x.md", null], ["x.json.bak", null], ["folder.json/no-extension", null], ["x.json?x", null],
  ])("%s -> %s", (name, kind) => expect(dataKindOf(name!)).toBe(kind));
});

describe("source-preserving JSON", () => {
  it("keeps numeric source text and duplicate keys in source order", () => {
    const result = toReadable('{"n":1234567890123456789,"n":1.0,"n":-0.50e+3}', "json");
    // Punctuation is escaped in Markdown; stripping those escapes recovers the exact lexemes.
    const text = result.markdown.replace(/\\([!-/:-@[-`{-~])/g, "$1");
    expect(text).toContain("1234567890123456789");
    expect(text).toContain("1.0");
    expect(text).toContain("-0.50e+3");
    expect(text.match(/\| n \|/g)).toHaveLength(3);
    expect(text.indexOf("1234567890123456789")).toBeLessThan(text.indexOf("1.0"));
  });

  it("reports the first error with a 1-based source location and includes raw input", () => {
    const result = toReadable('{\n  "a": 1\n  "b": 2\n}', "json");
    expect(result.problems).toEqual([{ message: "Expected ',' or '}' after a value", line: 3, column: 3 }]);
    expect(result.markdown).toContain('  "b": 2');
    expect(result.truncated).toBe(false);
  });

  it("records every value's source position and decodes escapes", () => {
    const result = parseJson('{\r\n "k": ["a\\n\\u263a", 1.0]}');
    expect(result.value).toMatchObject({ kind: "object", line: 1, column: 1, entries: [{
      key: "k", value: { kind: "array", line: 2, column: 7, items: [
        { kind: "string", value: "a\n☺", line: 2, column: 8 }, { kind: "number", raw: "1.0", line: 2, column: 21 },
      ] },
    }] });
  });

  it.each(['{"x":01}', '{"x":1.}', '{"x":1e}', '{"x":+2}', '[1,,2]', '"\\q"', '"\\uZZZZ"', '"raw\nnewline"', 'true false', '/* open'])("rejects malformed input %s without throwing", text => {
      expect(toReadable(text, "json").problems).toHaveLength(1);
    });

  it("uses the tolerant fallback only when strict JSON fails", () => {
    expect(toReadable('{"a":1}', "json", { fileName: "x.jsonc" }).markdown).not.toContain("Parsed as");
    const result = toReadable('{/* note */"a":1,}', "json");
    expect(result.problems).toEqual([]);
    expect(result.markdown).toContain("Parsed as JSON with comments and trailing commas.");
    expect(parseJson('[1,]').problem).toBeDefined();
    expect(parseJson('[1,]', true).value).toBeDefined();
  });

  it("guards nesting depth without overflowing, including the accepted boundary", () => {
    expect(parseJson("[".repeat(512) + "0" + "]".repeat(512)).problem).toBeUndefined();
    const result = toReadable("[".repeat(514) + "0" + "]".repeat(514), "json");
    expect(result.problems[0]).toEqual({ message: "JSON nesting exceeds the maximum depth of 512", line: 1, column: 514 });
    expect(toReadable("[".repeat(512) + "0" + "]".repeat(512), "json").problems).toEqual([]);
  });

  it("reports a combined depth guard for JSON in strings rather than silently omitting expansion", () => {
    const view = toReadable("[".repeat(512) + '"{}"' + "]".repeat(512), "json");
    expect(view.problems[0]?.message).toContain("maximum combined depth of 512");
    expect(view.markdown).toContain("## Expansion problems");
    // The array itself is deeper than the renderer can nest, so it is shown literally.
    expect(view.markdown).toContain('"{}"');
  });
});

describe("generic lens", () => {
  it("maps headings, table rows, and list items to paths", () => {
    const result = toReadable('{"odd key":{"a":1},"items":[0,1,2,3,4,5,6,7,8]}', "json");
    const lines = result.markdown.split("\n");
    const pathFor = (s: string): string | undefined => result.map.get(lines.indexOf(s) + 1);
    expect(pathFor("# Data")).toBe("$");
    expect(pathFor("| odd key | a: 1 |")).toBe('$["odd key"]');
    expect(pathFor("## items")).toBe("$.items");
    expect(pathFor("- 8")).toBe("$.items[8]");
    const table = toReadable('[{"a":1},{"b":2}]', "json");
    expect([...table.map.values()]).toContain("$[1]");
  });

  it("retains member order within the object table", () => {
    const md = toReadable('{"first":1,"nested":{"x":2},"last":3}', "json").markdown;
    expect(md.indexOf("| first")).toBeLessThan(md.indexOf("| nested | x: 2 |"));
    expect(md.indexOf("| nested")).toBeLessThan(md.indexOf("| last"));
  });

  it("uses first-seen table columns, missing cells, and short scalar lists", () => {
    const md = toReadable('[{"b":[1,2],"a":true},{"c":null,"b":[]}]', "json").markdown;
    expect(md).toContain("| b | a | c |\n| --- | --- | --- |");
    expect(md).toContain("| 1, 2 | true |  |");
    expect(md).toContain("| \\[\\] |  | null |");
  });

  it("keeps duplicate keys inside list records", () => {
    const md = toReadable('[{"a":1,"a":2}]', "json").markdown;
    expect(md).toContain("| a | 1 |\n| a | 2 |");
  });

  it("keeps the flat table and expands block values without charging them twice", () => {
    const view = toReadable('[{"description":"**Hello**\\nworld","payload":"{\\"a\\":1}","parts":["[2]"]}]', "json", { maxValues: 11 });
    expect(view.markdown).toContain("| description | payload | parts |");
    expect(view.markdown).toContain("> **Hello**");
    expect(view.markdown).toContain("| a | 1 |");
    expect(view.markdown).toContain("\\(JSON in a string\\)");
    expect(view.truncated).toBe(false);
  });

  it("uses nested lists past level four and labels non-flat records", () => {
    const md = toReadable('{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}', "json").markdown;
    expect(md).toContain("#### c\n\n- d\n\n  | Key");
    expect(md).not.toContain("#####");
    const list = toReadable('[{"id":7,"name":"A","nested":{"x":{"y":1}}},{"id":8,"nested":{"x":{"y":1}}}]', "json").markdown;
    expect(list).toContain("## A");
    expect(list).toContain("## 8");
  });

  it("shows every empty value explicitly", () => {
    for (const text of ["{}", "[]", '""', "null"]) {
      expect(toReadable(text, "json").markdown).toContain(escapeText(text));
    }
    expect(toReadable('{"description":""}', "json").markdown).toContain("empty string");
  });

  it("uses a fence longer than any backtick run inside code-like strings", () => {
    const md = toReadable(JSON.stringify({ script: "const x = `a`;\nconst y = ````;" }), "json").markdown;
    expect(md).toContain("`````\nconst x = `a`;\nconst y = ````;\n`````");
  });

  it("bounds values, keeps the whole-file overview, and makes partial lists useful", () => {
    const view = toReadable('[0,1,2,3]', "json", { maxValues: 3 });
    expect(view.truncated).toBe(true);
    expect(view.markdown).toContain("list of 4 items");
    expect(view.markdown).toContain("- 0\n- 1");
    expect(view.markdown).toContain("Showing 3 of 5 values.");
    expect(toReadable("1", "json", { maxValues: 0 }).markdown).toContain("Showing 0 of 1 values.");
  });

  it("uses the default 20,000-value budget", () => {
    const view = toReadable(JSON.stringify(Array.from({ length: 20002 }, () => 0)), "json");
    expect(view.truncated).toBe(true);
    expect(view.markdown).toContain("Showing 20,000 of 20,003 values.");
  });

  it("caps JSON Lines at 500 records and counts blank and bad lines correctly", () => {
    const view = toReadable(Array.from({ length: 1234 }, () => "0").join("\n"), "jsonl");
    expect(view.markdown).toContain("1,234 records");
    expect(view.markdown).toContain("Showing 500 of 1,234 records.");
    expect(view.truncated).toBe(true);
    const broken = toReadable('\n{"a":1}\r\n\n{"b":}\n{"c":3}', "jsonl");
    expect(broken.problems).toEqual([{ message: "Expected a JSON value", line: 4, column: 6 }]);
    expect(broken.markdown).toContain("| 2 | 1 |  |");
    expect(broken.markdown).toContain("| 5 |  | 3 |");
    expect(broken.markdown).toContain("- Line 4, column 6:");
    const cut = toReadable("0\nbad", "jsonl", { maxRecords: 1 });
    expect(cut.problems[0]?.line).toBe(2);
    expect(cut.markdown).toContain("- Line 2,");
  });

});


describe("plain text", () => {
  it("cuts at the line budget and says how much is shown", () => {
    const view = toReadable("a\nb\nc\n", "text", { maxLines: 2 });
    expect(view.truncated).toBe(true);
    expect(view.markdown).toContain("3 lines");
    expect(view.markdown).toContain("```\na\nb\n```");
    expect(view.markdown).toContain("Showing 2 of 3 lines.");
    expect(toReadable("one", "text").markdown).toContain("Plain text · 3 B · 1 line\n");
  });
});

describe("bounds and hints (review of #270)", () => {
  it("shows records instead of a table when keys are too many", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ [`k${i}`]: i }));
    const view = toReadable(JSON.stringify(items), "json");
    expect(view.markdown).not.toMatch(/^\| k0 \| k1 \|/m);
    expect(view.markdown).toContain("| k39 | 39 |");
  });

  it("fences text with very many backtick runs", () => {
    expect(() => toReadable("`a`".repeat(200_000), "text")).not.toThrow();
  });

  it("adds no shifted instant to a date without a time", () => {
    const view = toReadable('{"date":"2024-01-15","created_at":"2024-01-15T12:00:00Z"}', "json", { timeZone: "America/New_York" });
    expect(view.markdown).toContain("| date | 2024\\-01\\-15 |");
    expect(view.markdown).toContain("(2024\\-01\\-15 07\\:00 America\\/New\\_York)");
  });

  it("adds a duration hint only when the key names the unit", () => {
    const view = toReadable('{"durationMs":5000,"timeout_seconds":90,"duration":5}', "json", { timeZone: "UTC" });
    expect(view.markdown).toContain("| durationMs | 5000 (5 s) |");
    expect(view.markdown).toContain("| timeout\\_seconds | 90 (1\\.5 min) |");
    expect(view.markdown).toContain("| duration | 5 |");
  });

  it("lists at most 100 bad JSON Lines and counts the rest; whitespace-only lines are not blank", () => {
    const view = toReadable(Array.from({ length: 150 }, () => "x").join("\n"), "jsonl");
    expect(view.markdown).toContain("- And 50 more problems.");
    expect(view.problems).toHaveLength(150);
    expect(toReadable("{}\n\u00a0\n{}", "jsonl").problems).toHaveLength(1);
  });
});

describe("prepaid details (Codex on #270)", () => {
  it("shows the expanded detail a flat-table row already paid for, even when that spent the budget", () => {
    const view = toReadable(JSON.stringify([{ payload: JSON.stringify({ a: { b: 1 } }) }]), "json", { maxValues: 6 });
    expect(view.markdown).toContain("\\(JSON in a string\\)");
    expect(view.markdown).toContain("| a | b: 1 |");
    expect(view.truncated).toBe(false);
  });
});

describe("nested prepaid details (verification of #270)", () => {
  it("never reports a complete view while a value is missing, at every budget", () => {
    const payload = JSON.stringify({ items: [{ t: "a\nb" }], after: 1 });
    const text = JSON.stringify([{ payload }]);
    for (let maxValues = 1; maxValues <= 40; maxValues++) {
      const view = toReadable(text, "json", { maxValues });
      // Either the view says it was cut, or every value is in it.
      if (!view.truncated) expect(view.markdown, `maxValues ${maxValues}`).toMatch(/\| after \| 1 \|/);
    }
  });
});

describe("D6 readability rules", () => {
  const readable = (value: unknown, maxValues?: number) => toReadable(JSON.stringify(value), "json", { maxValues, timeZone: "UTC" });
  const plain = (md: string) => md.replace(/\\([!-/:-@[-`{-~])/g, "$1");

  it("G1 puts one ordered table before ordered sections, even in nested lists", () => {
    const object = { first: 1, nested: { x: { y: 2 } }, last: 3, other: { z: { w: 4 } } };
    for (const value of [object, { a: { b: { c: { d: object } } } }]) {
      const result = readable(value);
      const md = plain(result.markdown);
      expect(md.indexOf("| first | 1 |")).toBeLessThan(md.indexOf("| last | 3 |"));
      expect(md.indexOf("| last | 3 |")).toBeLessThan(md.indexOf(md.includes("## nested") ? "## nested" : "- nested"));
      const parent = [...result.map.values()].find(p => p.endsWith(".last"))!.slice(0, -5);
      const rows = result.markdown.split("\n");
      expect(result.map.get(rows.findIndex(s => s.includes("| last |")) + 1)).toBe(`${parent}.last`);
      expect(md.indexOf("nested")).toBeLessThan(md.indexOf("other"));
    }
  });

  it("G2 keeps row-sized values inline, disambiguates separators and omits compound hints", () => {
    const value = { list: ["a, b", "c · d", "e: f", "true"], obj: { a: "x: y", b: "1" }, description: "Short prose",
      empty: [], blank: {}, ms: [1000, 2000], created_at: [1700000000], sizes: { size: 2048 } };
    const md = plain(readable(value).markdown);
    expect(md).toContain('| list | "a, b", "c · d", "e: f", "true" |');
    expect(md).toContain('| obj | a: "x: y" · b: "1" |');
    expect(md).toContain("| description | Short prose |");
    expect(md).toContain("| empty | [] |");
    expect(md).toContain("| blank | {} |");
    expect(md).toContain("| ms | 1000, 2000 |");
    expect(md).toContain("| created_at | 1700000000 |");
    expect(md).toContain("| sizes | size: 2048 |");
    expect(md).not.toContain("## ");
  });

  it("G2 enforces item, member, text and block limits and charges complete inline values", () => {
    expect(plain(readable({ x: Array(8).fill(1) }).markdown)).toContain("| x | 1, 1");
    expect(readable({ x: Array(9).fill(1) }).markdown).toContain("## x");
    expect(readable({ x: { a: 1, b: 2, c: 3, d: 4 } }).markdown).not.toContain("## x");
    expect(readable({ x: { a: 1, b: 2, c: 3, d: 4, e: 5 } }).markdown).toContain("## x");
    for (const x of [["a".repeat(80)], { a: "a".repeat(77) }, ["# Heading"], { a: "first\nsecond" }]) {
      expect(readable({ x }).markdown).toContain("## x");
    }
    expect(readable({ description: "x".repeat(160) }).markdown).not.toContain("## description");
    expect(readable({ description: "x".repeat(161) }).markdown).toContain("## description");
    for (const x of [[1, 2], { a: 1, b: 2 }]) {
      expect(readable({ x }, 4).truncated).toBe(false);
      const cut = readable({ x }, 3);
      expect(cut.markdown).toContain("Showing 1 of 4 values.");
      expect(cut.markdown).not.toContain("| x |");
    }
  });

  it("G3 flattens one object level with a first-seen union, empty objects and row paths", () => {
    const result = readable([{ id: 1, owner: { login: "one", id: 8, tags: ["a", "b"] }, stats: {} },
      { owner: { id: 9, extra: true }, later: 2 }]);
    expect(plain(result.markdown)).toContain("| id | owner.login | owner.id | owner.tags | stats | owner.extra | later |");
    expect(plain(result.markdown)).toContain("| 1 | one | 8 | a, b | {} |  |  |");
    expect(plain(result.markdown)).toContain("|  |  | 9 |  |  | true | 2 |");
    const row = result.markdown.split("\n").findIndex(s => s.startsWith("| 1 |")) + 1;
    expect(result.map.get(row)).toBe("$[0]");
    expect(readable([{ owner: { id: 1 } }], 4).truncated).toBe(false);
    expect(readable([{ owner: { id: 1 } }], 3).markdown).toContain("Showing 1 of 4 values.");
  });

  it("G3 falls back without loss on collisions, duplicate keys, deeper objects and width", () => {
    for (const value of [[{ a: { b: 1 }, "a.b": 2 }], [{ a: { b: 1 } }, { "a.b": 2 }],
      [{ a: { b: { c: 1 } } }], [{ a: { b: Array(9).fill(1) } }]]) {
      const md = plain(readable(value).markdown);
      expect(md).not.toContain("| a.b |\n");
      expect(md).toContain("## [0]");
    }
    expect(toReadable('[{"a":{"b":1,"b":2}}]', "json").markdown).toContain("| a | b: 1 · b: 2 |");
    const fields = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`k${i}`, i]));
    expect(plain(readable([{ a: fields }]).markdown)).toContain("| a.k0 | a.k1 |");
    expect(plain(readable([{ a: fields, extra: 1 }]).markdown)).toContain("## [0]");
    expect(plain(readable([{ a: fields, extra: 1 }]).markdown)).toContain("| k31 | 31 |");
  });

  it("G3 adds details for embedded JSON, clear Markdown, or block prose, including flattened and list cells", () => {
    const result = readable([{ nested: { notes: "first\nsecond", description: "**Bold**", payload: '{"a":1}',
      parts: ['{"b":2}'] }, long: "x".repeat(161) }]);
    expect(result.markdown).toContain("first<br>second");
    expect(result.markdown).not.toContain("## 0\\: nested\\.notes");
    expect(result.markdown).not.toContain("## 0\\: long");
    // A short, single-line prose value is already whole in its cell: no detail.
    expect(result.markdown).not.toContain("> **Bold**");
    expect(result.markdown).not.toContain("nested\\.description\n");
    expect(result.markdown).toContain("| a | 1 |");
    expect(result.markdown).toContain("| b | 2 |");
    expect(result.truncated).toBe(false);
    expect([...result.map.values()]).toContain("$[0].nested.payload.a");
  });

  it("G3 gives block prose a detail, but not a multi-line string under a non-prose key", () => {
    const result = readable([{ description: "first line\nsecond line", trace: "at a()\nat b()" }]);
    expect(result.markdown).toContain("> first line");
    expect(result.markdown).toContain("at a\\(\\)<br>at b\\(\\)");
    expect(result.markdown).not.toContain("trace\n\n```");
    expect(result.markdown).not.toMatch(/^## .*trace/m);
  });

  it("G3a aligns only columns with non-empty numeric cells", () => {
    const md = readable([{ n: 1, mixed: 2, s: "3", nil: null }, { n: 2, mixed: "4", s: "5" }, {}]).markdown;
    expect(md).toContain("| n | mixed | s | nil |\n| ---: | --- | --- | --- |");
    expect(readable({ n: 1 }).markdown).toContain("| --- | --- |");
  });

  it("G4 tables valid JSON Lines, retains invalid records after it, and maps original indexes", () => {
    const result = toReadable('\n{"id":1,"owner":{"name":"one"}}\nbad\n\n{"id":2}', "jsonl");
    expect(plain(result.markdown)).toContain("| line | id | owner.name |\n| ---: | ---: | --- |");
    expect(result.markdown).toContain("| 2 | 1 | one |");
    expect(result.markdown).toContain("| 5 | 2 |  |");
    expect(result.markdown.indexOf("| 5 | 2 |")).toBeLessThan(result.markdown.indexOf("## Record 2 (line 3)"));
    expect(result.markdown).toContain("3 records, 1 not valid JSON");
    expect(result.markdown).toContain("```\nbad\n```");
    const row = result.markdown.split("\n").indexOf("| 5 | 2 |  |") + 1;
    expect(result.map.get(row)).toBe("$[2]");
    expect(result.truncated).toBe(false);
  });

  it("G4 decides columns and collisions over the full file and preserves record/value limits", () => {
    const source = '{"x":1}\n{"line":2}\n{"later":3}';
    const cut = toReadable(source, "jsonl", { maxRecords: 1 });
    expect(plain(cut.markdown)).toContain("| # | x | line | later |");
    expect(cut.markdown).toContain("Showing 1 of 3 records.");
    expect(cut.markdown).toContain("Showing 2 of 6 values.");
    expect(toReadable(source + '\n{"#":4}', "jsonl", { maxRecords: 1 }).markdown).toContain("## Record 1 (line 1)");
    expect(toReadable('{"line":{"x":1}}\n{"x":2}', "jsonl").markdown).toContain("| line | line\\.x | x |");
    expect(toReadable('{"x":1}\n{"x":{"deep":{"a":2}}}', "jsonl", { maxRecords: 1 }).markdown).toContain("## Record 1 (line 1)");
    expect(toReadable('{"x":1}\n{"x":2}', "jsonl", { maxValues: 3 }).markdown).toContain("Showing 2 of 4 values.");
    expect(toReadable('{"x":1}\nbad\n{"x":2}', "jsonl", { maxRecords: 2 }).markdown).toContain("## Record 2 (line 2)");
    const many = toReadable(Array(501).fill('{"x":1}').join("\n"), "jsonl");
    expect(many.markdown).toContain("Showing 500 of 501 records.");
    expect(many.markdown.match(/^\| \d+ \|/gm)).toHaveLength(500);
  });

  it("G5 uses the list key or brackets and leaves first-of-six labels plain", () => {
    const md = plain(readable({ steps: [{ x: { y: {} } }, { name: "true", x: { y: {} } }] }).markdown);
    expect(md).toContain("### steps[0]");
    expect(md).toContain("### true");
    expect(plain(readable([[{ x: { y: {} } }]]).markdown)).toContain("### [0]");
    expect(plain(readable([1, 2, { w: true }]).markdown)).toContain("## [2]");
  });

  it("G6 quotes typed-looking and edge-whitespace strings in every inline position", () => {
    for (const s of ["1", "-0.50e+3", "true", "false", "null", " x", "x ", "\tx"]) {
      const quoted = `${cellText('"')}${cellText(s)}${cellText('"')}`;
      expect(readable({ k: s }).markdown).toContain(`| k | ${quoted} |`);
      expect(readable([{ k: s }]).markdown).toContain(`| ${quoted} |`);
      expect(readable([s]).markdown).toContain(quoted);
      expect(readable([s, {}, null]).markdown).toContain(`- ${quoted}`);
      expect(readable({ k: { v: s } }).markdown).toContain(`v: ${quoted}`);
    }
    for (const s of ["01", "+1", ".5", "1.", "TRUE", "nullish"]) expect(readable({ k: s }).markdown).toContain(`| k | ${cellText(s)} |`);
  });

  it("G6 leaves multiline edge whitespace unquoted in cells and literal blocks", () => {
    for (const s of [" first\nsecond ", "\nfirst", "last\n", "\tfirst\rsecond\t", " first\r\nsecond "]) {
      expect(readable([{ k: s }]).markdown).toContain(`| ${cellText(s)} |`);
      expect(readable({ k: s }).markdown).toContain(`\`\`\`\n${s.replace(/\r\n|\r/g, "\n")}\n\`\`\``);
    }
  });

  it("G7 uses literal fences for ordinary multiline strings, Markdown for prose, spans for long lines", () => {
    const s = "first\n  second\n\nlast";
    expect(readable({ run: s }).markdown).toContain(`\`\`\`\n${s}\n\`\`\``);
    expect(readable({ description: s }).markdown).toContain("> first\n>   second");
    expect(readable({ other: "# Heading" }).markdown).toContain("> # Heading");
    expect(readable({ other: "x".repeat(161) }).markdown).toContain(`<span>${"x".repeat(161)}</span>`);
  });

  it("G8 recognises camelCase endings and only hints numeric instants in 2000–2100", () => {
    for (const key of ["createdAt", "startTime", "lastSeenTs", "releaseDate", "lastTimestamp", "created_at"]) {
      expect(readable({ [key]: 1700000000 }).markdown).toContain("2023\\-11\\-14");
    }
    for (const n of [3, 0, -1, 946684799, 4102444801, 946684799000, 4102444801000]) {
      expect(readable({ retry_at: n }).markdown).not.toContain("UTC");
    }
    for (const n of [946684800, 4102444800, 946684800000, 4102444800000]) expect(readable({ startTime: n }).markdown).toContain("UTC");
    expect(readable({ runtime: 1700000000 }).markdown).not.toContain("UTC");
  });
});

describe("review of #293", () => {
  it("lists at most 100 expansion problems and keeps them all in problems[]", () => {
    const text = "[".repeat(512) + Array.from({ length: 150 }, () => '"{}"').join(",") + "]".repeat(512);
    const view = toReadable(text, "json");
    expect(view.problems.length).toBeGreaterThanOrEqual(150);
    expect(view.markdown.match(/^- Line \d+, column \d+: JSON in a string/gm)?.length).toBe(100);
    expect(view.markdown).toMatch(/- And \d+ more problems?\./);
  });

  it("adds a byte hint only when the key names bytes", () => {
    const md = toReadable('{"max_megabytes":512,"total_bytes":2048,"sizeBytes":1024}', "json").markdown;
    expect(md).toContain("| max\\_megabytes | 512 |");
    expect(md).toContain("2048 (2 KiB)");
    expect(md).toContain("1024 (1 KiB)");
  });
});

describe("hint follow-ups (#296)", () => {
  const md = (value: object): string => toReadable(JSON.stringify(value), "json").markdown;

  it("hints only bare bytes keys, not larger-unit names or a bare size", () => {
    for (const key of ["terabytes", "petabytes", "kbytes", "mbytes", "teraBytes", "maxMBytes", "size", "font_size"]) {
      expect(md({ [key]: 2048 })).not.toContain("KiB");
    }
    for (const key of ["bytes", "total_bytes", "outBytes", "sizeBytes", "TOTAL_BYTES"]) {
      expect(md({ [key]: 2048 })).toContain("2 KiB");
    }
  });

  it("shows sub-second durations in ms, not as 0 s", () => {
    expect(md({ elapsed_ms: 2 })).toContain("2 (2 ms)");
    expect(md({ wait_seconds: 0.25 })).toContain("0\\.25 (250 ms)");
    expect(md({ elapsed_ms: 1500 })).toContain("(1\\.5 s)");
    expect(md({ elapsed_ms: 0 })).toContain("0 (0 ms)");
  });

  it("labels a JSON Lines detail by its line and column", () => {
    const view = toReadable('{"id":1,"description":"first\\nsecond"}\n{"id":2,"description":"ok"}', "jsonl");
    expect(view.markdown).toContain("## line 1\\: description");
    expect(view.markdown).not.toContain("## 0: description");
  });
});
