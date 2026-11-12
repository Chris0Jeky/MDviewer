import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dataKindOf, toReadable, type DataKind } from "../src/data";
import { parseJson } from "../src/data/json";
import { escapeText } from "../src/data/escape";

const fixtures = resolve("tests/fixtures/data");
const read = (name: string): string => readFileSync(`${fixtures}/${name}`, "utf8");

describe("readable data fixtures", () => {
  for (const name of readdirSync(fixtures).filter(n => !n.endsWith(".md"))) {
    it(name, () => {
      const expected = name.replace(/\.[^.]+$/, ".readable.md");
      const options = name === "budget.json" ? { maxValues: 5 } : name === "records-budget.jsonl" ? { maxRecords: 2 } : {};
      const view = toReadable(read(name), dataKindOf(name)!, { fileName: name, timeZone: "UTC", ...options });
      expect(view.markdown).toBe(read(expected));
    });
  }
});

describe("dataKindOf", () => {
  it.each([
    ["x.json", "json"], ["x.JSONC", "json"], ["x.jsonl", "jsonl"], ["x.NDJSON", "jsonl"],
    ["x.yaml", "yaml"], ["x.YML", "yaml"], ["x.toml", "toml"], ["x.csv", "csv"], ["x.TSV", "csv"], ["notes.txt", "text"], ["server.LOG", "text"],
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
    expect(pathFor("## odd key")).toBe('$["odd key"]');
    expect(pathFor("| a | 1 |")).toBe('$["odd key"].a');
    expect(pathFor("- 8")).toBe("$.items[8]");
    const table = toReadable('[{"a":1},{"b":2}]', "json");
    expect([...table.map.values()]).toContain("$[1]");
  });

  it("retains member order across mixed scalar and nested members", () => {
    const md = toReadable('{"first":1,"nested":{"x":2},"last":3}', "json").markdown;
    expect(md.indexOf("| first")).toBeLessThan(md.indexOf("## nested"));
    expect(md.indexOf("## nested")).toBeLessThan(md.indexOf("| last"));
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
    const view = toReadable('[{"description":"**Hello**","payload":"{\\"a\\":1}","parts":["[2]"]}]', "json", { maxValues: 11 });
    expect(view.markdown).toContain("| description | payload | parts |");
    expect(view.markdown).toContain("> **Hello**");
    expect(view.markdown).toContain("| a | 1 |");
    expect(view.markdown).toContain("\\(JSON in a string\\)");
    expect(view.truncated).toBe(false);
  });

  it("uses nested lists past level four and labels non-flat records", () => {
    const md = toReadable('{"a":{"b":{"c":{"d":{"e":1}}}}}', "json").markdown;
    expect(md).toContain("#### c\n\n- d\n\n  | Key");
    expect(md).not.toContain("#####");
    const list = toReadable('[{"id":7,"name":"A","nested":{}},{"id":8,"nested":{}}]', "json").markdown;
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
    expect(broken.markdown).toContain("| a | 1 |");
    expect(broken.markdown).toContain("| c | 3 |");
    expect(broken.markdown).toContain("- Line 4, column 6:");
    const cut = toReadable("0\nbad", "jsonl", { maxRecords: 1 });
    expect(cut.problems[0]?.line).toBe(2);
    expect(cut.markdown).toContain("- Line 2,");
  });

  it.each(["yaml", "toml", "csv"] as DataKind[])("does not parse %s", kind => {
    const view = toReadable("{}", kind);
    expect(view.problems).toEqual([{ message: `${kind.toUpperCase()} is not supported yet.`, line: 1, column: 1 }]);
    expect(view.markdown).toContain("not supported yet");
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
    expect(view.markdown).toMatch(/\| b \| 1 \|/);
    expect(view.truncated).toBe(false);
  });
});
