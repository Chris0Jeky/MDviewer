import { beforeAll, describe, expect, it } from "vitest";
import { copyValue, prepare, toReadable, valueAt } from "../src/data";
import { cellText } from "../src/data/escape";
import { createMarkdown, renderMarkdown } from "../src/render/markdown";
import { DEFAULT_SETTINGS } from "../src/app/settings";

const user = { role: "user", content: "Hello" };
const assistant = { role: "assistant", content: "**Hello**" };
const view = (records: unknown[], options = {}) => toReadable(JSON.stringify(records), "json", options);

describe("conversation recognition", () => {
  it("requires two matching records and at least 60% of every record", () => {
    expect(view([user]).markdown).not.toContain("turn:");
    expect(view([user, assistant]).markdown).toContain("2 turns: 1 user, 1 assistant");
    expect(view([user, assistant, {}]).markdown).toContain("2 turns:");
    expect(view([user, assistant, {}, {}]).markdown).not.toContain("turns:");
    expect(view([user, assistant, user, {}, {}]).markdown).toContain("3 turns:");
    expect(view([{ role: "user" }, { role: "assistant" }]).markdown).not.toContain("turns:");
    expect(view([{ role: "user", content: ["bad"] }, assistant]).markdown).not.toContain("turns:");
    expect(view([{ role: 1, content: "bad" }, assistant]).markdown).not.toContain("turns:");
    expect(view([{ role: "custom", content: [] }, { role: "developer", content: "" }]).markdown).toContain("2 turns: 1 custom, 1 developer");
  });

  it("uses shape for JSONC, requests and JSON Lines, including invalid records in the denominator", () => {
    expect(toReadable(`/* chat */ ${JSON.stringify([user, assistant])}`, "json").markdown).toContain("2 turns:");
    const request = toReadable(JSON.stringify({ messages: [user, assistant], model: "invented", temperature: 1 }), "json");
    expect(request.markdown.indexOf("invented")).toBeLessThan(request.markdown.indexOf("## User"));
    expect([...request.map.values()]).toContain("$.messages[1].content");
    const lines = [user, assistant, { event: "ready" }].map(r => JSON.stringify(r));
    expect(toReadable([...lines, "bad"].join("\n"), "jsonl").markdown).not.toContain("turns:");
    const matched = toReadable([lines[0], "bad", lines[1]].join("\n"), "jsonl");
    expect(matched.markdown).toContain("2 turns:");
    expect(matched.markdown).toContain("Record 2 &#40;not a message&#41;");
    expect(matched.markdown).toContain("## Problems");
    expect(matched.problems[0]?.line).toBe(2);
    expect(matched.markdown).toContain("```\nbad\n```");
  });

  it("leaves ambiguous duplicate discriminators to the generic lens", () => {
    const result = toReadable('[{"role":"user","role":"other","content":"one"},{"role":"assistant","content":"two"}]', "json");
    expect(result.markdown).not.toContain("turns:");
    expect(result.markdown).toContain("other");
  });
});

describe("conversation layout and fidelity", () => {
  it("G9 labels only non-empty turns containing exclusively tool results, retaining the actual role", () => {
    const records = [assistant, { message: { role: "user", content: [{ type: "tool_result", content: "done" }] }, timestamp: "2026-01-01T00:00:00Z" },
      { role: "custom | role", content: [{ type: "tool_result", content: "one" }, { type: "tool_result", content: "two" }] },
      { role: "user", content: [] }, { role: "user", content: [{ type: "tool_result", content: "done" }, { type: "text", text: "Hi" }] }];
    const result = view(records, { timeZone: "UTC" });
    expect(result.markdown).toContain("## Tool result \\(user\\) · 2026\\-01\\-01 00\\:00 UTC");
    expect(result.markdown).toContain("## Tool result \\(custom \\| role\\)");
    expect(result.markdown.match(/^## User$/gm)).toHaveLength(2);
    expect(result.markdown).toContain("5 turns: 1 assistant, 3 user, 1 custom \\| role");
    expect(result.truncated).toBe(false);
    expect(toReadable(records.map(r => JSON.stringify(r)).join("\n"), "jsonl", { timeZone: "UTC" }).markdown).toContain("## Tool result \\(user\\)");
    const heading = result.markdown.split("\n").findIndex(s => s.startsWith("## Tool result")) + 1;
    expect(result.map.get(heading)).toBe("$[1]");
  });

  it("maps turn headings to records and text to its source path", () => {
    const result = view([user, { message: assistant, uuid: "invented-id", type: "event" }]);
    const lines = result.markdown.split("\n");
    expect(result.map.get(lines.indexOf("## Assistant") + 1)).toBe("$[1]");
    expect(result.map.get(lines.indexOf("> **Hello**") + 1)).toBe("$[1].message.content");
    expect(result.markdown).toContain("invented\\-id");
    expect(result.truncated).toBe(false);
  });

  it("keeps unknown records, content parts, metadata, empty values and duplicate metadata", () => {
    const records = [user, { role: "assistant", content: [
      { type: "novel", payload: "keep" }, { type: "text", text: "", extra: false },
      { type: "tool_use", input: {} }, { type: "thinking", thinking: "why" },
      { type: "text", text: 42 }, { type: "tool_result", result: "unfamiliar" },
    ] }, { other: [1, 2] }];
    const result = view(records);
    for (const text of ["keep", "extra", "false", "empty string", "Thinking", "why", "42", "unfamiliar", "Record 3 &#40;not a message&#41;"]) {
      expect(result.markdown).toContain(text);
    }
    expect(result.truncated).toBe(false);
    const duplicate = toReadable('[{"role":"user","content":"hi","x":1,"x":2},{"role":"assistant","content":[]}]', "json");
    expect(duplicate.markdown).toContain("1");
    expect(duplicate.markdown).toContain("2");
    expect(duplicate.markdown).toContain("\\[\\]");
    expect(duplicate.truncated).toBe(false);
  });

  it("counts all roles and tools, sums usage, and formats wrapper/message timestamps in the selected zone", () => {
    const result = view([
      { timestamp: "2026-01-01T00:00:00Z", usage: { input_tokens: 2, output_tokens: 3 }, message: user },
      { role: "assistant", timestamp: 1767312000, usage: { input_tokens: 5, output_tokens: 7 }, content: [
        { type: "tool_use", name: "Read", input: { path: "invented.md" } },
        { type: "tool_use", name: "Read", input: { path: "other.md" } },
        { type: "tool_use", name: "Bash", input: { command: "echo invented" } },
      ] },
    ], { timeZone: "UTC" });
    expect(result.markdown).toContain("tool calls: Read 2, Bash 1");
    expect(result.markdown).toContain("time span: 2026\\-01\\-01 00\\:00 UTC – 2026\\-01\\-02 00\\:00 UTC");
    expect(result.markdown).toContain("tokens: input\\_tokens: 7, output\\_tokens: 10");
    expect(result.markdown).toContain("## User · 2026\\-01\\-01 00\\:00 UTC");
    expect(result.truncated).toBe(false);
    expect(view([{ ...user, timestamp: "2026-01-01T00:00:00Z" }, assistant], { timeZone: "America/New_York" }).markdown)
      .toContain("2025\\-12\\-31 19\\:00 America\\/New\\_York");
    expect(view([{ ...user, timestamp: "2026-01-01T00:00:00Z" }, assistant], { timeZone: "invalid" }).markdown).toContain("00\\:00 UTC");
    const raw = toReadable('[{"role":"user","content":"x","usage":{"input_tokens":1.0,"output_tokens":12345678901234567890}},{"role":"assistant","content":"y"}]', "json");
    expect(raw.markdown).toContain("tokens: input\\_tokens: 1\\.0, output\\_tokens: 12345678901234567890");
  });

  it("summarises and collapses tools and thinking; suppresses image data", () => {
    const result = view([user, { role: "assistant", content: [
      { type: "text", text: "# Heading\n\n**Bold**" },
      { type: "tool_use", name: "Read", input: { command: "a".repeat(90) + "\nrest" } },
      { type: "tool_result", tool_use_id: "one", content: "first\nsecond" },
      { type: "thinking", thinking: "Maybe" },
      { type: "image", source: { media_type: "image/png", data: "NEVER_SHOW_THIS" } },
    ] }]);
    const md = createMarkdown(null, DEFAULT_SETTINGS);
    const root = document.createElement("div");
    root.innerHTML = renderMarkdown(md, result.markdown).html;
    // Three parts, the image source's other fields, and two metadata groups.
    expect(root.querySelectorAll("details > summary")).toHaveLength(6);
    expect(root.querySelector("summary")?.textContent).toBe("Tool call: Read · " + "a".repeat(80) + "…");
    expect(root.querySelector("blockquote h1")?.textContent).toBe("Heading");
    expect(root.querySelector("blockquote strong")?.textContent).toBe("Bold");
    expect(root.textContent).toContain("Thinking · 5 characters");
    expect(root.textContent).toContain("first\nsecond");
    expect(root.textContent).toContain("Image (image/png), data not shown (15 characters)");
    expect(result.markdown).not.toContain("NEVER_SHOW_THIS");
    expect(root.querySelector("img")).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("uses the first input string even when empty, and cuts summaries at 80 Unicode characters", () => {
    const result = view([user, { role: "assistant", content: [
      { type: "tool_use", name: "Empty", input: { nested: { first: "" }, later: "do not summarise me" } },
      { type: "tool_use", name: "Multiline", input: { command: "first\nsecond" } },
      { type: "tool_result", name: "Read", content: "😀".repeat(81) + "\nsecond" },
    ] }]);
    const root = document.createElement("div");
    root.innerHTML = renderMarkdown(createMarkdown(null, DEFAULT_SETTINGS), result.markdown).html;
    const summaries = Array.from(root.querySelectorAll("summary"), e => e.textContent);
    expect(summaries).toContain("Tool call: Empty · ");
    expect(summaries).toContain("Tool call: Multiline · first second");
    expect(summaries).toContain("Tool result: Read · " + "😀".repeat(80) + "…");
    expect(result.truncated).toBe(false);
  });

  it("keeps only message text on the deliberate Markdown path", () => {
    const result = view([user, { role: "assistant", content: [
      { type: "tool_use", name: "Read", input: { description: "# Input\n\n**Literal**" } },
      { type: "tool_result", content: "# Result\n\n**Literal**" },
      { type: "thinking", thinking: "# Thought\n\n**Literal**" },
    ] }]);
    const root = document.createElement("div");
    root.innerHTML = renderMarkdown(createMarkdown(null, DEFAULT_SETTINGS), result.markdown).html;
    expect(root.querySelectorAll("h1")).toHaveLength(1); // layout's document title only
    expect(root.querySelector("strong")).toBeNull();
    expect(root.textContent).toContain("# Input");
    expect(root.textContent).toContain("# Result");
  });

  it("quotes JSON-looking message text instead of expanding it as data", () => {
    const result = view([{ role: "user", content: '{"a":1}' }, { role: "assistant", content: [{ type: "text", text: '[1,2]' }] }]);
    expect(result.markdown).toContain('> {"a":1}');
    expect(result.markdown).toContain('> [1,2]');
    expect(result.markdown).not.toContain("JSON in a string");
    expect(result.truncated).toBe(false);
  });

  it("escapes arbitrary roles and maps every header", () => {
    const role = "<b>odd</b> | `name`\n# injected";
    const result = view([{ role, content: "hi" }, assistant]);
    expect(result.markdown).toContain(`## ${cellText(role)}`);
    expect(result.markdown).not.toContain("\n# injected");
  });
});

describe("conversation budgets", () => {
  it("omits an empty metadata table when it cannot afford its first row", () => {
    const result = view([{ ...user, items: [{ description: "hello", n: 1 }] }, assistant], { maxValues: 7 });
    expect(result.markdown).toContain("### items\n\n</details>");
  });

  it("uses the same value totals as the generic lens and never charges a value twice", () => {
    const source = JSON.stringify([user, assistant]); // list + two objects with two scalar members = 7 values
    expect(toReadable(source, "json", { maxValues: 7 }).truncated).toBe(false);
    expect(toReadable(source, "json", { maxValues: 0 }).markdown).toContain("Showing 0 of 7 values.");
    const partial = toReadable(source, "json", { maxValues: 4 });
    expect(partial.markdown).toContain("> Hello");
    expect(partial.markdown).not.toContain("## Assistant");
    expect(partial.markdown).toContain("Showing 4 of 7 values.");
    const request = toReadable(JSON.stringify({ model: "x", messages: [user, assistant] }), "json", { maxValues: 9 });
    expect(request.truncated).toBe(false);
    const parts = [user, { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { path: "one" } }] }];
    for (let maxValues = 0; maxValues < 15; maxValues++) {
      const limited = view(parts, { maxValues });
      expect((limited.markdown.match(/<details>/g) ?? []).length).toBe((limited.markdown.match(/<\/details>/g) ?? []).length);
    }
  });

  it("applies the default and custom JSON Lines record limits but reports full-file statistics and problems", () => {
    const records = Array.from({ length: 501 }, () => JSON.stringify(user));
    const full = toReadable(records.join("\n"), "jsonl");
    expect(full.markdown).toContain("501 turns: 501 user");
    expect(full.markdown).toContain("Showing 500 of 501 records.");
    const cut = toReadable([...records, "bad"].join("\n"), "jsonl", { maxRecords: 1 });
    expect(cut.markdown).toContain("Showing 1 of 502 records.");
    expect(cut.markdown).toContain("- Line 502,");
    expect(cut.problems).toHaveLength(1);
    expect(cut.truncated).toBe(true);
  });

  it("summarises a block-list tool result by its text, and keeps an image's other fields", () => {
    const result = view([user, { role: "assistant", content: [
      { type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: "file contents here" }] },
      { type: "image", source: { type: "url", url: "https://example.test/y.png" }, cache_control: { type: "ephemeral" } },
    ] }]);
    expect(result.markdown).toContain("Tool result · file contents here");
    expect(result.markdown).toContain("https\\:\\/\\/example\\.test\\/y\\.png");
    expect(result.markdown).toContain("ephemeral");
    expect(result.truncated).toBe(false);
  });
});

describe("image data with duplicate keys (verification of #273)", () => {
  it("withholds every data entry, even duplicated or at both levels", () => {
    const text = '[{"role":"user","content":"x"},{"role":"assistant","content":[{"type":"image","data":"PARTDATA","source":{"media_type":"image/png","data":"AAAA","data":"BBBB"}}]}]';
    const result = toReadable(text, "json");
    for (const secret of ["PARTDATA", "AAAA", "BBBB"]) expect(result.markdown).not.toContain(secret);
    expect(result.markdown).toContain("data not shown \\(16 characters\\)");
    expect(result.truncated).toBe(false);
  });
});

describe("conversations inside multi-document YAML (#291)", () => {
  beforeAll(() => prepare("yaml"));
  const NL = String.fromCharCode(10);
  const yaml = [
    "- {role: user, content: first question}",
    "- {role: assistant, content: first answer}",
    "---",
    "model: invented",
    "messages:",
    "  - {role: user, content: second question}",
    "  - {role: assistant, content: second answer}",
  ].join(NL);

  it("maps each turn to a path inside its own document, and those paths resolve", () => {
    const result = toReadable(yaml, "yaml");
    const lines = result.markdown.split(NL);
    const at = (text: string): string | undefined => result.map.get(lines.findIndex(l => l.includes(text)) + 1);
    expect(at("first answer")).toBe("$[0][1].content");
    expect(at("second answer")).toBe("$[1].messages[1].content");
    expect(at("invented")).toBe("$[1].model");
    for (const [text, expected] of [["first answer", "first answer"], ["second answer", "second answer"], ["invented", "invented"]] as const) {
      expect(copyValue(valueAt(yaml, "yaml", at(text)!)!)).toBe(expected);
    }
    for (const path of new Set(result.map.values())) expect(valueAt(yaml, "yaml", path), path).toBeDefined();
  });
});

describe("conversation lens accuracy (#278)", () => {
  const withTokens = (...values: string[]): string =>
    toReadable("[" + values.map((v, i) => `{"role":"${i % 2 ? "assistant" : "user"}","content":"x","usage":{"input_tokens":${v}}}`).join(",") + "]", "json").markdown;

  it("sums decimals exactly and never shows Infinity", () => {
    expect(withTokens("0.1", "0.2")).toContain("tokens: input\\_tokens: 0\\.3");
    expect(withTokens("1", "0.50", "2")).toContain("input\\_tokens: 3\\.5");
    expect(withTokens("1e999", "1")).not.toContain("Infinity");
    expect(withTokens("1e3", "2")).toContain("input\\_tokens: about 1002");
    expect(withTokens("12345678901234567890", "1")).toContain("input\\_tokens: 12345678901234567891");
  });

  it("a very long decimal is summed approximately, not digit by digit for every record (#326 review)", () => {
    const long = "0." + "1".repeat(200_000);
    const started = performance.now();
    const markdown = withTokens(long, ...Array.from({ length: 2_000 }, () => "1"));
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(markdown).toContain("input\\_tokens: about 2000\\.1");
  });

  it("recognises OpenAI tool-call turns whose content is null", () => {
    const call = (id: string): unknown => ({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "get_weather", arguments: "{}" } }] });
    const result = view([user, call("a"), call("b"), { role: "tool", tool_call_id: "a", content: "sunny" }]);
    expect(result.markdown).toContain("4 turns: 1 user, 2 assistant, 1 tool");
    expect(result.markdown).toContain("tool calls: get\\_weather 2");
    expect(result.markdown).not.toContain("not a message");
    expect(result.truncated).toBe(false);
  });

  it("gives the earliest and latest time, not the first and last in file order", () => {
    const at = (timestamp: string, role = "user"): unknown => ({ role, content: "x", timestamp });
    const result = view([at("2026-01-02T00:00:00Z"), at("2026-01-03T00:00:00Z", "assistant"), at("2026-01-01T00:00:00Z")], { timeZone: "UTC" });
    expect(result.markdown).toContain("time span: 2026\\-01\\-01 00\\:00 UTC – 2026\\-01\\-03 00\\:00 UTC");
  });

  it("does not count a JSON-looking role as an expansion that is never shown", () => {
    const result = view([{ role: '{"a":1}', content: "x" }, assistant]);
    expect(result.markdown).not.toContain("Showing");
    expect(result.truncated).toBe(false);
  });

  it("counts thinking in characters, and names an empty role", () => {
    const result = view([user, { role: "assistant", content: [{ type: "thinking", thinking: "\u{1F600}\u{1F600}" }] }, { role: "", content: "x" }]);
    expect(result.markdown).toContain("Thinking · 2 characters");
    expect(result.markdown).toContain("## \\(no role\\)");
    expect(result.markdown).toContain("1 \\(no role\\)");
  });
});
