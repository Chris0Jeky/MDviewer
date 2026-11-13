import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { prepareRenderText, renderTextOf } from "../src/app/renderText";
import { renderReaderDocument } from "../src/desktop/render";
import { dataCopy, dataReference, readableCopy, trackDataTarget, type DataCopyKind } from "../src/desktop/reader/dataCopy";

/** Readable data D5 (docs/design/READABLE_DATA.md). Invented documents only. */
const root = document.createElement("div");
document.body.append(root);
trackDataTarget(root);

async function open(name: string, text: string): Promise<void> {
  await prepareRenderText(name);
  const view = renderTextOf(name, text);
  const { document: rendered } = await renderReaderDocument(view.text, DEFAULT_SETTINGS, name, undefined, { data: true });
  root.replaceChildren(...rendered.childNodes);
  getSelection()!.removeAllRanges();
}

/** Put the selection in the first element whose own text is `text`, as a click in the reader does. */
function select(text: string): void {
  const element = [...root.querySelectorAll("td, th, h1, h2, h3, p, li, pre")].find(el => el.textContent === text);
  if (!element) throw new Error(`No element reads ${JSON.stringify(text)}`);
  getSelection()!.collapse(element.firstChild!, 0);
  document.dispatchEvent(new Event("selectionchange"));
}

function copied(kind: DataCopyKind, name: string, text: string): string {
  const result = dataCopy(kind, { name, text }, root);
  if (!("text" in result)) throw new Error(result.problem);
  return result.text;
}

afterEach(() => { root.replaceChildren(); getSelection()!.removeAllRanges(); });

describe("copy on a data document", () => {
  const JSON_TEXT = JSON.stringify({
    name: "demo-service", "odd key": "v1", "a.b": 7, "it's": true, 'say "hi"': "x", "9lives": "cat",
    limits: { requests: 100, burst: 20 },
    owners: [{ name: "Ada", role: "lead" }, { name: "Lin", role: "ops" }],
  }, null, 2);

  it("copies a value, both path forms and a subtree for a key and value row", async () => {
    await open("service.json", JSON_TEXT);
    select("name");
    expect(copied("value", "service.json", JSON_TEXT)).toBe("demo-service");
    expect(copied("jsonPath", "service.json", JSON_TEXT)).toBe("$.name");
    expect(copied("jq", "service.json", JSON_TEXT)).toBe(".name");
    expect(copied("subtree", "service.json", JSON_TEXT)).toBe('"demo-service"');
  });

  it.each([
    ["odd key", '$["odd key"]', '.["odd key"]', "v1"],
    ["a.b", '$["a.b"]', '.["a.b"]', "7"],
    ["it's", '$["it\'s"]', '.["it\'s"]', "true"],
    ['say "hi"', '$["say \\"hi\\""]', '.["say \\"hi\\""]', "x"],
    ["9lives", '$["9lives"]', '.["9lives"]', "cat"],
  ])("quotes the key %s in JSONPath and jq", async (key, jsonPath, jq, value) => {
    await open("service.json", JSON_TEXT);
    select(key);
    expect(copied("jsonPath", "service.json", JSON_TEXT)).toBe(jsonPath);
    expect(copied("jq", "service.json", JSON_TEXT)).toBe(jq);
    expect(copied("value", "service.json", JSON_TEXT)).toBe(value);
  });

  it("maps a flattened table cell to its row", async () => {
    await open("service.json", JSON_TEXT);
    select("Lin");
    expect(copied("jsonPath", "service.json", JSON_TEXT)).toBe("$.owners[1]");
    expect(copied("jq", "service.json", JSON_TEXT)).toBe(".owners[1]");
    expect(copied("subtree", "service.json", JSON_TEXT)).toBe('{\n  "name": "Lin",\n  "role": "ops"\n}');
    select("lead");
    expect(copied("jsonPath", "service.json", JSON_TEXT)).toBe("$.owners[0]");
  });

  it("copies an inline object as its subtree", async () => {
    await open("service.json", JSON_TEXT);
    select("limits");
    expect(copied("subtree", "service.json", JSON_TEXT)).toBe('{\n  "requests": 100,\n  "burst": 20\n}');
    expect(copied("value", "service.json", JSON_TEXT)).toBe(copied("subtree", "service.json", JSON_TEXT));
  });

  it("copies the whole document when nothing is selected", async () => {
    await open("service.json", JSON_TEXT);
    expect(copied("jsonPath", "service.json", JSON_TEXT)).toBe("$");
    expect(copied("jq", "service.json", JSON_TEXT)).toBe(".");
    expect(JSON.parse(copied("subtree", "service.json", JSON_TEXT))).toEqual(JSON.parse(JSON_TEXT));
  });

  it("ignores a selection from a document the reader has since replaced", async () => {
    await open("service.json", JSON_TEXT);
    select("name");
    await open("service.json", JSON_TEXT);
    expect(copied("jsonPath", "service.json", JSON_TEXT)).toBe("$");
  });

  it("says so where the view shows no value", async () => {
    await open("service.json", JSON_TEXT);
    const summary = [...root.querySelectorAll("p")].find(p => p.textContent?.startsWith("JSON ·"))!;
    getSelection()!.collapse(summary.firstChild!, 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(dataCopy("value", { name: "service.json", text: JSON_TEXT }, root)).toEqual({ problem: expect.stringContaining("no value") });
  });

  it("refuses Markdown and plain text", async () => {
    await open("notes.txt", "one\ntwo\n");
    expect(dataCopy("value", { name: "notes.txt", text: "one\ntwo\n" }, root)).toEqual({ problem: expect.stringContaining("needs a JSON") });
    expect(dataCopy("value", { name: "a.md", text: "# a" }, root)).toEqual({ problem: expect.stringContaining("needs a JSON") });
  });
});

describe("copy by format", () => {
  it("JSON Lines: a record's cell names the record; jq reads the slurped array", async () => {
    const text = '{"event":"start","at":1}\n{"event":"stop","at":2}\n';
    await open("events.jsonl", text);
    select("stop");
    expect(copied("jsonPath", "events.jsonl", text)).toBe("$[1]");
    expect(copied("jq", "events.jsonl", text)).toBe(".[1]");
    expect(copied("subtree", "events.jsonl", text)).toBe('{\n  "event": "stop",\n  "at": 2\n}');
    const result = dataCopy("jq", { name: "events.jsonl", text }, root);
    expect(result).toEqual({ text: ".[1]", done: expect.stringContaining("jq -s") });
  });

  it("YAML", async () => {
    const text = "name: demo\nports:\n  - 80\n  - 443\n";
    await open("app.yaml", text);
    select("ports");
    expect(copied("jsonPath", "app.yaml", text)).toBe("$.ports");
    expect(copied("subtree", "app.yaml", text)).toBe("[\n  80,\n  443\n]");
    expect(copied("value", "app.yaml", text)).toBe("[\n  80,\n  443\n]");
  });

  it("TOML", async () => {
    const text = 'title = "demo"\n[server]\nhost = "localhost"\n';
    await open("app.toml", text);
    select("title");
    expect(copied("value", "app.toml", text)).toBe("demo");
  });

  it("CSV: a cell names its row; the header names the table", async () => {
    const text = "name,age\nAda,36\nLin,41\n";
    await open("people.csv", text);
    select("41");
    expect(copied("jsonPath", "people.csv", text)).toBe("$[1]");
    expect(copied("subtree", "people.csv", text)).toBe('{\n  "name": "Lin",\n  "age": "41"\n}');
    select("name");
    expect(copied("jsonPath", "people.csv", text)).toBe("$");
  });
});

describe("a copied reference to a data document", () => {
  it("names the value path, not a readable-view line", async () => {
    const text = '{"a":1,"list":[{"id":1},{"id":2}]}';
    await open("x.json", text);
    expect(dataReference({ name: "x.json", text }, root)).toBe("");
    select("2");
    expect(dataReference({ name: "x.json", text }, root)).toBe("#$.list[1]");
    expect(dataReference({ name: "x.md", text: "# a" }, root)).toBeNull();
  });
});

describe("the readable view as a Markdown copy", () => {
  it("is exactly the render text under a .md name of its own", () => {
    const text = '{"a":1}';
    const copy = readableCopy({ name: "C:\\data\\service.v2.json", text })!;
    expect(copy.text).toBe(renderTextOf("C:\\data\\service.v2.json", text).text);
    expect(copy.text).not.toBe(text);
    expect(copy.name).toBe("service.v2.readable.md");
    expect(readableCopy({ name: "notes.md", text: "# a" })).toBeNull();
  });
});
