import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMarkdown } from "../src/render/markdown";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { readFrontMatter, frontMatterKind, frontMatterProblems } from "../src/render/frontmatter";
import { frontMatterCard } from "../src/desktop/reader/frontmatter";

const fixture = (name: string): string =>
  readFileSync(resolve("tests/fixtures/frontmatter", name), "utf8").replace(/\r\n/g, "\n");

function read(text: string) {
  const { body, frontMatter } = readFrontMatter(text);
  if (!frontMatter) throw new Error("expected front matter");
  return { body, frontMatter };
}

describe("readFrontMatter: recognition and blanking", () => {
  it("returns documents without front matter unchanged", () => {
    for (const text of [
      "# Title\n\nText", "", "---", "---\n\nA paragraph between rules\n\n---\n", " ---\nname: x\n---\n",
      "---\n# Title\n\nIntro paragraph\n\n---\n\nRest", "---\n- a\n- b\n---\n", "---\n---\ntext", "---\n# Heading\nbody",
    ]) {
      expect(readFrontMatter(text)).toEqual({ body: text, frontMatter: null });
    }
  });

  it("blanks the block with the same number of lines so source maps hold", () => {
    const text = fixture("skill.md");
    const { body, frontMatter } = read(text);
    expect(frontMatter.lineCount).toBe(5);
    expect(body.split("\n").length).toBe(text.split("\n").length);
    expect(body.split("\n").slice(0, 5).every(line => line === "")).toBe(true);
    expect(body.slice(5)).toBe(text.slice(text.indexOf("\n---\n", 1) + 5));
    const heading = createMarkdown(null, DEFAULT_SETTINGS).parse(body, {}).find(token => token.type === "heading_open");
    expect(heading?.map).toEqual([6, 7]); // "# mdv-export" is line 7 of the original file
  });

  it("accepts ... as the closing fence, CRLF line endings and a BOM", () => {
    const { body, frontMatter } = read("\uFEFF---\r\nname: x\r\n...\r\n# Body\r\n");
    expect(frontMatter.entries).toEqual([{ key: "name", value: "x" }]);
    expect(body).toBe("\n\n\n# Body\r\n");
  });

  it("renders no rule or stray heading from front matter", () => {
    const html = createMarkdown(null, DEFAULT_SETTINGS).render(read(fixture("agent.md")).body);
    expect(html).not.toMatch(/<hr|<h2|name: reviewer/);
    expect(html).toContain("You are an independent reviewer.");
  });

  it("reports an unterminated block without hiding the document", () => {
    const text = "---\nname: x\ndescription: y\n\n# Body\n";
    const { body, frontMatter } = readFrontMatter(text);
    expect(body).toBe(text);
    expect(frontMatter?.lineCount).toBe(0);
    expect(frontMatter?.problems[0]?.message).toMatch(/never closes/);
  });
});

describe("readFrontMatter: tolerant YAML reader", () => {
  it("reads a real skill", () => {
    const { frontMatter } = read(fixture("skill.md"));
    expect(frontMatter.entries?.map(entry => entry.key)).toEqual(["name", "description", "user-invocable"]);
    expect(frontMatterKind("SKILL.md", frontMatter)).toBe("skill");
    expect(frontMatterProblems("SKILL.md", frontMatter)).toEqual([]);
  });

  it("reads an agent definition with a quoted description containing colons", () => {
    const { frontMatter } = read(fixture("agent.md"));
    expect(frontMatter.entries?.find(entry => entry.key === "description")?.value).toMatch(/^Read-only .*: it cannot/);
    expect(frontMatterKind("reviewer.md", frontMatter)).toBeNull();
    expect(frontMatterKind("C:\\repo\\.claude\\agents\\reviewer.md", frontMatter)).toBe("agent");
    expect(frontMatterProblems("C:\\repo\\.claude\\agents\\reviewer.md", frontMatter)).toEqual([]);
    // A `tools` key alone does not make an ordinary note an agent definition.
    expect(frontMatterProblems("post.md", read("---\ntools: [a, b]\n---\n").frontMatter)).toEqual([]);
  });

  it("reads a memory file with one nested map", () => {
    const { frontMatter } = read(fixture("memory.md"));
    expect(frontMatter.entries).toContainEqual({ key: "metadata.type", value: "feedback" });
    expect(frontMatterKind("pdf-export-check.md", frontMatter)).toBe("memory");
    expect(frontMatterProblems("pdf-export-check.md", frontMatter)).toEqual([]);
  });

  it("reads quoted strings, inline and block lists, block scalars, comments and empty values", () => {
    const { frontMatter } = read(fixture("block.md"));
    expect(frontMatter.entries).toEqual([
      { key: "title", value: "Release notes: v2" },
      { key: "aliases", value: ["one", "two", "three"] },
      { key: "notes", value: "First line: kept\nSecond line" },
      { key: "folded", value: "joined words" },
      { key: "empty", value: "" },
    ]);
    expect(frontMatter.problems).toEqual([]);
    expect(frontMatterKind("notes.md", frontMatter)).toBeNull();
  });

  it("falls back to raw text for YAML it does not understand", () => {
    const { frontMatter } = read("---\nmap: {a: 1}\nanchor: &x 1\n---\n");
    expect(frontMatter.entries).toBeNull();
    expect(frontMatter.raw).toBe("map: {a: 1}\nanchor: &x 1");
    expect(read("---\nmetadata:\n  a:\n    b: 1\n---\n").frontMatter.entries).toBeNull();
  });

  it("keeps relative indentation inside literal block scalars", () => {
    expect(read("---\nscript: |\n  if true:\n    print(1)\n\n  done\n---\n").frontMatter.entries)
      .toEqual([{ key: "script", value: "if true:\n  print(1)\n\ndone" }]);
  });

  it("decodes escapes in one pass and reads non-ASCII keys", () => {
    expect(read(String.raw`---
a: "x\\n\"y\"\tz"
标题: 中文
---
`).frontMatter.entries).toEqual([{ key: "a", value: 'x\\n"y"\tz' }, { key: "标题", value: "中文" }]);
  });

  it("stays fast on long whitespace runs", () => {
    const started = performance.now();
    read(`---\nk: a${" ".repeat(200_000)}b\n- c${" ".repeat(200_000)}d\n---\n`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("front matter lint", () => {
  it("flags an unquoted ': ' and missing required keys on a broken skill", () => {
    const { frontMatter } = read(fixture("broken.md"));
    const problems = frontMatterProblems("SKILL.md", frontMatter);
    expect(problems).toEqual([
      { line: 3, message: expect.stringMatching(/"summary" contains ": " but is not quoted/) },
      { line: 1, message: expect.stringMatching(/skill has no "description"/) },
    ]);
    expect(frontMatter.entries).toContainEqual({ key: "tags", value: ["pdf", "export"] });
  });

  it("does not flag colons inside quotes, block scalars or ordinary documents", () => {
    expect(read(fixture("block.md")).frontMatter.problems).toEqual([]);
    expect(frontMatterProblems("post.md", read("---\ntitle: x\n---\n").frontMatter)).toEqual([]);
  });

  it("requires name and description of memory files found by path", () => {
    const { frontMatter } = read("---\ndescription: d\n---\n");
    expect(frontMatterProblems("C:/p/memory/note.md", frontMatter).map(problem => problem.message))
      .toEqual([expect.stringMatching(/memory file has no "name"/)]);
  });
});

describe("Properties card", () => {
  it("lists fields as text, collapsed when clean", () => {
    const card = frontMatterCard(read(fixture("agent.md")).frontMatter, "reviewer.md") as HTMLDetailsElement;
    expect(card.open).toBe(false);
    expect(card.dataset.src).toBe("1-7");
    expect(card.querySelector("summary")?.textContent).toBe("Properties5 fields");
    expect([...card.querySelectorAll("dt")].map(node => node.textContent)).toEqual(["name", "description", "tools", "model", "effort"]);
  });

  it("opens with its problems and never interprets markup", () => {
    const { frontMatter } = read("---\nname: <img src=x onerror=alert(1)>\nnote: a: b\n---\n");
    const card = frontMatterCard(frontMatter, "x.md") as HTMLDetailsElement;
    expect(card.open).toBe(true);
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("dd")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(card.querySelector(".reader-properties-problems li")?.textContent).toMatch(/^Line 3: /);
  });

  it("shows raw YAML in monospace when it cannot read it", () => {
    const card = frontMatterCard(read("---\nmap: {a: 1}\n---\n").frontMatter, "x.md");
    expect(card.querySelector("pre.reader-properties-raw")?.textContent).toBe("map: {a: 1}");
  });
});
