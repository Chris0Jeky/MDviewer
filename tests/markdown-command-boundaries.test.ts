import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { markdownCommand, type MarkdownCommand, type MarkdownSelection } from "../src/ui/MarkdownCommands";

// Exercise the installed parser's semantics, independently of the source transform.
const markdown = new MarkdownIt();
const oneSidedInteriorRuns = [
  ["bold", "a *b"], ["bold", "a* b"], ["bold", "a\\\\*b"],
  ["italic", "a **b"], ["italic", "a** b"], ["italic", "a\\\\**b"],
] as const;

function transform(source: string, command: MarkdownCommand, start = 0, end = source.length) {
  return markdownCommand(source, { start, end, direction: "forward" }, command);
}

function apply(source: string, command: MarkdownCommand, start = 0, end = source.length) {
  const change = transform(source, command, start, end);
  expect(change).not.toBeNull();
  if (!change) throw new Error(`Command ${command} was refused`);
  return {
    text: source.slice(0, change.start) + change.text + source.slice(change.end),
    selection: change.selection,
  };
}

describe.each(["bold", "italic"] as const)("parser-backed %s boundaries", (command) => {
  const marker = command === "bold" ? "**" : "*";
  const tag = command === "bold" ? "strong" : "em";

  it.each([
    ["punctuation inside a word", "foo-bar", 3, 4],
    ["punctuation at the opening edge", "foo(bar)", 3, 7],
    ["punctuation at the closing edge", "foo(bar)baz", 4, 8],
    ["a Unicode currency symbol", "a€b", 1, 2],
    ["an astral emoji symbol", "a😀b", 1, 3],
    ["astral punctuation", "a𐄀b", 1, 3],
    ["a lone surrogate treated as a replacement symbol", "a\ud800b", 1, 2],
    ["non-Markdown whitespace outside punctuation", "\ufeff-\ufeff", 1, 2],
  ] as const)("refuses %s that would leave literal markers", (_name, source, start, end) => {
    const naive = source.slice(0, start) + marker + source.slice(start, end) + marker + source.slice(end);
    expect(markdown.renderInline(naive)).not.toContain(`<${tag}>`);
    expect(transform(source, command, start, end)).toBeNull();
  });

  it.each([
    ["intraword letters", "foobarbaz", 3, 6, "foo", "bar", "baz"],
    ["outside parentheses", "foo(bar)baz", 4, 7, "foo(", "bar", ")baz"],
    ["astral symbols outside punctuation", "😀-😀", 2, 3, "😀", "-", "😀"],
    ["trimmed nonbreaking spaces", "a\u00a0x\u00a0b", 1, 4, "a\u00a0", "x", "\u00a0b"],
    ["trimmed Unicode spaces", "a\u2003-\u2003b", 1, 4, "a\u2003", "-", "\u2003b"],
  ] as const)("preserves valid %s", (_name, source, start, end, before, content, after) => {
    const result = apply(source, command, start, end);
    expect(markdown.renderInline(result.text)).toBe(`${before}<${tag}>${content}</${tag}>${after}`);
    expect(result.text.slice(result.selection.start, result.selection.end)).toBe(content);
  });

  it("refuses the whole multiline edit when one selected edge cannot open emphasis", () => {
    const source = "foo-bar\nsafe";
    expect(transform(source, command, 3, source.length)).toBeNull();
  });
});

describe("parser-backed existing emphasis recognition", () => {
  it.each([
    ["bold", "foo**-**bar", 3, 8],
    ["bold", "foo**-**bar", 5, 6],
    ["italic", "foo*-*bar", 3, 6],
    ["bold", "a**😀**b", 1, 7],
    ["italic", "\u200d_foo_\u200d", 1, 6],
    ["bold", "\u200d__foo__\u200d", 1, 8],
    ["italic", "\u2028_foo_\u2028", 1, 6],
    ["bold", "\ufeff__foo__\ufeff", 1, 8],
  ] as const)("does not delete literal %s markers in %j [%i,%i]", (command, source, start, end) => {
    expect(markdown.renderInline(source)).toBe(source);
    expect(transform(source, command, start, end)).toBeNull();
  });

  it.each([
    ["bold", "(**-**)", 1, 6, "(<strong>-</strong>)", "(-)"],
    ["bold", "**😀**", 0, 6, "<strong>😀</strong>", "😀"],
    ["italic", "😀_foo_😀", 2, 7, "😀<em>foo</em>😀", "😀foo😀"],
  ] as const)("still unwraps real %s markup in %j", (command, source, start, end, html, plain) => {
    expect(markdown.renderInline(source)).toBe(html);
    expect(apply(source, command, start, end).text).toBe(plain);
  });

  it.each([
    ["bold", "*ab"], ["bold", "ab*"], ["bold", "*a*b*"],
    ["italic", "**ab"], ["italic", "ab**"], ["italic", "**a**b**"],
  ] as const)("refuses unmatched opposite-width edges for %s in %j", (command, source) => {
    const marker = command === "bold" ? "**" : "*";
    const tag = command === "bold" ? "strong" : "em";
    expect(markdown.renderInline(marker + source + marker))
      .not.toBe(`<${tag}>${markdown.renderInline(source)}</${tag}>`);
    expect(transform(source, command)).toBeNull();
  });

  it.each([
    ["bold", "*word*", 0, 6], ["bold", "*word*", 1, 5],
    ["italic", "**word**", 0, 8], ["italic", "**word**", 2, 6],
  ] as const)("keeps balanced nested %s reversible for %j [%i,%i]", (command, source, start, end) => {
    const result = apply(source, command, start, end);
    expect(markdown.renderInline(result.text)).toBe("<em><strong>word</strong></em>");
    const selection: MarkdownSelection = result.selection;
    expect(apply(result.text, command, selection.start, selection.end).text).toBe(source);
  });
});

describe("parser-backed escapes and link identity", () => {
  it("keeps an escaped trailing star inside real Bold", () => {
    const source = "word\\*";
    const result = apply(source, "bold");
    expect(markdown.renderInline(result.text)).toBe("<strong>word*</strong>");
    expect(result.text.slice(result.selection.start, result.selection.end)).toBe(source);
  });

  it.each([
    ["bold", "a\\***b"], ["bold", "a\\**b"],
    ["italic", "a\\**b"], ["italic", "a\\***b"],
  ] as const)("refuses %s when an escaped first star leaves an active interior closer in %j", (command, source) => {
    const marker = command === "bold" ? "**" : "*";
    const tag = command === "bold" ? "strong" : "em";
    expect(markdown.renderInline(marker + source + marker))
      .not.toBe(`<${tag}>${markdown.renderInline(source)}</${tag}>`);
    expect(transform(source, command)).toBeNull();
  });

  it.each([
    ["bold", "**a\\***b**"], ["bold", "**a\\**b**"],
    ["italic", "*a\\**b*"], ["italic", "*a\\***b*"],
  ] as const)("does not unwrap a %s range split by an active closer after an escape in %j", (command, source) => {
    const width = command === "bold" ? 2 : 1;
    const tag = command === "bold" ? "strong" : "em";
    expect(markdown.renderInline(source))
      .not.toBe(`<${tag}>${markdown.renderInline(source.slice(width, -width))}</${tag}>`);
    expect(transform(source, command)).toBeNull();
  });

  it.each(["bold", "italic"] as const)("keeps a single escaped interior star literal inside %s", (command) => {
    const tag = command === "bold" ? "strong" : "em";
    expect(markdown.renderInline(apply("a\\*b", command).text)).toBe(`<${tag}>a*b</${tag}>`);
  });

  it.each(oneSidedInteriorRuns)("refuses %s around a one-sided interior run in %j", (command, source) => {
    const marker = command === "bold" ? "**" : "*";
    const tag = command === "bold" ? "strong" : "em";
    expect(markdown.renderInline(marker + source + marker))
      .not.toBe(`<${tag}>${markdown.renderInline(source)}</${tag}>`);
    expect(transform(source, command)).toBeNull();
  });

  it.each(oneSidedInteriorRuns)("does not unwrap a %s range consumed by the interior run in %j", (command, body) => {
    const marker = command === "bold" ? "**" : "*";
    const source = marker + body + marker;
    const tag = command === "bold" ? "strong" : "em";
    expect(markdown.renderInline(source)).not.toBe(`<${tag}>${markdown.renderInline(body)}</${tag}>`);
    expect(transform(source, command)).toBeNull();
  });

  it.each([
    ["bold", "a*b", "strong"], ["italic", "a**b", "em"],
  ] as const)("keeps both-flanking interior markers literal inside %s in %j", (command, source, tag) => {
    const result = apply(source, command);
    expect(markdown.renderInline(result.text)).toBe(`<${tag}>${source}</${tag}>`);
    expect(apply(result.text, command, result.selection.start, result.selection.end).text).toBe(source);
  });

  it.each(["bold", "italic"] as const)("keeps odd/even empty-caret escapes safe for %s", (command) => {
    expect(transform("\\", command, 1, 1)).toBeNull();
    const tag = command === "bold" ? "strong" : "em";
    expect(markdown.renderInline(apply("\\\\", command, 2, 2).text))
      .toBe(`\\<${tag}>text</${tag}>`);
  });

  it.each([
    ["!word", 1, 5], ["!", 1, 1], ["\\\\!word", 3, 7],
  ] as const)("refuses a new link after an active image opener in %j", (source, start, end) => {
    const label = source.slice(start, end) || "text";
    const naive = source.slice(0, start) + `[${label}](url)` + source.slice(end);
    expect(markdown.renderInline(naive)).toContain("<img ");
    expect(transform(source, "link", start, end)).toBeNull();
  });

  it.each([
    ["\\!word", 2, 6, "word"], ["\\!", 2, 2, "text"],
  ] as const)("keeps the escaped exclamation and creates a real link in %j", (source, start, end, label) => {
    expect(markdown.renderInline(apply(source, "link", start, end).text))
      .toBe(`!<a href="url">${label}</a>`);
  });
});
