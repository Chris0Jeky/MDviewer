import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { getHighlighter } from "../src/render/highlight";
import { renderReaderDocument } from "../src/desktop/render";

// Keep the real renderer and real grammar engine. Observe only the cold-start
// boundary; asserting the rendered document prevents an inert stub from passing.
vi.mock("../src/render/highlight", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/render/highlight")>();
  return { ...actual, getHighlighter: vi.fn(actual.getHighlighter) };
});
beforeEach(() => vi.mocked(getHighlighter).mockClear());

describe("reader syntax highlighting admission", () => {
  // Run the cold curated-grammar control first: a preceding literal fence
  // example must not accidentally preload C# and mask failed discovery.
  it("loads the actual curated grammar for code nested in a blockquote", async () => {
    const result = await renderReaderDocument("# Quoted code\n\n> ```cs\n> public record Person(string Name);\n> ```", DEFAULT_SETTINGS);
    expect(result.document.querySelector("blockquote pre.shiki code")?.textContent).toContain("public record Person(string Name);");
    expect(result.document.querySelectorAll("blockquote pre.shiki code span[style]").length).toBeGreaterThan(1);
    expect(getHighlighter).toHaveBeenCalledTimes(1);
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
    expect(getHighlighter).not.toHaveBeenCalled();
  });

  for (const language of ["", "text", "plaintext", "txt", "unbundled-example"]) {
    it(`keeps the ${language || "unlabelled"} fence readable without a grammar engine`, async () => {
      const result = await renderReaderDocument(`# Plain code\n\n\`\`\`${language}\n<script>literal code</script>\n\`\`\``, DEFAULT_SETTINGS);
      expect(result.document.querySelector("pre code")?.textContent?.trimEnd()).toBe("<script>literal code</script>");
      expect(result.document.querySelector("script")).toBeNull();
      expect(getHighlighter).not.toHaveBeenCalled();
      expect(result.warnings.length).toBe(language === "unbundled-example" ? 1 : 0);
    });
  }

  it("does not mistake literal fence examples inside a longer text fence for executable grammar requests", async () => {
    const source = "# Fence examples\n\n````text\n```cs\npublic record Person;\n```\n````";
    const result = await renderReaderDocument(source, DEFAULT_SETTINGS);
    expect(result.document.querySelectorAll("pre code")).toHaveLength(1);
    expect(result.document.querySelector("pre code")?.textContent).toContain("```cs");
    expect(getHighlighter).not.toHaveBeenCalled();
    expect(result.warnings).toEqual([]);
  });

  it("warns for a real unknown fence inside a blockquote without initializing Shiki", async () => {
    const result = await renderReaderDocument("# Unknown code\n\n> ```unbundled-example\n> Visible source\n> ```", DEFAULT_SETTINGS);
    expect(result.document.querySelector("blockquote pre code")?.textContent?.trimEnd()).toBe("Visible source");
    expect(result.warnings).toEqual(['Code language "unbundled-example" is not bundled; rendered as plain text.']);
    expect(getHighlighter).not.toHaveBeenCalled();
  });

  it("preserves explicitly requested plaintext line numbers", async () => {
    const result = await renderReaderDocument("# Numbered\n\n```text\nalpha\nbeta\n```", { ...DEFAULT_SETTINGS, showLineNumbers: true });
    expect(result.document.querySelectorAll("pre.shiki.with-line-numbers .line")).toHaveLength(2);
    expect(getHighlighter).toHaveBeenCalledOnce();
  });

  it("preserves plaintext metadata highlighting", async () => {
    const result = await renderReaderDocument("# Marked\n\n```text {2}\nalpha\nbeta\n```", DEFAULT_SETTINGS);
    expect(result.document.querySelector("pre.shiki .line.highlighted")?.textContent).toBe("beta");
    expect(getHighlighter).toHaveBeenCalledOnce();
  });

  it("does not warn for unknown fence labels that are only literal code examples", async () => {
    const result = await renderReaderDocument("# Literal example\n\n````text\n```not-a-language\nexample\n```\n````", DEFAULT_SETTINGS);
    expect(result.document.querySelector("pre code")?.textContent).toContain("not-a-language");
    expect(result.warnings).toEqual([]);
    expect(getHighlighter).not.toHaveBeenCalled();
  });

});
