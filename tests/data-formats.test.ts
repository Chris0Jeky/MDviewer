import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prepare, toReadable } from "../src/data";
import { parseYaml } from "../src/data/yaml";
import { parseToml } from "../src/data/toml";
import { parseCsv } from "../src/data/csv";
import type { JsonValue } from "../src/data/json";

function entries(value: JsonValue | undefined): Record<string, JsonValue> {
  expect(value?.kind).toBe("object");
  return Object.fromEntries(value?.kind === "object" ? value.entries.map(e => [e.key, e.value]) : []);
}
const fixture = (name: string): string => readFileSync(resolve("tests/fixtures/data", name), "utf8");

describe("optional YAML reader", () => {
  it("requires preparation, shares its pending load, and leaves other kinds synchronous", async () => {
    vi.resetModules();
    const data = await import("../src/data");
    expect(() => data.toReadable("a: 1", "yaml")).toThrow('await prepare("yaml")');
    const pending = data.prepare("yaml");
    expect(data.prepare("yaml")).toBe(pending);
    expect(() => data.toReadable("a: 1", "yaml")).toThrow('await prepare("yaml")');
    await pending;
    expect(data.toReadable("a: 1", "yaml").problems).toEqual([]);
    await data.prepare("csv");
    expect(data.toReadable("a\nb", "csv").problems).toEqual([]);
  });

  it("has no static yaml import or require anywhere in src/data", () => {
    for (const name of readdirSync(resolve("src/data"), { recursive: true })) {
      if (typeof name !== "string" || !name.endsWith(".ts")) continue;
      const source = readFileSync(resolve("src/data", name), "utf8");
      expect(source, name).not.toMatch(/\bfrom\s*["']yaml["']|\brequire\s*\(\s*["']yaml["']\s*\)|\bimport\s*["']yaml["']/);
    }
  });
});

describe("YAML source nodes", () => {
  beforeAll(() => prepare("yaml"));

  it("keeps scalar lexemes, decoded strings, empty nulls, and exact positions", () => {
    const result = parseYaml('hex: 0x1F\nsep: 1_000\nfloat: 1.0\nplus: +12\ninf: .inf\nyes: yes\nnone: ~\nnull: null\nempty:\nquoted: "a\\nb"\nblock: |\n  first\n  second\n');
    expect(result.problems).toEqual([]);
    const v = entries(result.values[0]);
    for (const [key, raw] of Object.entries({ hex: "0x1F", sep: "1_000", float: "1.0", plus: "+12", inf: ".inf", none: "~", null: "null", empty: "" })) {
      expect(v[key]).toMatchObject({ raw });
      expect(toReadable(`${key}: ${raw}`, "yaml").markdown.replace(/\\([!-/:-@[-`{-~])/g, "$1")).toContain(raw);
    }
    expect(v.hex).toMatchObject({ kind: "number", line: 1, column: 6 });
    expect(v.yes).toMatchObject({ kind: "string", value: "yes" });
    expect(v.quoted).toMatchObject({ kind: "string", value: "a\nb", line: 10, column: 9 });
    expect(v.block).toMatchObject({ kind: "string", value: "first\nsecond\n" });
  });

  it("keeps duplicate and complex keys in order and reports tags as warnings without losing values", () => {
    const result = parseYaml('same: 1\nsame: 2\n? [a, b]\n: !custom "<b>hi</b>"\n');
    expect(result.invalid).toBe(false);
    expect(result.problems).toEqual([expect.objectContaining({ line: 4, column: 3 })]);
    expect(result.values[0]).toMatchObject({ entries: [
      { key: "same", value: { raw: "1" } }, { key: "same", value: { raw: "2" } },
      { key: "[a, b]", value: { raw: "!custom <b>hi</b>" } },
    ] });
    const view = toReadable('v: !custom "<b>hi</b>"', "yaml");
    expect(view.markdown).toContain("\\!custom &lt;b&gt;hi&lt;\\/b&gt;".replace(/&gt;/g, "\\>"));
    expect(view.markdown).toContain("## Problems");
  });

  it("never expands aliases, including cyclic and billion-laughs input", () => {
    const source = fixture("bomb.yaml");
    const view = toReadable(source, "yaml");
    expect(view.problems).toEqual([]);
    expect(view.markdown.length).toBeLessThan(12000);
    expect(view.markdown).toContain("alias of &amp;");
    expect(parseYaml("a: &a [*a]").values[0]).toMatchObject({ entries: [{ value: { items: [{ kind: "literal", raw: "alias of &a" }] } }] });
  });

  it("preserves root/collection tag spelling and respects explicitly tagged strings", () => {
    const result = parseYaml('%TAG !e! tag:example.test,2026:\n--- !e!record # tag comment\n{x: 1}\n');
    expect(result.invalid).toBe(false);
    expect(result.values[0]).toMatchObject({ kind: "literal", raw: "!e!record {x: 1}" });
    expect(entries(parseYaml('value: !!str 1_000').values[0]).value).toMatchObject({ kind: "string", value: "1_000" });
    expect(entries(parseYaml('value: 1__0').values[0]).value).toMatchObject({ kind: "string", value: "1__0" });
  });

  it("reports syntax errors at their exact source location and fences the source", () => {
    const source = fixture("broken.yaml");
    const view = toReadable(source, "yaml");
    expect(view.problems).toEqual([{ message: "Flow sequence in block collection must be sufficiently indented and end with a ]", line: 3, column: 1 }]);
    expect(view.markdown).toContain("```\n" + source + "\n```");
  });

  it("uses document and value budgets and the existing conversation lens", () => {
    const view = toReadable(fixture("multi.yaml"), "yaml", { maxRecords: 2 });
    expect(view.markdown).toContain("3 documents");
    expect(view.markdown).toContain("## Document 2");
    expect(view.markdown).toContain("Showing 2 of 3 documents.");
    expect(view.truncated).toBe(true);
    expect(toReadable("a: 1\nb: 2", "yaml", { maxValues: 2 }).markdown).toContain("Showing 2 of 3 values.");
    const conversation = toReadable("- role: user\n  content: Hello\n- role: assistant\n  content: Welcome\n", "yaml");
    expect(conversation.markdown).toContain("## User");
    expect(conversation.markdown).toContain("> Welcome");
  });
});

describe("TOML 1.0", () => {
  it("reads the complete invented config and preserves every scalar family", () => {
    const source = fixture("app.toml");
    const result = parseToml(source);
    expect(result.problem).toBeUndefined();
    const v = entries(result.value);
    for (const [key, raw] of Object.entries({ decimal: "1_000", hex: "0x1F", octal: "0o755", binary: "0b1010", signed: "+12", negative: "-42", float: "1.0", exponent: "-1_2.5_0e+2", infinite: "inf", nan: "-nan", offset: "1979-05-27T07:32:00-07:00", local: "1979-05-27 07:32:00.123", date: "1979-05-27", time: "07:32:00" })) {
      expect(v[key], key).toMatchObject({ raw });
      expect(toReadable(`${key} = ${raw}`, "toml").markdown.replace(/\\([!-/:-@[-`{-~])/g, "$1")).toContain(raw);
    }
    expect(v.basic).toMatchObject({ kind: "string", value: "hello\tworld" });
    expect(v.literal).toMatchObject({ kind: "string", value: "C:\\invented\\path" });
    expect(v.multibasic).toMatchObject({ kind: "string", value: "one two\nthree\n" });
    expect(v.multiliteral).toMatchObject({ kind: "string", value: "one\n\\two\n" });
    expect(v.products).toMatchObject({ kind: "array", items: [
      { entries: [{ key: "name", value: { value: "Pencil" } }, { key: "price", value: { raw: "1.25" } }] },
      { entries: [{ key: "name", value: { value: "Paper" } }, { key: "price", value: { raw: "2.0" } }] },
    ] });
  });

  it("retains table/dotted-key order, quoted keys, and source positions", () => {
    const result = parseToml('first = 1\r\n"odd.key".leaf = "ok"\r\n[a.b]\r\nx = [1, # comment\r\n2,]\r\n[a]\r\ny = { z = true }\r\n');
    expect(result.problem).toBeUndefined();
    expect(result.value).toMatchObject({ entries: [
      { key: "first", value: { raw: "1", line: 1, column: 9 } },
      { key: "odd.key", value: { entries: [{ key: "leaf", value: { value: "ok", line: 2, column: 18 } }] } },
      { key: "a", value: { entries: [{ key: "b" }, { key: "y" }] } },
    ] });
  });

  it("reports a duplicate at its exact line and column then fences the source", () => {
    const source = fixture("broken.toml");
    const view = toReadable(source, "toml");
    expect(view.problems).toEqual([{ message: "Duplicate key 'port'", line: 3, column: 1 }]);
    expect(view.markdown).toContain("```\n" + source + "\n```");
  });

  it.each([
    '[a]\nx=1\n[a]', 'a.b=1\n[a]', 'a={b=1}\na.c=2', 'a={b={}}\n[a.b]', 'a=[]\n[[a]]', 'a=1\na.b=2',
    '[a.b]\nx=1\n[a]\nb.c=2', '[a.b.c]\nx=1\n[a]\nb.y=2\n[a.b]\nz=3',
    'a="\\q"', 'a="\\uD800"', 'a="\\U00110000"', 'a="unterminated', "a='unterminated", 'a="raw\nnewline"',
    'a=01', 'a=1__0', 'a=0x_1', 'a=+0x1', 'a=1.', 'a=.1', 'a=1e', 'a=1e_2', 'a=NaN', 'a=TRUE',
    'a=1979-02-30', 'a=24:00:00', 'a=1979-05-27T07:32:00+24:00', 'a={x=1,}', 'a={\nx=1}', 'a=[1 2]', 'a=1 garbage',
  ])("rejects malformed input without throwing: %s", source => {
    const view = toReadable(source, "toml");
    expect(view.problems.length).toBeGreaterThan(0);
    expect(view.markdown).toContain("invalid document");
    expect(view.problems[0]!.line).toBeGreaterThan(0);
    expect(view.problems[0]!.column).toBeGreaterThan(0);
  });

  it.each([
    'a=+inf\nb=-inf\nc=+nan\nd=nan', 'a=0\nb=-0\nc=0.0\nd=1e+03',
    'a="""\nline \\\n \t  continued"""', "a='''\nline\nsecond'''", 'a="""ends with two quotes"""""',
    String.raw`a="\b\t\n\f\r\"\\\u0041\U0001F600"`, 'a=2000-02-29t12:00:00z',
    '[[fruits]]\nname="apple"\n[fruits.physical]\ncolor="red"\n[[fruits.varieties]]\nname="red"\n[[fruits]]\nname="banana"',
  ])("accepts valid TOML: %s", source => expect(parseToml(source).problem).toBeUndefined());

  it("uses the conversation lens without format-specific recognition", () => {
    const view = toReadable('[[messages]]\nrole="user"\ncontent="Hello"\n[[messages]]\nrole="assistant"\ncontent="Welcome"', "toml");
    expect(view.markdown).toContain("## User");
    expect(view.markdown).toContain("> Welcome");
  });

  it("bounds combined dotted-key, table and value depth before rendering", () => {
    const source = `[${Array.from({ length: 300 }, (_, i) => `k${i}`).join('.')} ]\nvalue=${'['.repeat(300)}0${']'.repeat(300)}`;
    const view = toReadable(source, "toml");
    expect(view.problems[0]?.message).toContain("maximum depth of 512");
    expect(view.problems[0]?.line).toBe(2);
  });
});

describe("CSV and TSV fields", () => {
  it("decodes RFC quotes and keeps ragged records, headers and strings", () => {
    const parsed = parseCsv(fixture("people.csv"));
    expect(parsed.problems).toEqual([]);
    expect(parsed.columns).toBe(5);
    expect(parsed.value.items[0]).toMatchObject({ entries: [
      { key: "name", value: { value: "Ada, A.", line: 2, column: 1 } },
      { key: "note", value: { value: 'Says "hello"' } },
      { key: "column 3", value: { value: "001" } },
      { key: "name (2)", value: { value: "Al" } },
    ] });
    expect(parsed.value.items[1]).toMatchObject({ entries: [
      { value: { value: "Bo" } }, { value: { value: "first\nsecond" } },
      { value: { value: "2024-01-02" } }, { value: { value: "B" } }, { key: "column 5", value: { value: "extra" } },
    ] });
    expect(parsed.value.items[2]?.kind === "object" && parsed.value.items[2].entries).toHaveLength(1);
  });

  it.each(["\r\n", "\n", "\r"])("accepts %j row ends and no phantom row after a final terminator", ending => {
    expect(parseCsv(`a,b${ending}x,y${ending}`).value.items).toHaveLength(1);
    expect(parseCsv(`a${ending}x${ending}${ending}`).value.items).toHaveLength(2);
    expect(parseCsv(`a,b${ending}x,`).value.items[0]).toMatchObject({ entries: [{ value: { value: "x" } }, { value: { value: "" } }] });
  });

  it("disambiguates colliding generated and literal headers without dropping cells", () => {
    const row = parseCsv('x,x,x (2),,column 4\na,b,c,d,e,extra').value.items[0];
    expect(row?.kind === "object" && row.entries.map(e => e.key)).toEqual(["x", "x (2)", "x (2) (2)", "column 4", "column 4 (2)", "column 6"]);
  });

  it("reports the opening quote position and still displays the rest", () => {
    const view = toReadable('name,note\r\nA,"open\r\nrest', "csv");
    expect(view.problems).toEqual([{ message: "Unterminated quoted field", line: 2, column: 3 }]);
    expect(view.markdown).toContain("open<br>rest");
  });

  it("uses values, not maxRecords, to bound rows and keeps the whole overview", () => {
    const view = toReadable('a,b\n1,2\n3,4\n5,6', "csv", { maxValues: 7, maxRecords: 1 });
    expect(view.markdown).toContain("CSV · 15 B · 3 rows, 2 columns");
    expect(view.markdown).toContain("| 3 | 4 |");
    expect(view.markdown).not.toContain("| 5 | 6 |");
    expect(view.markdown).toContain("Showing 2 of 3 rows.");
    expect(view.truncated).toBe(true);
    const large = toReadable('a\n' + Array.from({ length: 600 }, (_, i) => String(i)).join('\n'), "csv", { maxRecords: 1 });
    expect(large.truncated).toBe(false);
    expect(large.markdown).toContain("| 599 |");
    expect(toReadable('a\nx', "csv", { maxValues: 0 }).markdown).toContain("Showing 0 of 1 rows.");
  });

  it("selects tab only from a TSV filename", () => {
    const view = toReadable('name\tvalue\r\nA\t001\r\n', "csv", { fileName: "METRICS.TSV" });
    expect(view.problems).toEqual([]);
    expect(view.markdown).toContain("TSV ·");
    expect(view.markdown).toContain("1 row, 2 columns");
    expect(view.markdown).toContain("| A | 001 |");
    expect(parseCsv('a\tb\nx\ty').columns).toBe(1);
  });
});

describe("hostile sizes (review of #281)", () => {
  it("parses a very wide TOML table in linear time", () => {
    const text = Array.from({ length: 150_000 }, (_, i) => `k${i} = ${i}`).join("\n");
    const started = performance.now();
    const view = toReadable(text, "toml", { maxValues: 10 });
    expect(view.problems).toEqual([]);
    // Quadratic key checks took minutes here; linear is well under a second.
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 60_000);

  it("lists at most 100 problems and counts one stray quote per field", () => {
    const view = toReadable("a\n" + '5"x"\n'.repeat(5_000), "csv");
    expect(view.problems).toHaveLength(5_000);
    expect(view.markdown.match(/^- Line /gm)?.length).toBe(100);
    expect(view.markdown).toContain("- And 4,900 more problems.");
  });

  it("names many duplicate headers without a quadratic search", () => {
    const view = toReadable(Array.from({ length: 50_000 }, () => "x").join(",") + "\n", "csv", { maxValues: 5 });
    expect(view.markdown).toContain("50,000 columns");
    expect(view.markdown).toContain("x \\(50000\\)");
  }, 60_000);

  it("names the columns of a header-only CSV", () => {
    expect(toReadable("name,age\n", "csv").markdown).toContain("Columns: name, age");
  });
});
