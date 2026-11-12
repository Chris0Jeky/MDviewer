import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { copyValue, dataKindOf, pathForms, prepare, subtreeJson, toReadable, valueAt } from "../src/data";
import { parseCsv } from "../src/data/csv";
import { parseJson, type JsonValue } from "../src/data/json";
import { parseToml } from "../src/data/toml";
import type { DataKind } from "../src/data/types";
import { parseYaml } from "../src/data/yaml";

beforeAll(() => prepare("yaml"));

function required(text: string, kind: DataKind = "json", path = "$"): JsonValue {
  const value = valueAt(text, kind, path);
  expect(value, `${kind}: ${path}`).toBeDefined();
  return value!;
}

describe("valueAt", () => {
  it("requires YAML preparation, including while the optional reader is loading", async () => {
    vi.resetModules();
    const data = await import("../src/data");
    expect(() => data.valueAt("a: 1", "yaml", "$.a")).toThrow('await prepare("yaml")');
    const pending = data.prepare("yaml");
    expect(() => data.valueAt("a: 1", "yaml", "$")).toThrow('await prepare("yaml")');
    await pending;
    expect(data.valueAt("a: 1", "yaml", "$.a")).toMatchObject({ raw: "1" });
  });

  it.each<[DataKind, string, string, string]>([
    ["json", '{"a":[{"b":1.0}],"odd key":false}', "$.a[0].b", "1.0"],
    ["json", '{"a":[{"b":1.0}],"odd key":false}', '$["odd key"]', "false"],
    ["json", '{/* invented */"odd key": [true,],}', '$["odd key"][0]', "true"],
    ["jsonl", '\r\n{"a":1}\r\n\t \r{"odd key":2}\n', '$[1]["odd key"]', "2"],
    ["jsonl", '{"a":1}\nbad\n{"a":3}', "$[2].a", "3"],
    ["yaml", 'a: [{b: 1.0}]\n"odd key": false', "$.a[0].b", "1.0"],
    ["yaml", 'a: [{b: 1.0}]\n"odd key": false', '$["odd key"]', "false"],
    ["yaml", '---\na: 1\n---\n"odd key": [2, 3]', '$[1]["odd key"][0]', "2"],
    ["toml", 'a = [{b = 1_000}]\n"odd key" = false', "$.a[0].b", "1_000"],
    ["toml", 'a = [{b = 1_000}]\n"odd key" = false', '$["odd key"]', "false"],
    ["csv", 'name,odd key\nOne,"two,three"\nFour,005', '$[0]["odd key"]', "two,three"],
    ["csv", 'name,odd key\nOne,"two,three"\nFour,005', "$[1].name", "Four"],
  ])("resolves %s %s at %s", (kind, source, path, expected) => {
    expect(copyValue(required(source, kind, path))).toBe(expected);
  });

  it("supports every emitted identifier and escaped JSON key without prototype lookup", () => {
    const keys = ["$id", "a$b", "_a1", 'a"b', "a\\b", "a b", "雪", "", "a.b", "[0]", "\n", "__proto__", "constructor"];
    for (const [i, key] of keys.entries()) {
      const source = JSON.stringify({ [key]: i });
      const path = /^[A-Za-z_$][\w$]*$/.test(key) ? `$.${key}` : `$[${JSON.stringify(key)}]`;
      expect(copyValue(required(source, "json", path))).toBe(String(i));
    }
    expect(valueAt("{}", "json", "$.constructor")).toBeUndefined();
  });

  it.each<[DataKind, string]>([
    ["json", '{"same":{"n":1},"same":{"n":2,"later":3}}'],
    ["yaml", 'same: {n: 1}\nsame: {n: 2, later: 3}'],
  ])("selects the first duplicate key in %s", (kind, source) => {
    expect(copyValue(required(source, kind, "$.same.n"))).toBe("1");
    expect(valueAt(source, kind, "$.same.later")).toBeUndefined();
  });

  it("returns root values, whole table records and synthetic document/record lists", () => {
    expect(required("null")).toMatchObject({ kind: "literal", raw: "null" });
    expect(required('[{"owner":{"login":"invented"}}]', "json", "$[0]")).toMatchObject({ kind: "object" });
    expect(required("name,n\nA,1", "csv", "$[0]")).toMatchObject({ kind: "object", entries: [{ key: "name" }, { key: "n" }] });
    expect(subtreeJson(required('{"a":1}\n{"a":2}', "jsonl"))).toBe('[\n  {\n    "a": 1\n  },\n  {\n    "a": 2\n  }\n]');
    expect(required("---\na: 1\n---\na: 2", "yaml")).toMatchObject({ kind: "array", items: [{ kind: "object" }, { kind: "object" }] });
    expect(required("", "jsonl")).toMatchObject({ kind: "array", items: [] });
    expect(required("name\n", "csv")).toMatchObject({ kind: "array", items: [] });
  });

  it("selects an embedded JSON string itself and does not walk its displayed children", () => {
    const source = JSON.stringify({ payload: '{"a":1}' });
    expect(copyValue(required(source, "json", "$.payload"))).toBe('{"a":1}');
    expect(valueAt(source, "json", "$.payload.a")).toBeUndefined();
  });

  it.each(["", ".a", "a", "$$", "$.", "$..a", "$[", "$[-1]", "$[01]", "$[1.0]", "$[1e0]", "$[*]", "$['a']", '$["a"', '$["\\q"]', '$["a\nb"]', "$[9007199254740992]", "$.a ", "$[0]junk"])("rejects malformed path %s without throwing", path => {
    expect(valueAt('{"a":[1]}', "json", path)).toBeUndefined();
  });

  it.each<[DataKind, string, string]>([
    ["json", '{"a":[1]}', "$.missing"], ["json", '{"a":[1]}', "$.a[1]"],
    ["json", '{"a":[1]}', '$.a["0"]'], ["json", '{"a":1}', "$.a.b"],
    ["json", "broken", "$"], ["jsonl", '{"a":1}\nbad\n{"a":3}', "$[1]"],
    ["jsonl", '{"a":1}\nbad', "$"], ["jsonl", "{}", "$[1]"],
    ["jsonl", "/* not JSONC */{}", "$[0]"], ["jsonl", "{}", "$.a"],
    ["yaml", "a: [", "$"], ["yaml", "a: 1", "$[0]"],
    ["yaml", "---\na: 1\n---\na: 2", "$[2]"],
    ["toml", "a = 1\na = 2", "$"], ["toml", "a = [1]", "$.a[1]"],
    ["csv", "a\nb", "$[1]"], ["csv", "a\nb", "$[0].missing"],
    ["text", "uninterpreted text", "$"], ["text", "text", "line 1"],
  ])("returns undefined for unknown/invalid %s %s at %s", (kind, source, path) => {
    expect(valueAt(source, kind, path)).toBeUndefined();
  });
});

describe("copyValue and subtreeJson", () => {
  it.each<[DataKind, string, string]>([
    ["json", "1.0", "1.0"], ["json", "12345678901234567890", "12345678901234567890"],
    ["json", "-0.50e+3", "-0.50e+3"], ["json", "true", "true"], ["json", "null", "null"],
    ["json", String.raw`"a\n\u263a\\\""`, 'a\n☺\\"'], ["json", '""', ""],
    ["yaml", "0x1F", "0x1F"], ["yaml", "~", "~"], ["yaml", '"decoded\\ntext"', "decoded\ntext"],
    ["toml", "n = 1_000", "1_000"], ["toml", "n = 1979-05-27", "1979-05-27"],
    ["toml", "n = inf", "inf"], ["csv", 'n\n"one""two"', 'one"two'],
  ])("copies scalar source/decoded text for %s %s", (kind, source, expected) => {
    const path = kind === "toml" ? "$.n" : kind === "csv" ? "$[0].n" : "$";
    expect(copyValue(required(source, kind, path))).toBe(expected);
  });

  it("pretty-prints ordered keys, nested lists, empty containers and JSON-escaped strings", () => {
    const source = String.raw`{"10":1.0,"2":[{},[],"a\n\"\\"],"last":12345678901234567890}`;
    const expected = String.raw`{
  "10": 1.0,
  "2": [
    {},
    [],
    "a\n\"\\"
  ],
  "last": 12345678901234567890
}`;
    const root = required(source);
    expect(subtreeJson(root)).toBe(expected);
    expect(copyValue(root)).toBe(expected);
    expect(JSON.parse(expected)["2"]).toEqual([{}, [], 'a\n"\\']);
    expect(subtreeJson(required("[]"))).toBe("[]");
    expect(subtreeJson(required("{}"))).toBe("{}");
  });

  it.each<[DataKind, string, Record<string, unknown>]>([
    ["yaml", "none: ~\nempty:\nhex: 0x1F\nsep: 1_000\ninf: .inf\nplus: +12\nnull: null\nyes: true\nfloat: 1.0", { none: "~", empty: "", hex: "0x1F", sep: "1_000", inf: ".inf", plus: "+12", null: null, yes: true, float: 1 }],
    ["toml", "date = 1979-05-27\ntime = 07:32:00\ninf = inf\nsep = 1_000\nfloat = 1.0\nyes = false", { date: "1979-05-27", time: "07:32:00", inf: "inf", sep: "1_000", float: 1, yes: false }],
  ])("quotes non-JSON scalars from %s", (kind, source, expected) => {
    const output = subtreeJson(required(source, kind));
    expect(JSON.parse(output)).toEqual(expected);
    expect(output).toContain('"float": 1.0');
  });

  it.each<[DataKind, string]>([["json", '{"x":1.0,"x":2}'], ["yaml", "x: 1.0\nx: 2"]])("keeps duplicate keys in %s subtree text", (kind, source) => {
    expect(subtreeJson(required(source, kind))).toBe('{\n  "x": 1.0,\n  "x": 2\n}');
  });
});

describe("pathForms", () => {
  it.each<[string, DataKind, string, boolean]>([
    ["$", "json", ".", false], ["$.a.b", "json", ".a.b", false],
    ["$[3].a", "jsonl", ".[3].a", true], ["$", "jsonl", ".", true],
    ["$.a[3].b", "json", ".a[3].b", false], ["$[0][1]", "yaml", ".[0][1]", false],
    ['$["odd key"]', "toml", '.["odd key"]', false],
    [String.raw`$["a\"b"]`, "json", String.raw`.["a\"b"]`, false],
    ['$["a\\\\b"]', "json", '.["a\\\\b"]', false],
    ['$["雪"]', "yaml", '.["雪"]', false], ['$["a.b"]', "json", '.["a.b"]', false],
    ['$[""]', "csv", '.[""]', false], ['$["\\n"]', "json", '.["\\n"]', false],
    ["$.$id.a$b._a1", "json", '.["$id"]["a$b"]._a1', false],
    ['$["simple"].items[2]["odd key"]', "json", '.simple.items[2]["odd key"]', false],
    ["$[0].column", "csv", ".[0].column", false],
  ])("formats %s for %s", (path, kind, jq, jqSlurp) => {
    expect(pathForms(path, kind)).toEqual({ jsonPath: path, jq, jqSlurp });
  });

  it("rejects malformed paths rather than silently copying a different path", () => {
    expect(() => pathForms("$.a[*]", "json")).toThrow("Malformed readable-view path");
  });
});

const fixtures = resolve("tests/fixtures/data");
const names = readdirSync(fixtures).filter(name => !name.endsWith(".md"));

/** Independent parser trees for enumerating the fixture's actual data paths, not its displayed text. */
function fixtureRoots(text: string, kind: DataKind): (JsonValue | undefined)[] {
  switch (kind) {
    case "json": return [parseJson(text).value ?? parseJson(text, true).value];
    case "jsonl": return text.split(/\r\n|\r|\n/).flatMap((line, i) => /[^ \t\r\n]/.test(line) ? [parseJson(line, false, i).value] : []);
    case "yaml": return parseYaml(text).values;
    case "toml": return [parseToml(text).value];
    case "csv": return [parseCsv(text).value];
    case "text": return [];
  }
}

function dataPaths(roots: (JsonValue | undefined)[], kind: DataKind): Map<string, JsonValue> {
  const paths = new Map<string, JsonValue>();
  function visit(value: JsonValue | undefined, path: string): void {
    if (!value || paths.has(path)) return;
    paths.set(path, value);
    if (value.kind === "array") value.items.forEach((item, i) => visit(item, `${path}[${i}]`));
    if (value.kind === "object") for (const entry of value.entries) {
      const key = /^[A-Za-z_$][\w$]*$/.test(entry.key) ? `.${entry.key}` : `[${JSON.stringify(entry.key)}]`;
      visit(entry.value, path + key);
    }
  }
  if (kind === "jsonl" || (kind === "yaml" && roots.length > 1)) {
    if (roots.every((root): root is JsonValue => root !== undefined)) visit({ kind: "array", items: roots, line: 1, column: 1 }, "$");
    roots.forEach((root, i) => visit(root, `$[${i}]`));
  } else visit(roots[0], "$");
  return paths;
}

describe("copy fixture properties (read-only)", () => {
  for (const name of names) {
    it(`resolves every mapped data line in ${name}, accounting for non-data maps`, () => {
      const text = readFileSync(resolve(fixtures, name), "utf8");
      const kind = dataKindOf(name)!;
      // With no fileName parameter, valueAt and toReadable both use comma CSV, including metrics.tsv.
      const view = toReadable(text, kind);
      const paths = dataPaths(fixtureRoots(text, kind), kind);
      const exceptions: Record<string, string[]> = {
        "broken.json": ["$"], "broken.yaml": ["$"], "broken.toml": ["$"],
        "lines.jsonl": ["$", "$[1]"],
        "agent.jsonl": ["$", "$[4]"],
        "events-table.jsonl": ["$", "$[1]"],
        "embedded.json": ["$.payload.a", "$.payload.items"],
        "notes.txt": ["$", "line 1"],
      };
      expect(view.map.size).toBeGreaterThan(0);
      for (const [line, path] of view.map) {
        const expected = paths.get(path);
        const actual = valueAt(text, kind, path);
        if (expected) expect(actual, `${name}:${line} ${path}`).toEqual(expected);
        else {
          expect(exceptions[name], `${name}:${line} unexpected non-data path ${path}`).toContain(path);
          expect(actual, `${name}:${line} ${path}`).toBeUndefined();
        }
      }
    });

    it(`round-trips every parsed value in ${name} as JSON`, () => {
      const kind = dataKindOf(name)!;
      const roots = fixtureRoots(readFileSync(resolve(fixtures, name), "utf8"), kind);
      const pending = roots.filter((root): root is JsonValue => root !== undefined);
      while (pending.length) {
        const value = pending.pop()!;
        const output = subtreeJson(value);
        // Source-preserving parse also proves no JSON lexeme, duplicate key or order was lost.
        const reparsed = parseJson(output);
        expect(reparsed.problem, output).toBeUndefined();
        expect(subtreeJson(reparsed.value!)).toBe(output);
        expect(() => JSON.parse(output), output).not.toThrow();
        if (value.kind === "array") pending.push(...value.items);
        if (value.kind === "object") pending.push(...value.entries.map(entry => entry.value));
      }
    });
  }
});

describe("TSV paths", () => {
  it("uses the tab delimiter for a .tsv file name, as toReadable does", () => {
    const text = "name\tcount\nalpha\t3\n";
    expect(copyValue(valueAt(text, "csv", "$[0].count", "metrics.tsv")!)).toBe("3");
    expect(valueAt(text, "csv", "$[0].count")).toBeUndefined();
  });
});
