import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { getHighlighter, getReaderHighlighter } from "../src/render/highlight";
import { renderReaderDocument } from "../src/desktop/render";
import { createMarkdown, renderMarkdown } from "../src/render/markdown";

// Keep the real renderer and real grammar engine. Observe only the cold-start
// boundary; asserting the rendered document prevents an inert stub from passing.
vi.mock("../src/render/highlight", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/render/highlight")>();
  return { ...actual, getReaderHighlighter: vi.fn(actual.getReaderHighlighter) };
});
// Diagram layout is outside this grammar test; retain its prepared source node.
vi.mock("../src/render/mermaid", () => ({ renderAllMermaid: async () => ({ failed: 0 }) }));
beforeEach(() => { vi.mocked(getReaderHighlighter).mockClear(); });

describe("reader syntax highlighting admission", () => {
  // Run the cold curated-grammar control first: a preceding literal fence
  // example must not accidentally preload C# and mask failed discovery.
  it("loads the actual curated grammar for code nested in a blockquote", async () => {
    const result = await renderReaderDocument("# Quoted code\n\n> ```cs\n> public record Person(string Name);\n> ```", DEFAULT_SETTINGS);
    expect(result.document.querySelector("blockquote pre.shiki code")?.textContent).toContain("public record Person(string Name);");
    expect(result.document.querySelectorAll("blockquote pre.shiki code span[style]").length).toBeGreaterThan(1);
    expect(getReaderHighlighter).toHaveBeenCalledTimes(1);
    expect(result.warnings).toEqual([]);
  }, 30_000);

  it("renders prose, mathematics, callouts, TOC and footnotes without initializing Shiki", async () => {
    const result = await renderReaderDocument("# Plain notes\n\n[[toc]]\n\n## Mathematics\n\n$x^2$ and a note.[^a]\n\n::: tip\nRead locally.\n:::\n\n[^a]: Endnote text.", DEFAULT_SETTINGS);
    expect(result.document.querySelector("h1")?.textContent).toBe("Plain notes");
    expect(result.document.querySelector(".katex")).not.toBeNull();
    expect(result.document.querySelector(".callout-tip")?.textContent).toContain("Read locally.");
    expect(result.document.querySelector(".footnotes")?.textContent).toContain("Endnote text.");
    expect(result.document.querySelector('.toc a[href="#mathematics"]')).not.toBeNull();
    expect(result.warnings).toEqual([]);
    expect(getReaderHighlighter).not.toHaveBeenCalled();
  });

  for (const language of ["", "text", "plaintext", "txt", "unbundled-example"]) {
    it(`keeps the ${language || "unlabelled"} fence readable without a grammar engine`, async () => {
      const result = await renderReaderDocument(`# Plain code\n\n\`\`\`${language}\n<script>literal code</script>\n\`\`\``, DEFAULT_SETTINGS);
      expect(result.document.querySelector("pre code")?.textContent?.trimEnd()).toBe("<script>literal code</script>");
      expect(result.document.querySelector("script")).toBeNull();
      expect(getReaderHighlighter).not.toHaveBeenCalled();
      expect(result.warnings.length).toBe(language === "unbundled-example" ? 1 : 0);
    });
  }

  it("does not mistake literal fence examples inside a longer text fence for executable grammar requests", async () => {
    const source = "# Fence examples\n\n````text\n```cs\npublic record Person;\n```\n````";
    const result = await renderReaderDocument(source, DEFAULT_SETTINGS);
    expect(result.document.querySelectorAll("pre code")).toHaveLength(1);
    expect(result.document.querySelector("pre code")?.textContent).toContain("```cs");
    expect(getReaderHighlighter).not.toHaveBeenCalled();
    expect(result.warnings).toEqual([]);
  });

  it("warns for a real unknown fence inside a blockquote without initializing Shiki", async () => {
    const result = await renderReaderDocument("# Unknown code\n\n> ```unbundled-example\n> Visible source\n> ```", DEFAULT_SETTINGS);
    expect(result.document.querySelector("blockquote pre code")?.textContent?.trimEnd()).toBe("Visible source");
    expect(result.warnings).toEqual(['Code language "unbundled-example" is not bundled; rendered as plain text.']);
    expect(getReaderHighlighter).not.toHaveBeenCalled();
  });
  it("preserves explicitly requested plaintext line numbers", async () => {
    const result = await renderReaderDocument("# Numbered\n\n```text\nalpha\nbeta\n```", { ...DEFAULT_SETTINGS, showLineNumbers: true });
    expect(result.document.querySelectorAll("pre.shiki.with-line-numbers .line")).toHaveLength(2);
    expect(getReaderHighlighter).toHaveBeenCalledOnce();
  });

  it.each(["text", "", "unbundled-example"])("preserves case-insensitive notation in %s fences", async language => {
    const source = `\`\`\`${language}\n// [!CODE highlight]\nalpha\n\`\`\``;
    const eager = renderMarkdown(createMarkdown(await getHighlighter(), DEFAULT_SETTINGS), source);
    const reference = document.createElement("div");
    reference.innerHTML = eager.html;
    expect(reference.querySelector(".line.highlighted")?.textContent).toBe("alpha");
    vi.mocked(getReaderHighlighter).mockClear();
    const result = await renderReaderDocument(source, DEFAULT_SETTINGS);
    expect(result.document.querySelector(".line.highlighted")?.textContent).toBe("alpha");
    expect(result.document.querySelector("pre code")?.textContent).not.toContain("[!CODE");
    expect(getReaderHighlighter).toHaveBeenCalledOnce();
  });

  it("preserves plaintext metadata highlighting", async () => {
    // A trailing {...} is consumed by markdown-it-attrs before highlighting.
    // Keep a trailing metadata word so this exercises actual Shiki metadata.
    const source = "# Marked\n\n```text {2} title=example\nalpha\nbeta\n```";
    const eager = renderMarkdown(createMarkdown(await getHighlighter(), DEFAULT_SETTINGS), source);
    const reference = document.createElement("div");
    reference.innerHTML = eager.html;
    expect(reference.querySelector("pre.shiki .line.highlighted")?.textContent).toBe("beta");
    vi.mocked(getReaderHighlighter).mockClear();
    const result = await renderReaderDocument(source, DEFAULT_SETTINGS);
    expect(result.document.querySelector("pre.shiki .line.highlighted")?.textContent).toBe("beta");
    expect(getReaderHighlighter).toHaveBeenCalledOnce();
  });

  it.each([
    ["c\\+\\+", "int main() { return 0; }"],
    ["&#106;s", "const answer = 42;"],
  ])("preserves existing highlighting for decoded fence info %s", async (info, code) => {
    const source = `\`\`\`${info}\n${code}\n\`\`\``;
    const eager = renderMarkdown(createMarkdown(await getHighlighter(), DEFAULT_SETTINGS), source);
    const reference = document.createElement("div");
    reference.innerHTML = eager.html;
    expect(reference.querySelectorAll("pre.shiki span[style]").length).toBeGreaterThan(1);
    vi.mocked(getReaderHighlighter).mockClear();
    const result = await renderReaderDocument(source, DEFAULT_SETTINGS);
    expect(result.document.querySelectorAll("pre.shiki span[style]").length).toBeGreaterThan(1);
    expect(result.warnings).toEqual([]);
    expect(getReaderHighlighter).toHaveBeenCalledOnce();
  });

  it("preserves metadata separated by decoded spaces", async () => {
    const source = "```text&#32;{2}&#32;title=example\nalpha\nbeta\n```";
    const eager = renderMarkdown(createMarkdown(await getHighlighter(), DEFAULT_SETTINGS), source);
    const reference = document.createElement("div");
    reference.innerHTML = eager.html;
    expect(reference.querySelector("pre.shiki .line.highlighted")?.textContent).toBe("beta");
    vi.mocked(getReaderHighlighter).mockClear();
    const result = await renderReaderDocument(source, DEFAULT_SETTINGS);
    expect(result.document.querySelector("pre.shiki .line.highlighted")?.textContent).toBe("beta");
    expect(result.warnings).toEqual([]);
    expect(getReaderHighlighter).toHaveBeenCalledOnce();
  });

  it("warns once for the decoded unknown language without loading Shiki", async () => {
    const source = "```unknown\\-example\nliteral\n```\n\n```unknown-example\nother\n```";
    const result = await renderReaderDocument(source, DEFAULT_SETTINGS);
    expect(result.document.querySelectorAll("pre code")).toHaveLength(2);
    expect(result.warnings).toEqual(['Code language "unknown-example" is not bundled; rendered as plain text.']);
    expect(getReaderHighlighter).not.toHaveBeenCalled();
  });

  it.each(["CS", "language-cs"])("normalizes %s beside an encoded Mermaid fence", async label => {
    const source = `\`\`\`${label}\npublic record Person(string Name);\n\`\`\`\n\n\`\`\`&#109;ermaid\ngraph TD\nA-->B\n\`\`\``;
    const result = await renderReaderDocument(source, DEFAULT_SETTINGS);
    expect(result.document.querySelectorAll("pre.shiki span[style]").length).toBeGreaterThan(1);
    expect(result.document.querySelector("pre.shiki code")?.className).toBe("language-cs");
    expect(result.document.querySelector("code.language-mermaid")?.textContent).toContain("graph TD");
    expect(result.document.querySelector("code.language-mermaid")?.closest("pre")?.classList.contains("shiki")).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(getReaderHighlighter).toHaveBeenCalledOnce();
  });

  it("does not warn for unknown fence labels that are only literal code examples", async () => {
    const result = await renderReaderDocument("# Literal example\n\n````text\n```not-a-language\nexample\n```\n````", DEFAULT_SETTINGS);
    expect(result.document.querySelector("pre code")?.textContent).toContain("not-a-language");
    expect(result.warnings).toEqual([]);
    expect(getReaderHighlighter).not.toHaveBeenCalled();
  });

});
