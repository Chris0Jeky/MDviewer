import { describe, it, expect, beforeAll } from "vitest";
import type { HighlighterCore } from "shiki/core";
import {
  buildPaginationSource,
  transformFootnotesToInline,
  injectToc,
  awaitFontsAndImages,
  stampAtomicBlocks,
} from "../src/render/buildSource";
import { createMarkdown, renderMarkdown } from "../src/render/markdown";
import { getHighlighter } from "../src/render/highlight";
import { DEFAULT_SETTINGS, type Settings } from "../src/app/settings";

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

/** Render a DocumentFragment's outer markup for assertions. */
function fragHtml(frag: DocumentFragment): string {
  const host = document.createElement("div");
  host.appendChild(frag.cloneNode(true));
  return host.innerHTML;
}

/** Build a detached root containing inner HTML. */
function rootOf(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("buildPaginationSource", () => {
  it("returns a DocumentFragment", () => {
    const out = buildPaginationSource("<p>hello</p>", settings());
    expect(out).toBeInstanceOf(DocumentFragment);
  });

  it("wraps content in a .doc root carrying the document html", () => {
    const out = buildPaginationSource("<h1>Title</h1><p>body</p>", settings());
    const host = document.createElement("div");
    host.appendChild(out);
    const doc = host.querySelector(".doc");
    expect(doc).not.toBeNull();
    expect(doc?.querySelector("h1")?.textContent).toBe("Title");
    expect(doc?.textContent).toContain("body");
  });

  it("preserves the original rendered content verbatim", () => {
    const out = buildPaginationSource(
      '<pre class="shiki"><code>const x = 1;</code></pre>',
      settings(),
    );
    expect(fragHtml(out)).toContain("const x = 1;");
  });

  it("produces an independent fragment per call (no shared mutable DOM)", () => {
    const a = buildPaginationSource("<p>one</p>", settings());
    const b = buildPaginationSource("<p>two</p>", settings());
    expect(fragHtml(a)).toContain("one");
    expect(fragHtml(a)).not.toContain("two");
    expect(fragHtml(b)).toContain("two");
  });
});

describe("transformFootnotesToInline", () => {
  const FOOTNOTE_HTML = [
    "<p>Body text with a reference",
    '<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>.</p>',
    '<section class="footnotes">',
    '<ol class="footnotes-list">',
    '<li id="fn1" class="footnote-item"><p>The note body.',
    '<a href="#fnref1" class="footnote-backref">↩</a></p></li>',
    "</ol></section>",
  ].join("");

  it("removes the end-of-document footnotes section", () => {
    const root = rootOf(FOOTNOTE_HTML);
    expect(root.querySelector("section.footnotes")).not.toBeNull();
    transformFootnotesToInline(root);
    expect(root.querySelector("section.footnotes")).toBeNull();
  });

  it("relocates the note body inline at the reference site", () => {
    const root = rootOf(FOOTNOTE_HTML);
    transformFootnotesToInline(root);
    // The note text must survive somewhere inline (for Paged.js float:footnote).
    expect(root.textContent ?? "").toContain("The note body.");
  });

  it("is a no-op when there are no footnotes", () => {
    const root = rootOf("<p>Just prose, no footnotes.</p>");
    const before = root.innerHTML;
    expect(() => transformFootnotesToInline(root)).not.toThrow();
    expect(root.innerHTML).toBe(before);
  });

  // A footnote cited twice produces two call markers ([1] and [1:1]) pointing at the same
  // #fn1. Floating BOTH would make Paged.js print the note twice at the page foot and
  // advance its own marker counter past markdown-it's visible [n] numbering, so every
  // later note's foot marker would name the wrong note.
  it("floats one note per footnote even when it is referenced repeatedly", () => {
    const root = rootOf(
      [
        "<p>Alpha",
        '<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>',
        " and beta",
        '<sup class="footnote-ref"><a href="#fn1" id="fnref1:1">[1:1]</a></sup>',
        " and a second note",
        '<sup class="footnote-ref"><a href="#fn2" id="fnref2">[2]</a></sup>.</p>',
        '<section class="footnotes"><ol class="footnotes-list">',
        '<li id="fn1" class="footnote-item"><p>Shared note.</p></li>',
        '<li id="fn2" class="footnote-item"><p>Second note.</p></li>',
        "</ol></section>",
      ].join(""),
    );

    transformFootnotesToInline(root);

    const spans = Array.from(root.querySelectorAll("span.footnote"));
    expect(spans.map((s) => s.textContent)).toEqual(["Shared note.", "Second note."]);
    // Both call markers survive — only the duplicated float is dropped.
    expect(root.querySelectorAll("sup.footnote-ref")).toHaveLength(3);
    // The single float sits at the FIRST citation, not the repeat.
    expect(spans[0]?.previousElementSibling?.querySelector("a")?.id).toBe("fnref1");
  });
});

describe("injectToc", () => {
  const HEADINGS = '<h1 id="alpha">Alpha</h1><h2 id="beta">Beta</h2><h3 id="gamma">Gamma</h3>';

  it("injects a nav.toc when showToc is true and a [[toc]] placeholder/heading set exists", () => {
    const root = rootOf(HEADINGS);
    injectToc(root, settings({ showToc: true }));
    const toc = root.querySelector("nav.toc, .toc");
    expect(toc).not.toBeNull();
  });

  it("does not inject a TOC when showToc is false", () => {
    const root = rootOf(HEADINGS);
    injectToc(root, settings({ showToc: false }));
    expect(root.querySelector("nav.toc")).toBeNull();
  });

  it("links TOC entries to existing heading ids", () => {
    const root = rootOf(HEADINGS);
    injectToc(root, settings({ showToc: true }));
    const hrefs = Array.from(root.querySelectorAll(".toc a, nav.toc a")).map((a) =>
      (a.getAttribute("href") ?? "").replace(/^#/, ""),
    );
    if (hrefs.length > 0) {
      const ids = new Set(Array.from(root.querySelectorAll("[id]")).map((e) => e.id));
      for (const href of hrefs) expect(ids.has(href)).toBe(true);
    }
  });

  // BUG-7: the synthesized TOC used to be prepended before the first element, landing
  // ABOVE the document title. The deterministic rule is "immediately after the first h1".
  describe("placement of a synthesized TOC", () => {
    it("inserts the nav immediately after the first h1", () => {
      const root = rootOf(`<h1 id="alpha">Alpha</h1><p>intro</p><h2 id="beta">Beta</h2>`);
      injectToc(root, settings({ showToc: true }));

      const children = Array.from(root.children);
      const h1Index = children.findIndex((el) => el.tagName === "H1");
      const navIndex = children.findIndex((el) => el.matches("nav.toc"));
      expect(h1Index).toBe(0);
      expect(navIndex).toBe(h1Index + 1);
    });

    it("falls back to the top of the document when there is no h1", () => {
      const root = rootOf(`<p>lead-in</p><h2 id="beta">Beta</h2><h3 id="gamma">Gamma</h3>`);
      injectToc(root, settings({ showToc: true }));
      expect(root.firstElementChild?.matches("nav.toc")).toBe(true);
    });

    it("leaves an author-placed [[toc]] where it is", () => {
      const root = rootOf(
        `<h1 id="alpha">Alpha</h1><p>intro</p><nav class="toc"><ul><li><a href="#alpha">Alpha</a></li></ul></nav><h2 id="beta">Beta</h2>`,
      );
      injectToc(root, settings({ showToc: true }));
      const navs = root.querySelectorAll("nav.toc");
      expect(navs).toHaveLength(1);
      expect(Array.from(root.children).findIndex((el) => el.matches("nav.toc"))).toBe(2);
    });
  });

  // UX-8: the leader-dot fallback needs the title in its own flex item, otherwise the
  // dotted rule has nothing to grow against and runs past the page number.
  describe("span.toc-text", () => {
    it("wraps each entry title in the synthesized path", () => {
      const root = rootOf(HEADINGS);
      injectToc(root, settings({ showToc: true }));
      const links = Array.from(root.querySelectorAll("a.toc-link"));
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const text = link.querySelector(".toc-text");
        expect(text, "every synthesized toc-link needs a .toc-text").not.toBeNull();
        expect((text?.textContent ?? "").trim().length).toBeGreaterThan(0);
      }
    });

    it("wraps each entry title in the normalize ([[toc]]) path", () => {
      const root = rootOf(
        `<nav class="toc"><ul><li><a href="#alpha">Alpha</a><ul><li><a href="#beta">Beta</a></li></ul></li></ul></nav><h1 id="alpha">Alpha</h1><h2 id="beta">Beta</h2>`,
      );
      injectToc(root, settings({ showToc: true }));
      const links = Array.from(root.querySelectorAll("a.toc-link"));
      expect(links).toHaveLength(2);
      expect(links.map((a) => a.querySelector(".toc-text")?.textContent)).toEqual([
        "Alpha",
        "Beta",
      ]);
      // Nested sub-lists are siblings of the link and must not be swallowed by the span.
      expect(root.querySelectorAll("nav.toc ul ul li").length).toBe(1);
    });

    it("is idempotent (a second normalize pass does not double-wrap)", () => {
      const root = rootOf(
        `<nav class="toc"><ul><li><a href="#alpha">Alpha</a></li></ul></nav><h1 id="alpha">Alpha</h1>`,
      );
      injectToc(root, settings({ showToc: true }));
      injectToc(root, settings({ showToc: true }));
      expect(root.querySelectorAll("a.toc-link .toc-text")).toHaveLength(1);
      expect(root.querySelector("a.toc-link .toc-text .toc-text")).toBeNull();
    });
  });
});

/**
 * BUG-3: `permalink.headerLink()` wraps the ENTIRE heading text in `a.header-anchor`, so
 * the old "delete every header-anchor" rule emptied every TOC entry. These fixtures are
 * REAL `createMarkdown(...).render()` output, not hand-written HTML, so the test breaks if
 * the permalink style ever changes shape again.
 */
describe("injectToc against real markdown-it output", () => {
  let hl: HighlighterCore;

  beforeAll(async () => {
    hl = await getHighlighter();
  }, 30_000);

  function renderDoc(src: string): HTMLElement {
    const md = createMarkdown(hl, { ...DEFAULT_SETTINGS });
    return rootOf(renderMarkdown(md, src).html);
  }

  const SRC = [
    "# Report Title",
    "",
    "Intro paragraph.",
    "",
    "## Ünïcödé 🎉 Heading",
    "",
    "Body.",
    "",
    "### 1. Numbered Subsection",
    "",
    "More body.",
  ].join("\n");

  it("headings really are wrapped in a.header-anchor (the precondition for BUG-3)", () => {
    const root = renderDoc(SRC);
    const h1 = root.querySelector("h1");
    expect(h1?.querySelector("a.header-anchor")?.textContent).toBe("Report Title");
  });

  it("gives every synthesized TOC entry non-empty text", () => {
    const root = renderDoc(SRC);
    injectToc(root, settings({ showToc: true }));

    const texts = Array.from(root.querySelectorAll("a.toc-link")).map((a) =>
      (a.textContent ?? "").trim(),
    );
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toBe("");
    expect(texts).toEqual(["Report Title", "Ünïcödé 🎉 Heading", "1. Numbered Subsection"]);
  });

  it("still strips a glyph-style permalink that sits beside the heading text", () => {
    const root = rootOf(
      '<h2 id="beta">Beta<a class="header-anchor" href="#beta" aria-hidden="true">¶</a></h2>',
    );
    injectToc(root, settings({ showToc: true }));
    expect(root.querySelector("a.toc-link .toc-text")?.textContent).toBe("Beta");
  });

  /**
   * RESIDUAL (documented, not fixed): SLUGIFY drops every non-ASCII character, so ids for
   * non-Latin headings are lossy. It is NOT a correctness bug — markdown-it-anchor
   * de-duplicates colliding slugs (`caf`, `caf-1`) and the TOC link text is now correct
   * either way. Making SLUGIFY unicode-aware would percent-encode the id, and
   * handler.ts:fillTocPageNumbers resolves targets via `decodeURIComponent(href)`, so the
   * screen-preview page numbers would stop resolving. Locked down here so the trade-off is
   * visible if anyone revisits it.
   */
  it("documents the ASCII-only slug behaviour and its de-duplication", () => {
    const root = renderDoc("## Café\n\n## Caf\n\n## Ünïcödé\n");
    const ids = Array.from(root.querySelectorAll("h2")).map((h) => h.id);
    expect(ids).toEqual(["caf", "caf-1", "ncd"]);
    expect(new Set(ids).size, "ids stay unique despite the lossy slug").toBe(ids.length);

    injectToc(root, settings({ showToc: true }));
    expect(
      Array.from(root.querySelectorAll("a.toc-link .toc-text")).map((s) => s.textContent),
    ).toEqual(["Café", "Caf", "Ünïcödé"]);
  });
});

describe("awaitFontsAndImages", () => {
  it("resolves on a root with no images", async () => {
    const root = rootOf("<p>text only</p>");
    await expect(awaitFontsAndImages(root)).resolves.toBeUndefined();
  });

  it("short-circuits already-loaded images (complete with natural size)", async () => {
    const root = rootOf("");
    const img = document.createElement("img");
    // A fully-loaded image: the helper skips it entirely and resolves at once.
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    root.appendChild(img);
    await expect(awaitFontsAndImages(root)).resolves.toBeUndefined();
  });

  it("resolves when a pending image finishes loading", async () => {
    const root = rootOf("");
    const img = document.createElement("img");
    // Not complete yet -> the helper waits for the load event (jsdom has no img.decode).
    Object.defineProperty(img, "complete", { value: false });
    root.appendChild(img);

    const pending = awaitFontsAndImages(root);
    // Listeners attach synchronously; firing load on the next tick lets the helper settle.
    queueMicrotask(() => img.dispatchEvent(new Event("load")));
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves (never rejects) when a pending image errors out", async () => {
    const root = rootOf("");
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: false });
    root.appendChild(img);

    const pending = awaitFontsAndImages(root);
    queueMicrotask(() => img.dispatchEvent(new Event("error")));
    await expect(pending).resolves.toBeUndefined();
  });
});

describe("stampAtomicBlocks", () => {
  it("stamps stable ids on outermost atomic blocks only", () => {
    const root = rootOf(
      '<pre class="shiki"><code>x</code></pre><figure class="mermaid-figure"><svg></svg></figure><blockquote>q</blockquote>',
    );
    expect(stampAtomicBlocks(root)).toBe(3);
    const stamped = Array.from(root.querySelectorAll<HTMLElement>("[data-mdv-atomic-id]"));
    expect(stamped.map((element) => element.dataset.mdvAtomicId)).toEqual([
      "atomic-1",
      "atomic-2",
      "atomic-3",
    ]);
    expect(root.querySelector("pre")?.dataset.mdvAtomicId).toBe("atomic-1");
    expect(root.querySelector("code")?.hasAttribute("data-mdv-atomic-id")).toBe(false);
  });

  it("covers every standalone atomic selector family from the no-slice contract", () => {
    const root = rootOf(
      '<img alt="fixture"><svg></svg><ul><li>one</li><li>two</li></ul><aside class="callout-warning">careful</aside>',
    );

    expect(stampAtomicBlocks(root)).toBe(5);
    for (const selector of ["img", "svg", "li", ".callout-warning"]) {
      const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
      expect(elements.length).toBeGreaterThan(0);
      expect(elements.every((element) => Boolean(element.dataset.mdvAtomicId))).toBe(true);
    }
  });
});
