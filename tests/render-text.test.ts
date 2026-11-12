import { describe, it, expect } from "vitest";
import { dataDocumentKind, renderTextOf } from "../src/app/renderText";
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
    expect(renderTextOf("log.jsonl", text, 2).data?.readable.truncated).toBe(false);
    expect(renderTextOf("log.jsonl", text, Infinity).data?.readable.truncated).toBe(false);
  });

  it("opens only the version 1 formats", () => {
    expect(["a.json", "a.jsonc", "a.jsonl", "a.ndjson", "a.txt", "a.log"].map(dataDocumentKind)).toEqual(["json", "json", "jsonl", "jsonl", "text", "text"]);
    expect(["a.yaml", "a.toml", "a.csv", "a.md", "a"].map(dataDocumentKind)).toEqual([null, null, null, null, null]);
    expect(isMarkdownFile("data.json", "application/json")).toBe(true);
    expect(isMarkdownFile("notes.txt", "text/plain")).toBe(true);
    expect(isMarkdownFile("sheet.csv", "text/csv")).toBe(false);
  });
});
