import { describe, it, expect } from "vitest";
import { dataDocumentKind, prepareRenderText, renderTextOf, showAllOf, showMoreOf } from "../src/app/renderText";
import { isMarkdownFile } from "../src/app/input";

describe("renderTextOf, the one seam from document text to render text", () => {
  it("leaves Markdown as written", () => {
    expect(renderTextOf("notes.md", "# Hi\n")).toEqual({ text: "# Hi\n", data: null });
    expect(renderTextOf("Untitled.md", "")).toEqual({ text: "", data: null });
  });

  it("derives the readable view for a data document and keeps nothing else", () => {
    const view = renderTextOf("config.json", '{"name": "demo", "port": 8080}');
    expect(view.data?.kind).toBe("json");
    expect(view.data?.label).toBe("JSON");
    expect(view.text).toContain("# config\\.json"); // the title is escaped like every value
    expect(view.text).toContain("demo");
    expect(view.text).toContain("8080");
  });

  it("shows plain text literally, never as Markdown", () => {
    const view = renderTextOf("notes.txt", "# not a heading\n- [ ] not a task\n");
    expect(view.data?.label).toBe("Plain text");
    expect(view.text).toMatch(/```+\n# not a heading\n- \[ \] not a task\n```+/);
  });

  it("scales the budget for Show more and lifts it for Show all", () => {
    const text = Array.from({ length: 700 }, (_, index) => JSON.stringify({ n: index })).join("\n");
    expect(renderTextOf("log.jsonl", text).data?.readable.truncated).toBe(true);
    showMoreOf("log.jsonl");
    expect(renderTextOf("log.jsonl", text).data?.readable.truncated).toBe(false);
    const more = Array.from({ length: 3000 }, (_, index) => JSON.stringify({ n: index })).join("\n");
    expect(renderTextOf("big.jsonl", more).data?.readable.truncated).toBe(true);
    showAllOf("big.jsonl");
    expect(renderTextOf("big.jsonl", more).data?.readable.truncated).toBe(false);
  });

  it("opens every format src/data reads", () => {
    expect(["a.json", "a.jsonc", "a.jsonl", "a.ndjson", "a.txt", "a.log"].map(dataDocumentKind)).toEqual(["json", "json", "jsonl", "jsonl", "text", "text"]);
    expect(["a.yaml", "a.yml", "a.toml", "a.csv", "a.tsv"].map(dataDocumentKind)).toEqual(["yaml", "yaml", "toml", "csv", "csv"]);
    expect(["a.md", "a.xml", "a"].map(dataDocumentKind)).toEqual([null, null, null]);
    expect(isMarkdownFile("data.json", "application/json")).toBe(true);
    expect(isMarkdownFile("notes.txt", "text/plain")).toBe(true);
    expect(isMarkdownFile("sheet.csv", "text/csv")).toBe(true);
    expect(isMarkdownFile("feed.xml", "application/xml")).toBe(false);
  });
});

describe("prepareRenderText (D4: parsers that load on demand)", () => {
  it("prepares YAML before its view is derived; Markdown needs nothing", async () => {
    await expect(prepareRenderText("notes.md")).resolves.toBeUndefined();
    await prepareRenderText("config.yaml");
    const view = renderTextOf("config.yaml", "name: demo\nport: 8080\n");
    expect(view.data?.label).toBe("YAML");
    expect(view.text).toContain("demo");
    expect(view.text).toContain("8080");
    expect(renderTextOf("sheet.csv", "name,port\ndemo,8080\n").text).toContain("demo");
    expect(renderTextOf("config.toml", 'name = "demo"\n').text).toContain("demo");
  });
});
