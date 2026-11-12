import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HighlighterCore } from "shiki/core";
import { DEFAULT_SETTINGS } from "../src/app/settings";

// Observe real engines and registration, so loading assertions also require
// readable, colored output. Fault injection affects only explicit boundaries.
const boundary = vi.hoisted(() => ({
  instances: [] as HighlighterCore[], creates: 0, registrations: 0,
  failCreates: 0, failRegistrations: 0,
}));
vi.mock("shiki/core", async importOriginal => {
  const actual = await importOriginal<typeof import("shiki/core")>();
  return { ...actual, createHighlighterCore: async (...args: Parameters<typeof actual.createHighlighterCore>) => {
    boundary.creates += 1;
    if (boundary.failCreates > 0) {
      boundary.failCreates -= 1;
      throw new Error("Engine temporarily unavailable");
    }
    const hl = await actual.createHighlighterCore(...args);
    const register = hl.loadLanguage.bind(hl);
    hl.loadLanguage = async (...languages) => {
      boundary.registrations += 1;
      if (boundary.failRegistrations > 0) {
        boundary.failRegistrations -= 1;
        throw new Error("Grammar temporarily unavailable");
      }
      await register(...languages);
    };
    boundary.instances.push(hl);
    return hl;
  } };
});

beforeEach(() => {
  vi.resetModules();
  boundary.instances.length = 0;
  boundary.creates = 0;
  boundary.registrations = 0;
  boundary.failCreates = 0;
  boundary.failRegistrations = 0;
});
afterEach(() => { for (const hl of boundary.instances) hl.dispose(); });

async function reader(info: string, source: string) {
  const { renderReaderDocument } = await import("../src/desktop/render");
  const result = await renderReaderDocument(`\`\`\`${info}\n${source}\n\`\`\``, DEFAULT_SETTINGS);
  expect(result.document.querySelectorAll("pre.shiki span[style]").length).toBeGreaterThan(1);
  expect(result.warnings).toEqual([]);
  return result;
}

/** A failed preparation keeps the text readable and reports why; it never fails the render. */
async function readerWithoutHighlighting(message: string): Promise<void> {
  const { renderReaderDocument } = await import("../src/desktop/render");
  const result = await renderReaderDocument(["```cs", "public record Person(string Name);", "```"].join("\n"), DEFAULT_SETTINGS);
  expect(result.warnings).toEqual([`Code highlighting is unavailable: ${message}`]);
  expect(result.document.querySelector("pre.reader-pending code")?.textContent).toBe("public record Person(string Name);");
}

describe("reader grammar preparation and workspace handoff", () => {
  it("loads the requested grammar without unrelated common grammars", async () => {
    await reader("ts", "const answer: number = 42;");
    expect(boundary.instances).toHaveLength(1);
    const hl = boundary.instances[0]!;
    expect(hl.getLoadedLanguages()).toContain("typescript");
    expect(hl.getLoadedLanguages()).not.toContain("cpp");
    expect(hl.getLoadedLanguages()).not.toContain("python");
    expect(hl.getLoadedLanguages()).not.toContain("markdown");
    const { CODE_THEME_PAIRS } = await import("../src/render/highlight");
    for (const pair of Object.values(CODE_THEME_PAIRS)) {
      expect(hl.getLoadedThemes()).toEqual(expect.arrayContaining([pair.light, pair.dark]));
    }
  }, 30_000);

  it("upgrades the same reader engine to the complete eager workspace contract", async () => {
    await reader("cs", "public record Person(string Name);");
    const { getHighlighter } = await import("../src/render/highlight");
    const hl = await getHighlighter();
    expect(hl).toBe(boundary.instances[0]);
    expect(boundary.creates).toBe(1);
    expect(hl.getLoadedLanguages()).toEqual(expect.arrayContaining([
      "typescript", "javascript", "python", "bash", "json", "markdown", "html", "css",
      "rust", "go", "java", "c", "cpp", "sql", "yaml", "diff", "csharp",
    ]));
    const tokens = hl.codeToTokens("# Source editor", {
      lang: "markdown", themes: { light: "min-light", dark: "min-dark" },
    });
    expect(tokens.tokens[0]?.some(token => token.htmlStyle)).toBe(true);
  }, 30_000);

  it("reuses a workspace-first engine when the reader needs a curated grammar", async () => {
    const { getHighlighter } = await import("../src/render/highlight");
    const hl = await getHighlighter();
    await reader("cs", "public record Person(string Name);");
    expect(boundary.instances).toEqual([hl]);
    expect(boundary.creates).toBe(1);
    expect(hl.getLoadedLanguages()).toContain("csharp");
  }, 30_000);

  it("shares one engine while reader and eager workspace preparation overlap", async () => {
    const { getHighlighter } = await import("../src/render/highlight");
    const document = reader("ts", "const answer: number = 42;");
    const workspace = getHighlighter();
    expect(getHighlighter()).toBe(workspace);
    const [, hl] = await Promise.all([document, workspace]);
    expect(boundary.instances).toEqual([hl]);
    expect(boundary.creates).toBe(1);
    expect(hl.getLoadedLanguages()).toEqual(expect.arrayContaining(["typescript", "markdown", "cpp"]));
  }, 30_000);

  it("coalesces concurrent aliases into one grammar registration", async () => {
    await Promise.all([
      reader("cs", "public record Person(string Name);"),
      reader("c#", "public record Address(string City);"),
    ]);
    expect(boundary.creates).toBe(1);
    expect(boundary.registrations).toBe(1);
    expect(boundary.instances[0]!.getLoadedLanguages()).toContain("csharp");
  }, 30_000);

  it("loads the embedded grammars required by the selected language", async () => {
    await reader("html", "<script>const answer = 42;</script>\n<style>body { color: red; }</style>");
    const hl = boundary.instances[0]!;
    expect(hl.getLoadedLanguages()).toEqual(expect.arrayContaining(["html", "javascript", "css"]));
    expect(hl.getLoadedLanguages()).not.toContain("cpp");
    const embedded = hl.codeToTokens("const answer = 42;", { lang: "javascript", theme: "github-light" });
    expect(new Set(embedded.tokens[0]?.map(token => token.color)).size).toBeGreaterThan(1);
  }, 30_000);

  it.each([
    ["markdown", "```js\nconst answer = 42;\n```"],
    ["vue", '<i18n lang="yaml">\nen:\n  greeting: Hello\n</i18n>'],
    // Ruby declares this optional dependency on its HAML module member.
    ["ruby", "puts <<~HAML\n:markdown\n  # Heading\n  **bold**\nHAML"],
  ])("preserves eager colors for optional languages embedded in %s examples", async (language, code) => {
    const { getHighlighter } = await import("../src/render/highlight");
    const { createMarkdown, renderMarkdown } = await import("../src/render/markdown");
    const source = `~~~~${language}\n${code}\n~~~~`;
    const hl = await getHighlighter();
    const { ensureLang } = await import("../src/render/highlight");
    await ensureLang(hl, language);
    const eager = renderMarkdown(createMarkdown(hl, DEFAULT_SETTINGS), source);
    const reference = document.createElement("div");
    reference.innerHTML = eager.html;
    const colors = Array.from(reference.querySelectorAll<HTMLSpanElement>("pre.shiki span[style]"))
      .map(span => span.style.color);
    expect(new Set(colors).size).toBeGreaterThan(1);

    vi.resetModules();
    const { renderReaderDocument } = await import("../src/desktop/render");
    const result = await renderReaderDocument(source, DEFAULT_SETTINGS);
    expect(boundary.instances).toHaveLength(2);
    // The reader adds only its source-map stamp to the shared highlighted markup.
    const pre = result.document.querySelector("pre")!;
    expect(pre.getAttribute("data-src")).toMatch(/^1-\d+$/);
    pre.removeAttribute("data-src");
    expect(pre.outerHTML).toBe(reference.querySelector("pre")?.outerHTML);
    expect(result.warnings).toEqual([]);
  }, 30_000);

  it("keeps plaintext transformers without registering syntax grammars", async () => {
    const { renderReaderDocument } = await import("../src/desktop/render");
    const result = await renderReaderDocument("```text\nalpha\nbeta\n```", { ...DEFAULT_SETTINGS, showLineNumbers: true });
    expect(result.document.querySelectorAll("pre.shiki.with-line-numbers .line")).toHaveLength(2);
    expect(boundary.instances[0]!.getLoadedLanguages()).toEqual([]);
  }, 30_000);

  it("retries reader engine creation after a transient failure", async () => {
    boundary.failCreates = 1;
    await readerWithoutHighlighting("Engine temporarily unavailable");
    await reader("cs", "public record Person(string Name);");
    expect(boundary.creates).toBe(2);
    expect(boundary.instances).toHaveLength(1);
  }, 30_000);

  it("retries reader grammar registration on the same engine", async () => {
    boundary.failRegistrations = 1;
    await readerWithoutHighlighting("Grammar temporarily unavailable");
    await reader("cs", "public record Person(string Name);");
    expect(boundary.creates).toBe(1);
    expect(boundary.registrations).toBe(2);
  }, 30_000);

  it("retries eager workspace preparation without replacing a reader engine", async () => {
    await reader("cs", "public record Person(string Name);");
    const { getHighlighter } = await import("../src/render/highlight");
    boundary.failRegistrations = 1;
    await expect(getHighlighter()).rejects.toThrow("Grammar temporarily unavailable");
    const hl = await getHighlighter();
    expect(hl).toBe(boundary.instances[0]);
    expect(boundary.creates).toBe(1);
    expect(hl.getLoadedLanguages()).toEqual(expect.arrayContaining(["typescript", "markdown", "cpp"]));
  }, 30_000);
});
