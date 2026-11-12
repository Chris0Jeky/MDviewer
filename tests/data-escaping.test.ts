import { describe, expect, it } from "vitest";
import { toReadable } from "../src/data";
import { createMarkdown, renderMarkdown } from "../src/render/markdown";
import { DEFAULT_SETTINGS } from "../src/app/settings";

const md = createMarkdown(null, DEFAULT_SETTINGS);
function html(text: string): HTMLElement {
  const root = document.createElement("div");
  // renderMarkdown includes the app's DOMPurify sanitiser.
  root.innerHTML = renderMarkdown(md, text).html;
  return root;
}
function tags(element: Element): string[] {
  return [...new Set([element.tagName, ...Array.from(element.querySelectorAll("*"), e => e.tagName)])].sort();
}
function text(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const br of clone.querySelectorAll("br")) br.replaceWith("\n");
  // CommonMark normalises CR and CRLF to LF. No trimming or whitespace collapsing is used:
  // the lens encodes spaces and tabs so Markdown cannot discard or reinterpret them.
  return (clone.textContent ?? "").replace(/\r\n|\r/g, "\n");
}
function samples(): string[] {
  let seed = 0x5eed1234;
  function random(): number { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }
  const pieces = ["|", "`", "#", "- [ ]", "<b>", "&amp;", "*_~[]()!\\", "   leading", "1. numbered", "\n", "😀", "مرحبا", "שלום", "$x$", "{.class}", "https://example.test", "\t", ">quote", "[[toc]]"];
  const result = [...pieces, "a\n\nb", "\n", "\n tail\n", "  x  ", "\\|`#<b>&amp;*_~[]()!", "a\r\nb\rc"];
  for (let i = 0; i < 240; i++) {
    let s = "";
    for (let j = 0, length = random() % 10 + 1; j < length; j++) s += pieces[random() % pieces.length]!;
    // The explicitly specified Markdown-in-a-string path is intentionally outside this property.
    if (/^ {0,3}#{1,6} /m.test(s) || /^ {0,3}(?:`{3,}|~{3,})/m.test(s)
      || (s.match(/^ {0,3}(?:[-+*]|\d+[.)])\s+\S/gm)?.length ?? 0) >= 2) continue;
    result.push(s);
  }
  return result;
}

describe("data escaping conformance", () => {
  it("preserves seeded values and keys through the real renderer without extra elements", () => {
    for (const s of samples()) {
      // Same length and whitespace => same layout decisions; only the data punctuation changes.
      const plain = s.replace(/[^\r\n\t ]/g, "a");
      const valueRoot = html(toReadable(JSON.stringify({ k: s }), "json").markdown);
      expect(tags(valueRoot), JSON.stringify(s)).toEqual(tags(html(toReadable(JSON.stringify({ k: plain }), "json").markdown)));
      const target = valueRoot.querySelector("tbody td:nth-child(2)") ?? valueRoot.querySelector("h2 + p");
      expect(target, JSON.stringify(s)).not.toBeNull();
      expect(text(target!), JSON.stringify(s)).toBe(s.replace(/\r\n|\r/g, "\n"));
      const expectedTags = [target!.tagName];
      if (target!.tagName === "P") expectedTags.push("SPAN");
      if (s.includes("\n") || s.includes("\r")) expectedTags.push("BR");
      expectedTags.sort();
      expect(tags(target!), JSON.stringify(s)).toEqual([...new Set(expectedTags)]);

      const table = html(toReadable(JSON.stringify([{ k: s }]), "json").markdown);
      expect(tags(table), JSON.stringify(s)).toEqual(tags(html(toReadable(JSON.stringify([{ k: plain }]), "json").markdown)));
      const cell = table.querySelector("tbody td")!;
      expect(cell, JSON.stringify(s)).not.toBeNull();
      expect(text(cell), JSON.stringify(s)).toBe(s.replace(/\r\n|\r/g, "\n"));
      expect(tags(cell)).toEqual(s.includes("\n") || s.includes("\r") ? ["BR", "TD"] : ["TD"]);

      const keyRoot = html(toReadable(JSON.stringify({ [s]: "plain" }), "json").markdown);
      expect(tags(keyRoot), JSON.stringify(s)).toEqual(tags(html(toReadable(JSON.stringify({ [plain]: "plain" }), "json").markdown)));
      const key = keyRoot.querySelector("tbody td")!;
      expect(text(key), JSON.stringify(s)).toBe(s.replace(/\r\n|\r/g, "\n"));
      expect(tags(key)).toEqual(s.includes("\n") || s.includes("\r") ? ["BR", "TD"] : ["TD"]);
    }
  }, 30_000);

  it("keeps deliberate Markdown within a blockquote and sanitises it", () => {
    const root = html(toReadable(JSON.stringify({ description: "# Heading\n\n**Bold** <script>alert(1)</script>",
      other: "- first\n- second" }), "json").markdown);
    expect(root.querySelector("blockquote h1")?.textContent).toContain("Heading");
    expect(root.querySelector("blockquote strong")?.textContent).toBe("Bold");
    expect(root.querySelectorAll("blockquote li")).toHaveLength(2);
    expect(root.querySelector("script")).toBeNull();
  });

  it("preserves generated conversation roles, tool names, inputs and results without data-created elements", () => {
    function conversation(s: string): HTMLElement {
      return html(toReadable(JSON.stringify([
        { role: `Role ${s}`, content: "Message" },
        { role: "assistant", content: [
          { type: "tool_use", name: s, input: { value: s } },
          { type: "tool_result", content: s },
        ] },
      ]), "json").markdown);
    }
    for (const s of [...samples(), "# heading", "# heading\n\n- one\n- two", "</summary></details><img src=x onerror=alert(1)>", "```\n</details>\n```"]) {
      const root = conversation(s);
      const plain = s.replace(/[^\r\n\t ]/g, "a");
      expect(tags(root), JSON.stringify(s)).toEqual(tags(conversation(plain)));
      expect(Array.from(root.querySelectorAll("*"), e => e.tagName), JSON.stringify(s))
        .toEqual(Array.from(conversation(plain).querySelectorAll("*"), e => e.tagName));
      const normal = s.replace(/\r\n|\r/g, "\n");
      expect(text(root.querySelector("h2")!), JSON.stringify(s)).toBe(`Role ${normal}`);
      const call = root.querySelector("details")!;
      const summary = text(call.querySelector("summary")!);
      const oneLine = Array.from(normal.replace(/\n/g, " "));
      expect(summary, JSON.stringify(s)).toBe(`Tool call: ${normal} · ${oneLine.slice(0, 80).join("")}${oneLine.length > 80 ? "…" : ""}`);
      const name = call.querySelector("details tbody td:nth-child(2)") ?? call.querySelector("details h3 + p");
      // The complete tool name also remains in generic metadata, including whitespace.
      expect(text(name!), JSON.stringify(s)).toBe(normal);
      const input = call.querySelector("tbody td:nth-child(2)") ?? call.querySelector("h3 + p");
      expect(text(input!), JSON.stringify(s)).toBe(normal);
      const result = Array.from(root.querySelectorAll("details")).find(e => e.querySelector(":scope > summary")?.textContent?.startsWith("Tool result"))!;
      expect((result.querySelector("pre")!.textContent ?? "").replace(/\n$/, ""), JSON.stringify(s)).toBe(normal);
      expect(tags(root.querySelector("h2")!)).toEqual(tags(conversation(plain).querySelector("h2")!));
      expect(root.querySelectorAll("img, script, input")).toHaveLength(0);
    }
  }, 30_000);

  it("preserves a long ordinary paragraph's real line breaks", () => {
    const s = "Plain ".repeat(40) + "\nnext\n\nlast";
    const root = html(toReadable(JSON.stringify({ k: s }), "json").markdown);
    expect(text(root.querySelector("h2 + p")!)).toBe(s);
    expect(tags(root.querySelector("h2 + p")!)).toEqual(["BR", "P", "SPAN"]);
  });

  it("shows plain text literally: every sample, exactly, in one block", () => {
    for (const s of [...samples(), "# a\n- [ ] b\n    code\n\n\nend", "```\nx\n```", "````\n`"]) {
      const root = html(toReadable(s, "text").markdown);
      const blocks = root.querySelectorAll("pre");
      expect(blocks, JSON.stringify(s)).toHaveLength(1);
      const lines = s.split(/\r\n|\r|\n/);
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      expect((blocks[0]!.textContent ?? "").replace(/\n$/, ""), JSON.stringify(s)).toBe(lines.join("\n"));
      expect(tags(blocks[0]!), JSON.stringify(s)).toEqual(["CODE", "PRE"]);
    }
  }, 30_000);
});
