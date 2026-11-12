import { describe, it, expect } from "vitest";
import { createMarkdown, renderMarkdown, renderMarkdownTokens } from "../src/render/markdown";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { readFrontMatter } from "../src/render/frontmatter";
import {
  collectFences, installSourceMap, sectionRange, selectionRange, sliceSource, sourceLines, stampSourceMap,
  type ReaderSource,
} from "../src/desktop/reader/sourcemap";

/** The reader's mapping steps, without Shiki or Mermaid. */
function map(text: string): { root: HTMLElement; source: ReaderSource } {
  const md = createMarkdown(null, DEFAULT_SETTINGS);
  const env = {};
  const tokens = md.parse(readFrontMatter(text).body, env);
  const lines = sourceLines(text);
  stampSourceMap(tokens, lines);
  installSourceMap(md);
  const root = document.createElement("div");
  root.innerHTML = renderMarkdownTokens(md, tokens, env).html;
  document.body.replaceChildren(root);
  return { root, source: { lines, fences: collectFences(tokens) } };
}

const src = (root: HTMLElement, selector: string): (string | null)[] =>
  [...root.querySelectorAll(selector)].map(node => node.getAttribute("data-src"));

describe("reader source map", () => {
  it("maps headings, paragraphs, fences, callouts and math to 1-based inclusive lines", () => {
    const { root } = map("# Title\n\nOne\ntwo\n\n```js\nx\n```\n\n::: note\nInside\n:::\n\n$$\na\n$$\n");
    expect(src(root, "h1")).toEqual(["1-1"]);
    expect(src(root, ":scope > p")).toEqual(["3-4", "14-16"]); // KaTeX renders display math as a p
    expect(src(root, "pre")).toEqual(["6-8"]);
    expect(src(root, ".callout")).toEqual(["10-12"]);
    expect(root.querySelector(".callout p:not(.callout-title)")?.getAttribute("data-src")).toBe("11-11");
  });

  it("maps lists and their items, tables and rows, nested blockquotes", () => {
    const { root } = map("- a\n- b\n  continued\n\n| h |\n| - |\n| 1 |\n| 2 |\n\n> outer\n>\n> > inner\n");
    expect(src(root, "ul")).toEqual(["1-3"]);
    expect(src(root, "li")).toEqual(["1-1", "2-3"]);
    expect(src(root, "table")).toEqual(["5-8"]);
    expect(src(root, "tbody tr")).toEqual(["7-7", "8-8"]);
    expect(src(root, "blockquote")).toEqual(["10-12", "12-12"]);
  });

  it("keeps original line numbers after front matter", () => {
    const { root } = map("---\nname: x\n---\n\n# After\n");
    expect(src(root, "h1")).toEqual(["5-5"]);
  });

  it("clamps ranges to the document and keeps the paginated renderer unmapped", () => {
    const { root, source } = map("text");
    expect(src(root, "p")).toEqual(["1-1"]);
    expect(source.lines).toEqual(["text"]);
    expect(renderMarkdown(createMarkdown(null, DEFAULT_SETTINGS), "# A\n\n```js\nx\n```\n").html).not.toContain("data-src");
  });

  it("keeps fence bodies exactly, including nested fences", () => {
    const { source } = map("```js\n  indented\n\ttab\n```\n\n> ```\n> quoted\n> ```\n");
    expect(source.fences.get(1)).toBe("  indented\n\ttab");
    expect(source.fences.get(6)).toBe("quoted");
  });
});

describe("sections and selections", () => {
  const text = "# A\n\nintro\n\n## B\n\nb text\n\n### C\n\nc\n\n## D\n\nd\n";

  it("a section runs to the next heading of the same or higher level", () => {
    const { root, source } = map(text);
    const [a, b, c, d] = [...root.querySelectorAll<HTMLElement>("h1,h2,h3")];
    expect(sectionRange(a!, source.lines.length)).toEqual([1, 16]);
    expect(sliceSource(source, ...sectionRange(b!, source.lines.length)!)).toBe("## B\n\nb text\n\n### C\n\nc");
    expect(sectionRange(c!, source.lines.length)).toEqual([9, 12]);
    expect(sliceSource(source, ...sectionRange(d!, source.lines.length)!)).toBe("## D\n\nd");
  });

  it("a selection maps to the union of the blocks it touches", () => {
    const { root, source } = map(text);
    const range = document.createRange();
    range.setStart(root.querySelector("h2")!.firstChild!, 0);
    range.setEnd(root.querySelectorAll("p")[2]!.firstChild!, 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionRange(root, selection)).toEqual([5, 11]);
    expect(sliceSource(source, 5, 11)).toBe("## B\n\nb text\n\n### C\n\nc");
    selection.collapseToStart();
    expect(selectionRange(root, selection)).toBeNull();
  });

  function select(setup: (range: Range) => void): Selection {
    const range = document.createRange();
    setup(range);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
  }

  it("includes raw HTML blocks and out-of-order footnote definitions the selection covers", () => {
    const { root } = map("Para one.[^1]\n\n[^1]: The note.\n\n<div>Raw block</div>\n\nLater.\n");
    expect(src(root, "div")).toEqual(["5-5"]);
    const selection = select(range => {
      range.setStart(root.querySelector("div")!.firstChild!, 0);
      range.setEnd(root.querySelector(".footnotes p")!.firstChild!, 3);
    });
    expect(selectionRange(root, selection)).toEqual([3, 7]);
  });

  it("does not count a block the selection only touches at its start", () => {
    const { root } = map("First.\n\nSecond.\n");
    const [first, second] = root.querySelectorAll("p");
    const selection = select(range => { range.setStart(first!.firstChild!, 0); range.setEnd(second!.firstChild!, 0); });
    expect(selectionRange(root, selection)).toEqual([1, 1]);
  });

  it("ignores selections outside the document", () => {
    const { root } = map(text);
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(selectionRange(root, window.getSelection())).toBeNull();
  });
});
