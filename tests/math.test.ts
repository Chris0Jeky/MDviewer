import { describe, it, expect, beforeAll } from "vitest";
import type { HighlighterCore } from "shiki/core";
import { createMarkdown, renderMarkdown } from "../src/render/markdown";
import { getHighlighter } from "../src/render/highlight";
import { DEFAULT_SETTINGS } from "../src/app/settings";

let hl: HighlighterCore;

beforeAll(async () => {
  hl = await getHighlighter();
}, 30_000);

function renderMath(src: string): string {
  const md = createMarkdown(hl, { ...DEFAULT_SETTINGS });
  return renderMarkdown(md, src).html;
}

function frag(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("math: inline rendering", () => {
  it("renders inline math into a .katex span", () => {
    const root = frag(renderMath("Energy: $E = mc^2$."));
    const katex = root.querySelector(".katex");
    expect(katex).not.toBeNull();
    // KaTeX output is HTML, not a raw dollar string
    expect(root.innerHTML).not.toContain("$E = mc^2$");
  });
});

describe("math: block (display) rendering", () => {
  it("renders $$...$$ into a .katex-display block", () => {
    const root = frag(renderMath("$$\n\\sum_{n=1}^{N} n = \\frac{N(N+1)}{2}\n$$"));
    expect(root.querySelector(".katex-display")).not.toBeNull();
  });
});

describe("math: throwOnError is false (errors degrade, never abort)", () => {
  it("does not throw on malformed TeX", () => {
    expect(() => renderMath("Broken: $\\frac{1}{$ and more text")).not.toThrow();
  });

  it("renders surrounding document content even when one expression is invalid", () => {
    const html = renderMath("Before $\\frac{1}{$ After the broken bit.");
    expect(html).toContain("Before");
    expect(html).toContain("After the broken bit.");
  });

  it("marks an invalid expression with the configured error color", () => {
    // @vscode/markdown-it-katex passes errorColor through to KaTeX, which colors the
    // rendered error node. We assert the documented #cc0000 appears somewhere.
    const html = renderMath("Bad: $\\sqrt{$");
    expect(html.toLowerCase()).toContain("#cc0000");
  });
});

describe("math: custom macros", () => {
  it("expands the \\R macro to the blackboard-bold reals", () => {
    // \R -> \mathbb{R}; KaTeX renders the resulting symbol, so no literal backslash-R survives.
    const root = frag(renderMath("Domain is $\\R$."));
    expect(root.querySelector(".katex")).not.toBeNull();
    expect(root.textContent ?? "").not.toContain("\\R");
  });

  it("expands the \\eps macro without error", () => {
    expect(() => renderMath("Let $\\eps > 0$ be small.")).not.toThrow();
    const root = frag(renderMath("Let $\\eps > 0$ be small."));
    expect(root.querySelector(".katex")).not.toBeNull();
  });
});
