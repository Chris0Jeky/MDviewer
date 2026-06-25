import { describe, it, expect, beforeAll } from "vitest";
import type { HighlighterCore } from "shiki/core";
import { createMarkdown, renderMarkdown, SLUGIFY } from "../src/render/markdown";
import { getHighlighter } from "../src/render/highlight";
import { DEFAULT_SETTINGS, type Settings } from "../src/app/settings";

let hl: HighlighterCore;

beforeAll(async () => {
  hl = await getHighlighter();
}, 30_000);

function render(src: string, patch: Partial<Settings> = {}): { html: string; warnings: unknown[] } {
  const md = createMarkdown(hl, { ...DEFAULT_SETTINGS, ...patch });
  return renderMarkdown(md, src);
}

/** Parse an HTML fragment into a detached container so we can query it. */
function frag(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("SLUGIFY", () => {
  it("lowercases, collapses whitespace runs to a single hyphen, and strips punctuation", () => {
    expect(SLUGIFY("Hello World")).toBe("hello-world");
    // \s+ collapses any run of whitespace to ONE hyphen, and outer space is trimmed.
    expect(SLUGIFY("  Trim  Me  ")).toBe("trim-me");
    // Each single inter-token space becomes one hyphen; the punctuation chars are then
    // stripped, leaving the four separators between the five tokens.
    expect(SLUGIFY("Symbols! @ # $ %")).toBe("symbols----");
  });

  it("is deterministic", () => {
    expect(SLUGIFY("Section 1: Intro")).toBe(SLUGIFY("Section 1: Intro"));
  });
});

describe("markdown: headings and anchors", () => {
  it("gives headings an id derived from SLUGIFY", () => {
    const { html } = render("# Hello World\n\n## A Second Section");
    const root = frag(html);
    const h1 = root.querySelector("h1");
    const h2 = root.querySelector("h2");
    expect(h1?.id).toBe(SLUGIFY("Hello World"));
    expect(h2?.id).toBe(SLUGIFY("A Second Section"));
  });

  it("adds a header anchor element to headings", () => {
    const { html } = render("# Title");
    expect(frag(html).querySelector(".header-anchor")).not.toBeNull();
  });
});

describe("markdown: TOC anchors match heading slugs", () => {
  it("[[toc]] links resolve to the exact heading ids", () => {
    const src = ["[[toc]]", "", "# Alpha One", "", "## Beta Two", "", "### Gamma Three"].join("\n");
    const root = frag(render(src).html);

    const headingIds = Array.from(root.querySelectorAll("h1[id], h2[id], h3[id]")).map(
      (h) => h.id,
    );
    expect(headingIds).toContain(SLUGIFY("Alpha One"));

    const tocLinks = Array.from(root.querySelectorAll("nav.toc a, .toc a")).map((a) =>
      (a.getAttribute("href") ?? "").replace(/^#/, ""),
    );
    expect(tocLinks.length).toBeGreaterThan(0);
    // every toc target must be a real heading id (no broken links)
    for (const target of tocLinks) {
      expect(headingIds, `toc target #${target}`).toContain(target);
    }
  });
});

describe("markdown: callouts", () => {
  it("renders ::: note/tip/warning/danger as .callout.callout-<kind> with a title", () => {
    for (const kind of ["note", "tip", "warning", "danger"] as const) {
      const { html } = render(`::: ${kind}\nBody text\n:::`);
      const root = frag(html);
      const box = root.querySelector(`.callout.callout-${kind}`);
      expect(box, `callout-${kind}`).not.toBeNull();
      expect(box?.querySelector(".callout-title")).not.toBeNull();
    }
  });

  it("uses a custom title when supplied on the fence", () => {
    const { html } = render("::: warning Heads up\nCareful\n:::");
    const title = frag(html).querySelector(".callout-warning .callout-title");
    expect(title?.textContent).toContain("Heads up");
  });
});

describe("markdown: footnotes", () => {
  it("emits an end-of-document footnotes section with a backref", () => {
    const { html } = render("Statement.[^a]\n\n[^a]: The note body.");
    const root = frag(html);
    expect(root.querySelector(".footnotes")).not.toBeNull();
    expect(root.querySelector(".footnote-backref")).not.toBeNull();
    expect(root.textContent).toContain("The note body.");
  });
});

describe("markdown: task lists", () => {
  it("marks checkbox list items with the task-list-item class", () => {
    const { html } = render("- [x] done\n- [ ] todo");
    const items = frag(html).querySelectorAll(".task-list-item");
    expect(items.length).toBe(2);
  });
});

describe("markdown: code highlighting integration", () => {
  it("renders fenced code through Shiki into a .shiki block", () => {
    const { html } = render("```typescript\nconst x = 1;\n```");
    const root = frag(html);
    expect(root.querySelector("pre.shiki, .shiki")).not.toBeNull();
  });

  it("falls back without throwing for an unknown language fence", () => {
    expect(() => render("```not-a-real-lang\nplain text\n```")).not.toThrow();
  });

  it("adds with-line-numbers only when showLineNumbers is enabled", () => {
    // Use a guaranteed-loaded grammar so the Shiki transformer pipeline (and its pre()
    // hook that adds the class) runs rather than the unknown-lang fallback path.
    const src = "```typescript\nconst a = 1;\n```";
    const off = frag(render(src, { showLineNumbers: false }).html);
    const on = frag(render(src, { showLineNumbers: true }).html);
    expect(off.querySelector(".with-line-numbers")).toBeNull();
    expect(on.querySelector(".with-line-numbers")).not.toBeNull();
  });
});

describe("markdown: inline math integration", () => {
  it("renders inline KaTeX without throwing on valid TeX", () => {
    const { html } = render("Mass-energy is $E = mc^2$ today.");
    expect(frag(html).querySelector(".katex")).not.toBeNull();
  });

  it("renders block math into a .katex-display element", () => {
    const { html } = render("$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$");
    expect(frag(html).querySelector(".katex-display")).not.toBeNull();
  });
});
