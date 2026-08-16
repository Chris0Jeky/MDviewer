import { describe, it, expect, beforeAll } from "vitest";
import type { HighlighterCore } from "shiki/core";
import { createMarkdown, renderMarkdown, type RenderWarning } from "../src/render/markdown";
import { getHighlighter } from "../src/render/highlight";
import { KATEX_ERROR_COLOR, KATEX_ERROR_HINT, tagKatexErrors } from "../src/render/math";
import { DEFAULT_SETTINGS } from "../src/app/settings";

let hl: HighlighterCore;

beforeAll(async () => {
  hl = await getHighlighter();
}, 30_000);

function render(src: string): { html: string; warnings: RenderWarning[] } {
  const md = createMarkdown(hl, { ...DEFAULT_SETTINGS });
  return renderMarkdown(md, src);
}

function renderMath(src: string): string {
  return render(src).html;
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
    // rendered error node. The colour is exported so nothing has to repeat the literal.
    const html = renderMath("Bad: $\\sqrt{$");
    expect(html.toLowerCase()).toContain(KATEX_ERROR_COLOR.toLowerCase());
  });
});

/**
 * BUG-8. KaTeX fails in two shapes and only one is self-describing:
 *   - a hard parse error -> <span class="katex-error" title="ParseError: …">
 *   - an unknown control sequence under strict:"ignore" (katex 0.18) -> a plain
 *     <span style="color:#cc0000"> with no class and no title.
 * `tagKatexErrors` normalises both so the CSS affordance and the warning scan can key
 * off the class instead of string-matching the error hex.
 */
describe("math: error affordance is class-based, not colour-string-based", () => {
  function frag(html: string): HTMLElement {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
  }

  it("tags a hard parse error and keeps KaTeX's own message as the title", () => {
    const root = frag(renderMath("Bad: $\\sqrt{$"));
    const error = root.querySelector(".katex-error");
    expect(error).not.toBeNull();
    expect(error?.getAttribute("title") ?? "").toContain("ParseError");
  });

  it("tags an unknown control sequence, which KaTeX leaves unclassed and untitled", () => {
    const root = frag(renderMath("Bad: $\\notacommand{x}$"));
    const error = root.querySelector(".katex-error");
    expect(error, "the silently-red unknown command must still be tagged").not.toBeNull();
    expect(error?.getAttribute("title")).toBe(KATEX_ERROR_HINT);
  });

  it("tags only the outermost span of a nested error, so the affordance draws once", () => {
    const root = frag(renderMath("Bad: $\\notacommand{x}$"));
    expect(root.querySelectorAll(".katex-error")).toHaveLength(1);
    expect(root.querySelector(".katex-error .katex-error")).toBeNull();
  });

  it("leaves valid math untouched", () => {
    const root = frag(renderMath("Fine: $E = mc^2$"));
    expect(root.querySelector(".katex")).not.toBeNull();
    expect(root.querySelector(".katex-error")).toBeNull();
  });

  it("never mistakes a user's own red HTML for broken math", () => {
    const out = tagKatexErrors(
      `<p><span style="color:${KATEX_ERROR_COLOR}">a deliberate red note</span></p>`,
    );
    expect(out.count).toBe(0);
    expect(out.html).not.toContain("katex-error");
  });

  it("is a no-op on markup with no math at all", () => {
    const html = "<p>Just prose.</p>";
    expect(tagKatexErrors(html)).toEqual({ html, count: 0 });
  });
});

describe("math: the render warning surfaces the failure", () => {
  it("reports a math warning for an unparseable expression", () => {
    const { warnings } = render("Bad: $\\sqrt{$");
    const math = warnings.filter((w) => w.kind === "math");
    expect(math).toHaveLength(1);
    expect(math[0]?.message).toMatch(/math expression/i);
  });

  it("reports a math warning for an unknown control sequence too", () => {
    const { warnings } = render("Bad: $\\notacommand{x}$");
    expect(warnings.some((w) => w.kind === "math")).toBe(true);
  });

  it("counts multiple failures in one message", () => {
    const { warnings } = render("Bad: $\\sqrt{$ and $\\frac{1}{$");
    const math = warnings.find((w) => w.kind === "math");
    expect(math?.message).toMatch(/^2 math expressions/);
  });

  it("emits no math warning for a clean document", () => {
    const { warnings } = render("Fine: $E = mc^2$ and $\\R$.");
    expect(warnings.some((w) => w.kind === "math")).toBe(false);
  });

  it("does not false-positive on prose that merely contains the error hex", () => {
    const { warnings } = render(`My brand colour is ${KATEX_ERROR_COLOR} exactly.`);
    expect(warnings.some((w) => w.kind === "math")).toBe(false);
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
