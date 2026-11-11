import { describe, expect, it } from "vitest";
import { ATTRS } from "../src/app/dom";
import { withSplitWarning } from "../src/app/App";
import { restoreDisplayedElements } from "../src/paginate/handler";
import { auditPagination } from "../src/paginate/paginate";
import { markOverTallSplittable, SPLITTABLE_ATTR } from "../src/paginate/shrinkToFit";

const AREA = { widthPx: 600, heightPx: 1000 };

function html(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root;
}

describe("restoreDisplayedElements", () => {
  it("clears Paged.js's hidden mark from a visible inline-styled block but keeps a hidden one", () => {
    const root = html(
      '<pre style="background-color:#fff" data-undisplayed="undisplayed"></pre>' +
        '<span style="display:none" data-undisplayed="undisplayed"></span>',
    );
    restoreDisplayedElements(root);
    expect(root.querySelector("pre")!.hasAttribute("data-undisplayed")).toBe(false);
    expect(root.querySelector("span")!.hasAttribute("data-undisplayed")).toBe(true);
  });
});

describe("markOverTallSplittable (Tier 4)", () => {
  const block = (tag: string, height: number, extra = ""): string =>
    `<${tag} data-mdv-atomic-id="a-${tag}-${height}" ${ATTRS.atomicSourceHeight}="${height}" ${extra}></${tag}>`;

  it("marks over-tall splittable families and leaves fitting, shrunk and media blocks keep-whole", () => {
    const root = html(
      block("pre", 1500) +
        block("table", 1100) +
        block("blockquote", 1003) +
        '<div class="callout callout-note" data-mdv-atomic-id="c" data-mdv-source-height="2000"></div>' +
        block("pre", 1001) +
        block("pre", 1100, `${ATTRS.shrunk}="0.9"`) +
        block("figure", 3000),
    );
    markOverTallSplittable(root, AREA);
    const marked = Array.from(root.querySelectorAll(`[${SPLITTABLE_ATTR}]`)).map((el) => el.tagName);
    expect(marked).toEqual(["PRE", "TABLE", "BLOCKQUOTE", "DIV"]);
  });
});

describe("auditPagination", () => {
  const page = (inner: string): string =>
    `<div class="pagedjs_page"><div class="pagedjs_page_content">${inner}</div></div>`;

  it("passes a complete run", () => {
    const source = html('<p data-ref="1">one</p><p data-ref="2">two</p>');
    const host = html(page('<p data-ref="1">one</p>') + page('<p data-ref="2">two</p>'));
    expect(auditPagination(source, host)).toBeNull();
  });

  it("blames the keep-whole block holding the first unrendered text", () => {
    const source = html(
      '<p data-ref="1">one</p><pre data-ref="2" data-mdv-atomic-id="atomic-7"><span data-ref="3">tail</span></pre>',
    );
    const host = html(page('<p data-ref="1">one</p><pre data-ref="2"></pre>'));
    expect(auditPagination(source, host)).toEqual({
      problem: "content was left unrendered",
      atomicId: "atomic-7",
    });
  });

  it("flags an empty page and content laid out twice", () => {
    const source = html('<p data-ref="1">one</p>');
    expect(auditPagination(source, html(page('<p data-ref="1">one</p>') + page("")))?.problem).toBe(
      "page 2 is empty",
    );
    const twice = page('<p data-ref="1">one</p>');
    expect(
      auditPagination(source, html(twice + page('<p data-ref="9">x</p>') + twice))?.problem,
    ).toBe("content repeats on page 3");
  });
});

describe("withSplitWarning", () => {
  it("only warns after a recovery run, naming at most three blocks", () => {
    expect(withSplitWarning([], undefined)).toEqual([]);
    expect(withSplitWarning([], [])[0]!.message).toMatch(/relaxed page breaks/);
    const message = withSplitWarning([], ["a", "b", "c", "d"])[0]!.message;
    expect(message).toContain("a, b, c and 1 more");
  });
});
