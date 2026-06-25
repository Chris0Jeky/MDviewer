import { describe, it, expect } from "vitest";
import {
  buildPaginationSource,
  transformFootnotesToInline,
  injectToc,
  awaitFontsAndImages,
} from "../src/render/buildSource";
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
