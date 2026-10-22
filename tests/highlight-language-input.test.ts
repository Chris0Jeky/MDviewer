import { describe, expect, it } from "vitest";
import {
  ensureLang,
  ensureMarkdownLanguages,
  findFenceLanguages,
  getHighlighter,
  isSupportedLanguage,
} from "../src/render/highlight";
import { createMarkdown, renderMarkdown } from "../src/render/markdown";
import { DEFAULT_SETTINGS } from "../src/app/settings";

describe("untrusted fence language identifiers", () => {
  for (const language of ["constructor", "__proto__"]) {
    it(`keeps ${language} a string rather than resolving an inherited alias`, () => {
      expect(findFenceLanguages(`\`\`\`${language}\nexample\n\`\`\``)).toEqual([language]);
      expect(isSupportedLanguage(language)).toBe(false);
    });

    it(`renders ${language} as escaped text without breaking the document`, async () => {
      const hl = await getHighlighter();
      const before = [...hl.getLoadedLanguages()];
      const source = `# Still readable\n\n\`\`\`${language}\n<script>notExecutable()</script>\n\`\`\``;
      await expect(ensureLang(hl, language)).resolves.toBeUndefined();
      await expect(ensureMarkdownLanguages(hl, source)).resolves.toBeUndefined();
      expect(hl.getLoadedLanguages()).toEqual(before);
      const result = renderMarkdown(createMarkdown(hl, DEFAULT_SETTINGS), source);
      const root = document.createElement("div");
      root.innerHTML = result.html;
      expect(root.querySelector("h1")?.textContent).toContain("Still readable");
      expect(root.querySelector("pre code")?.textContent).toContain("<script>notExecutable()</script>");
      expect(root.querySelector("script")).toBeNull();
      expect(result.warnings).toContainEqual({
        kind: "lang",
        message: `Code language "${language}" is not bundled; rendered as plain text.`,
      });
    }, 30_000);
  }

  it("continues normalizing genuine aliases and loading curated languages", async () => {
    expect(findFenceLanguages("```language-CS\nrecord Person;\n```\n\n```cs\nrecord Other;\n```")).toEqual(["csharp"]);
    expect(isSupportedLanguage("CS")).toBe(true);
    const hl = await getHighlighter();
    await ensureMarkdownLanguages(hl, "```cs\nrecord Person;\n```");
    expect(hl.getLoadedLanguages()).toContain("csharp");
  }, 30_000);
});
