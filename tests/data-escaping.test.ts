import { describe, expect, it } from "vitest";
import { prepare, toReadable } from "../src/data";
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
  const result = (clone.textContent ?? "").replace(/\r\n|\r/g, "\n");
  return element.tagName === "CODE" ? result.replace(/\n$/, "") : result;
}
function valueTarget(root: HTMLElement): Element | null {
  return root.querySelector("tbody td:nth-child(2)") ?? root.querySelector("h2 + p") ?? root.querySelector("h2 + pre code");
}
function displayed(s: string): string {
  const quoted = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)
    || /^(?:true|false|null)$/.test(s) || (!/[\r\n]/.test(s) && /^\s|\s$/.test(s));
  return s === "" ? '"" (empty string)' : quoted ? `"${s}"` : s;
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
  it("round-trips generated CSV cells and YAML strings through the real renderer", async () => {
    await prepare("yaml");
    for (const s of samples()) {
      const normal = s.replace(/\r\n|\r/g, "\n");
      const csv = `k\n"${s.replace(/"/g, '""')}"`;
      const yaml = `k: ${JSON.stringify(s)}`;
      const csvRoot = html(toReadable(csv, "csv").markdown);
      const yamlRoot = html(toReadable(yaml, "yaml").markdown);
      const cell = csvRoot.querySelector("tbody td");
      const value = valueTarget(yamlRoot);
      expect(cell, JSON.stringify(s)).not.toBeNull();
      expect(value, JSON.stringify(s)).not.toBeNull();
      expect(text(cell!), JSON.stringify(s)).toBe(normal);
      expect(text(value!), JSON.stringify(s)).toBe(value!.tagName === "TD" ? displayed(normal) : normal);
      expect(tags(cell!)).toEqual(/[\r\n]/.test(s) ? ["BR", "TD"] : ["TD"]);
      expect(csvRoot.querySelectorAll("img, script, input, a:not(.header-anchor)")).toHaveLength(0);
      expect(yamlRoot.querySelectorAll("img, script, input, a:not(.header-anchor)")).toHaveLength(0);
    }
  }, 120_000); // pure CPU; parallel suites can slow it several-fold

  it("preserves seeded values and keys through the real renderer without extra elements", () => {
    for (const s of samples()) {
      // Same length and whitespace => same layout decisions; only the data punctuation changes.
      const plain = s.replace(/[^\r\n\t ]/g, "a");
      const valueRoot = html(toReadable(JSON.stringify({ k: s }), "json").markdown);
      expect(tags(valueRoot), JSON.stringify(s)).toEqual(tags(html(toReadable(JSON.stringify({ k: plain }), "json").markdown)));
      const target = valueTarget(valueRoot);
      expect(target, JSON.stringify(s)).not.toBeNull();
      const normal = s.replace(/\r\n|\r/g, "\n");
      expect(text(target!), JSON.stringify(s)).toBe(target!.tagName === "CODE" ? normal : displayed(normal));
      const expectedTags = [target!.tagName];
      if (target!.tagName === "P") expectedTags.push("SPAN");
      if (target!.tagName !== "CODE" && (s.includes("\n") || s.includes("\r"))) expectedTags.push("BR");
      expectedTags.sort();
      expect(tags(target!), JSON.stringify(s)).toEqual([...new Set(expectedTags)]);

      const table = html(toReadable(JSON.stringify([{ k: s }]), "json").markdown);
      expect(tags(table), JSON.stringify(s)).toEqual(tags(html(toReadable(JSON.stringify([{ k: plain }]), "json").markdown)));
      const cell = table.querySelector("tbody td")!;
      expect(cell, JSON.stringify(s)).not.toBeNull();
      expect(text(cell), JSON.stringify(s)).toBe(displayed(normal));
      expect(tags(cell)).toEqual(s.includes("\n") || s.includes("\r") ? ["BR", "TD"] : ["TD"]);

      const keyRoot = html(toReadable(JSON.stringify({ [s]: "plain" }), "json").markdown);
      expect(tags(keyRoot), JSON.stringify(s)).toEqual(tags(html(toReadable(JSON.stringify({ [plain]: "plain" }), "json").markdown)));
      const key = keyRoot.querySelector("tbody td")!;
      expect(text(key), JSON.stringify(s)).toBe(s.replace(/\r\n|\r/g, "\n"));
      expect(tags(key)).toEqual(s.includes("\n") || s.includes("\r") ? ["BR", "TD"] : ["TD"]);
    }
  }, 120_000); // pure CPU; parallel suites can slow it several-fold

  it("round-trips generated strings in inline lists, inline objects and flattened columns", () => {
    for (const s of [...samples(), "a, b", "a · b", "a: b", "true", "-0.5e+3", "null"]) {
      const normal = s.replace(/\r\n|\r/g, "\n");
      const flat = html(toReadable(JSON.stringify([{ outer: { value: s } }]), "json").markdown);
      expect(text(flat.querySelector("tbody td")!), JSON.stringify(s)).toBe(displayed(normal));
      expect(flat.querySelector("thead th")?.textContent).toBe("outer.value");
      expect(tags(flat.querySelector("tbody td")!)).toEqual(/[\r\n]/.test(s) ? ["BR", "TD"] : ["TD"]);
      // Blocks and values reaching 80 characters cannot be inline (G2); their flattened
      // cells above still exercise every generated sample without a size restriction.
      const compound = displayed(s) === s && /, | · |: /.test(s) ? `"${s}"` : displayed(s);
      if (/[\r\n]/.test(s) || compound.length + 5 >= 80) continue;
      for (const [value, expected] of [[{ k: [s, "end"] }, `${compound}, end`], [{ k: { v: s } }, `v: ${compound}`]] as const) {
        const root = html(toReadable(JSON.stringify(value), "json").markdown);
        const target = root.querySelector("tbody td:nth-child(2)")!;
        expect(text(target), JSON.stringify(s)).toBe(expected);
        expect(tags(target)).toEqual(["TD"]);
        expect(root.querySelectorAll("h2, img, script, input, a:not(.header-anchor)")).toHaveLength(0);
      }
      expect(flat.querySelectorAll("img, script, input, a:not(.header-anchor)")).toHaveLength(0);
    }
  }, 120_000);

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
      const name = call.querySelector("details tbody td:nth-child(2)") ?? call.querySelector("details h3 + p, details h3 + pre code");
      // The complete tool name also remains in generic metadata, including whitespace.
      expect(text(name!), JSON.stringify(s)).toBe(name!.tagName === "CODE" ? normal : displayed(normal));
      const input = call.querySelector("tbody td:nth-child(2)") ?? call.querySelector("h3 + p, h3 + pre code");
      expect(text(input!), JSON.stringify(s)).toBe(input!.tagName === "CODE" ? normal : displayed(normal));
      const result = Array.from(root.querySelectorAll("details")).find(e => e.querySelector(":scope > summary")?.textContent?.startsWith("Tool result"))!;
      expect((result.querySelector("pre")!.textContent ?? "").replace(/\n$/, ""), JSON.stringify(s)).toBe(normal);
      expect(tags(root.querySelector("h2")!)).toEqual(tags(conversation(plain).querySelector("h2")!));
      expect(root.querySelectorAll("img, script, input")).toHaveLength(0);
    }
  }, 120_000); // pure CPU; parallel suites can slow it several-fold

  it("preserves a long ordinary paragraph's real line breaks", () => {
    const s = "Plain ".repeat(40) + "\nnext\n\nlast";
    const root = html(toReadable(JSON.stringify({ k: s }), "json").markdown);
    expect(text(root.querySelector("h2 + pre code")!)).toBe(s);
    expect(tags(root.querySelector("h2 + pre")!)).toEqual(["CODE", "PRE"]);
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
  }, 120_000); // pure CPU; parallel suites can slow it several-fold
});

describe("data cannot create structure (review of #270)", () => {
  it("keeps a lone CR inside a deep code-like string's block", () => {
    // Code-like (not Markdown-like), four levels deep so it sits in an indented list item.
    const value = { a: { b: { c: { d: "const x = 1;\n\r[click](https://evil.example) <b>bold</b>" } } } };
    const root = html(toReadable(JSON.stringify(value), "json").markdown);
    expect(root.querySelector("a[href^='https://evil']")).toBeNull();
    expect(root.querySelector("b")).toBeNull();
    expect(root.querySelector("pre")?.textContent).toContain("[click](https://evil.example)");
  });

  it("shows values below the renderer's nesting limit literally instead of dropping them", () => {
    let value: unknown = "deep leaf";
    for (let i = 0; i < 60; i++) value = { a: value };
    const root = html(toReadable(JSON.stringify(value), "json").markdown);
    expect(root.textContent).toContain("deep leaf");
  });
});
