import { describe, expect, it } from "vitest";
import { markdownCommand } from "../src/ui/MarkdownCommands";
import type { MarkdownCommand, MarkdownSelection } from "../src/ui/MarkdownCommands";

function apply(source: string, command: MarkdownCommand, start = 0, end = source.length,
  direction: MarkdownSelection["direction"] = "forward") {
  const change = markdownCommand(source, { start, end, direction }, command);
  if (!change) throw new Error(`Command ${command} was refused`);
  const text = source.slice(0, change.start) + change.text + source.slice(change.end);
  return { text, selection: change.selection, selected: text.slice(change.selection.start, change.selection.end) };
}

describe("Markdown writing commands", () => {
  it.each([
    ["bold", "**text**", "text"], ["italic", "*text*", "text"],
    ["inline-code", "`code`", "code"], ["code-block", "```\n\n```", ""],
    ["link", "[text](url)", "text"], ["heading-1", "# ", ""],
    ["heading-2", "## ", ""], ["heading-3", "### ", ""],
    ["unordered-list", "- ", ""], ["ordered-list", "1. ", ""], ["task-list", "- [ ] ", ""],
  ] as const)("inserts a useful %s template in an empty document", (command, text, selected) => {
    expect(apply("", command)).toMatchObject({ text, selected });
  });

  it.each(["bold", "italic", "inline-code", "code-block", "heading-1", "heading-2", "heading-3",
    "unordered-list", "ordered-list", "task-list"] as const)("toggles %s back from its returned selection", (command) => {
    const added = apply("日本語 🧑🏽‍💻 café", command, 0, 16, "backward");
    const removed = apply(added.text, command, added.selection.start, added.selection.end, added.selection.direction);
    expect(removed.text).toBe("日本語 🧑🏽‍💻 café");
    expect(removed.selection.direction).toBe("backward");
  });

  it("preserves Unicode content, backward selection, and unselected text", () => {
    const result = apply("left 🧑🏽‍💻 café right", "bold", 5, 17, "backward");
    expect(result.text).toBe("left **🧑🏽‍💻 café** right");
    expect(result.selected).toBe("🧑🏽‍💻 café");
    expect(result.selection).toEqual({ start: 7, end: 19, direction: "backward" });
  });

  it("keeps nested emphasis independent", () => {
    const italic = apply("**word**", "italic", 2, 6);
    expect(italic.text).toBe("***word***");
    expect(apply(italic.text, "italic", italic.selection.start, italic.selection.end).text).toBe("**word**");
    expect(apply("***word***", "bold", 3, 7).text).toBe("*word*");
  });

  it.each(["bold", "italic"] as const)("toggles multiline %s without changing blank lines or whitespace", (command) => {
    const source = "  first  \n\n\tsecond\t";
    const added = apply(source, command);
    const marker = command === "bold" ? "**" : "*";
    expect(added.text).toBe(`  ${marker}first${marker}  \n\n\t${marker}second${marker}\t`);
    expect(apply(added.text, command).text).toBe(source);
  });

  it("adds missing emphasis in a mixed multiline selection", () => {
    expect(apply("**first**\nsecond", "bold").text).toBe("**first**\n**second**");
  });

  it.each(["bold", "italic"] as const)("keeps whitespace outside the %s selection and toggles cleanly", (command) => {
    const result = apply("  word \t", command, 0, 8, "backward");
    expect(result.selected).toBe("word");
    expect(apply(result.text, command, result.selection.start, result.selection.end).text).toBe("  word \t");
    expect(apply(result.text, command).text).toBe("  word \t");
  });

  it.each([["bold", "__word__", 2, 6], ["italic", "_word_", 1, 5]] as const)(
    "recognizes underscore %s markup with either complete or content selection", (command, source, start, end) => {
      expect(apply(source, command).text).toBe("word");
      expect(apply(source, command, start, end).text).toBe("word");
    });

  it.each(["a`b", "`edge", "edge`", " both ", "   "])("uses safe, reversible code delimiters for %j", (source) => {
    const added = apply(source, "inline-code");
    expect(added.selected).toBe(source);
    expect(apply(added.text, "inline-code", added.selection.start, added.selection.end).text).toBe(source);
  });

  it("uses a fence longer than embedded backticks and preserves line content", () => {
    const source = "one\n```js\ncode\n```\nlast";
    const result = apply(source, "code-block");
    expect(result.text).toBe(`\`\`\`\`\n${source}\n\`\`\`\``);
    expect(apply(result.text, "code-block", result.selection.start, result.selection.end).text).toBe(source);
  });

  it("unwraps a selected existing language-tagged or tilde fenced block", () => {
    expect(apply("```ts\nlet x = 1;\n```", "code-block").text).toBe("let x = 1;");
    expect(apply("~~~py\nprint(1)\n~~~", "code-block").text).toBe("print(1)");
  });

  it("wraps multiple fenced blocks without stripping unrelated opening and closing fences", () => {
    const source = "```js\none\n```\n\n```js\ntwo\n```";
    const result = apply(source, "code-block");
    expect(result.selected).toBe(source);
    expect(result.text.startsWith("````\n")).toBe(true);
    expect(apply(result.text, "code-block", result.selection.start, result.selection.end).text).toBe(source);
  });

  it("selects a new link destination and removes complete or label-selected simple links", () => {
    expect(apply("example", "link")).toMatchObject({ text: "[example](url)", selected: "url" });
    expect(apply("[example](https://example.test)", "link").text).toBe("example");
    expect(apply("a [example](url) z", "link", 3, 10).text).toBe("a example z");
  });

  it.each(["inline-code", "link"] as const)("refuses multiline %s without a partial edit", (command) => {
    expect(markdownCommand("one\ntwo", { start: 0, end: 7, direction: "none" }, command)).toBeNull();
  });

  it("formats whole affected lines, excludes the next line at an end boundary, and preserves indentation", () => {
    expect(apply("before\n  first\n  second\nafter", "heading-2", 10, 23).text)
      .toBe("before\n  ## first\n  ## second\nafter");
    expect(apply("one\ntwo", "unordered-list", 0, 4).text).toBe("- one\ntwo");
  });

  it("replaces heading levels and removes the requested existing level", () => {
    expect(apply("# one\n### two", "heading-2").text).toBe("## one\n## two");
    expect(apply("## one\n## two", "heading-2").text).toBe("one\ntwo");
  });

  it("converts mixed list kinds, retains task checks, and skips blank lines", () => {
    const source = "* one\n\n2) two\n- [x] done";
    expect(apply(source, "ordered-list").text).toBe("1. one\n\n2. two\n3. done");
    expect(apply(source, "task-list").text).toBe("- [ ] one\n\n- [ ] two\n- [x] done");
    expect(apply("- [ ] one\n- [x] done", "task-list").text).toBe("one\ndone");
  });

  it("keeps a collapsed caret at its content offset when line prefixes change", () => {
    expect(apply("hello", "heading-2", 2, 2).selection).toEqual({ start: 5, end: 5, direction: "forward" });
    expect(apply("## hello", "heading-2", 5, 5).selection).toEqual({ start: 2, end: 2, direction: "forward" });
    expect(apply("\nnext", "unordered-list", 0, 0).text).toBe("- \nnext");
  });

  it.each([[-1, 1], [2, 1], [0, 99], [0.5, 1], [0, 2], [2, 2]])(
    "refuses invalid or surrogate-splitting offsets %s..%s", (start, end) => {
      expect(markdownCommand("a😀z", { start, end, direction: "none" }, "bold")).toBeNull();
    });
});
