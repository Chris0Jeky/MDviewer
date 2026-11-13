import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_ZOOM_VAR } from "../src/app/dom";
import { auditPagination, paginate, PaginationIncompleteError } from "../src/paginate/paginate";

// Layout is meaningless in jsdom, so Paged.js is replaced by a script that writes the pages
// each attempt should "lay out". What is under test is paginate's own control flow: the
// audit, the recovery rungs, the stale stop and the cleanup, plus the audit's geometry.
const layout = vi.hoisted(() => vi.fn());
vi.mock("pagedjs", () => ({
  Previewer: class {
    preview(attempt: DocumentFragment, sheets: string[], host: HTMLElement): Promise<{ total: number }> {
      return layout(attempt, sheets, host);
    }
  },
}));

const page = (inner: string, footnotes = ""): string =>
  '<div class="pagedjs_page"><div class="pagedjs_page_content">' +
  `${inner}</div><div class="pagedjs_footnote_area">${footnotes}</div></div>`;

function html(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root;
}

function fragment(markup: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = markup;
  return template.content;
}

/** Write `markup` into the host the way Paged.js does and resolve like a finished run. */
function lay(host: HTMLElement, markup: string): Promise<{ total: number }> {
  host.innerHTML = `<div class="pagedjs_pages">${markup}</div>`;
  return Promise.resolve({ total: host.querySelectorAll(".pagedjs_page").length });
}

const SOURCE =
  '<p data-ref="p1">intro</p>' +
  '<pre data-ref="b1" data-mdv-atomic-id="atomic-1">one</pre>' +
  '<pre data-ref="b2" data-mdv-atomic-id="atomic-2">two</pre>';
const MARKED = '[data-mdv-splittable="recovery"]';
/** Every source block rendered, then an empty last page with no keep-whole block after it. */
const TRAILING_BLANK = page('<p data-ref="p1">intro</p><pre data-ref="b1">one</pre><pre data-ref="b2">two</pre>') + page("");

let revoked: string[];
beforeEach(() => {
  revoked = [];
  let next = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: () => `blob:run-${(next += 1)}`,
      revokeObjectURL: (url: string) => revoked.push(url),
    }),
  );
  layout.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("paginate recovery rungs", () => {
  it("retries with the offender split, then with every splittable block, and reports what split", async () => {
    const host = document.createElement("div");
    const seen: string[][] = [];
    layout.mockImplementation((attempt: DocumentFragment, _sheets: string[], target: HTMLElement) => {
      seen.push(Array.from(attempt.querySelectorAll(MARKED), (el) => el.getAttribute("data-mdv-atomic-id")!));
      // Run 1 leaves an empty page 2 right before atomic-2, so the audit blames atomic-2.
      const whole = '<p data-ref="p1">intro</p><pre data-ref="b1">one</pre>';
      const tail = '<pre data-ref="b2" data-mdv-atomic-id="atomic-2">two</pre>';
      if (seen.length === 1) return lay(target, page(whole) + page("") + page(tail));
      // Run 2 (only atomic-2 split) still fails, and now names nobody.
      if (seen.length === 2) return lay(target, page(whole + tail) + page(""));
      const split = (id: string, ref: string, text: string): string =>
        `<pre data-ref="${ref}" data-mdv-atomic-id="${id}" data-mdv-splittable="recovery">${text}</pre>`;
      return lay(
        target,
        page(`<p data-ref="p1">intro</p>${split("atomic-1", "b1", "one")}${split("atomic-2", "b2", "tw")}`) +
          page(split("atomic-2", "b2", "o")),
      );
    });

    const flow = await paginate(fragment(SOURCE), "css", host);

    expect(seen).toEqual([[], ["atomic-2"], ["atomic-1", "atomic-2"]]);
    expect(flow.recoveredSplits, "only the block that really split is reported").toEqual(["code block"]);
    expect(revoked, "every run's stylesheet URL is revoked").toEqual(["blob:run-1", "blob:run-2", "blob:run-3"]);
  });

  it("goes straight to the 'all' rung when the audit names no block, and that rung can succeed", async () => {
    const host = document.createElement("div");
    const marked: number[] = [];
    layout.mockImplementation((attempt: DocumentFragment, _sheets: string[], target: HTMLElement) => {
      marked.push(attempt.querySelectorAll(MARKED).length);
      // Run 1 leaves an empty last page and no keep-whole block follows it to blame.
      if (marked.length === 1) return lay(target, TRAILING_BLANK);
      return lay(target, page('<p data-ref="p1">intro</p><pre data-ref="b1">one</pre><pre data-ref="b2">two</pre>'));
    });

    const flow = await paginate(fragment(SOURCE), "css", host);

    expect(marked).toEqual([0, 2]);
    expect(flow.recoveredSplits, "recovery ran but nothing actually split").toEqual([]);
    expect(host.querySelectorAll(".pagedjs_page")).toHaveLength(1);
  });

  it("refuses an incomplete document once every rung failed, leaving no pages or zoom override", async () => {
    const host = document.createElement("div");
    layout.mockImplementation((_a: DocumentFragment, _s: string[], target: HTMLElement) =>
      lay(target, TRAILING_BLANK),
    );

    await expect(paginate(fragment(SOURCE), "css", host)).rejects.toBeInstanceOf(PaginationIncompleteError);

    expect(layout).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".pagedjs_pages")).toBeNull();
    expect(host.style.getPropertyValue(PREVIEW_ZOOM_VAR)).toBe("");
    expect(revoked).toHaveLength(2);
  });
});

describe("paginate cleanup when layout throws", () => {
  it("revokes the stylesheet URL and gives the zoom and visibility back", async () => {
    const host = document.createElement("div");
    host.style.setProperty(PREVIEW_ZOOM_VAR, "0.5");
    layout.mockRejectedValue(new Error("layout blew up"));

    await expect(paginate(fragment(SOURCE), "css", host)).rejects.toThrow("layout blew up");

    expect(revoked).toEqual(["blob:run-1"]);
    expect(host.style.getPropertyValue(PREVIEW_ZOOM_VAR)).toBe("");
    expect(host.style.visibility).toBe("");
  });
});

describe("auditPagination geometry", () => {
  const rect = (top: number, bottom: number, left = 0, right = 100): DOMRect =>
    ({ top, bottom, left, right, width: right - left, height: bottom - top }) as DOMRect;

  /** One page whose content box spans 0..100 on both axes and whose block sits at `block`. */
  function withBlock(block: DOMRect): HTMLElement {
    const host = html(page('<pre data-ref="b1" data-mdv-atomic-id="atomic-9">x</pre>'));
    host.querySelector(".pagedjs_page_content")!.getBoundingClientRect = () => rect(0, 100, 0, 100);
    host.querySelector("pre")!.getBoundingClientRect = () => block;
    return host;
  }
  const source = html('<pre data-ref="b1" data-mdv-atomic-id="atomic-9">x</pre>');

  it("passes a block inside the content box and one within the rounding tolerance", () => {
    expect(auditPagination(source, withBlock(rect(10, 60, 0, 50)))).toBeNull();
    expect(auditPagination(source, withBlock(rect(10, 101.5, 0, 50)))).toBeNull();
  });

  it("flags a block below the content box and blames its keep-whole block", () => {
    expect(auditPagination(source, withBlock(rect(50, 130, 0, 50)))).toEqual({
      problem: "a block on page 1 lies outside the page",
      atomicId: "atomic-9",
    });
  });

  it("flags a block parked in a hidden overflow column to the right", () => {
    expect(auditPagination(source, withBlock(rect(10, 60, 100, 180)))?.problem).toBe(
      "a block on page 1 lies outside the page",
    );
  });

  it("ignores a collapsed block, wherever it sits", () => {
    expect(auditPagination(source, withBlock(rect(200, 200, 300, 300)))).toBeNull();
  });
});

describe("auditPagination unrendered text", () => {
  it("sees a tail lost inside one plain text node", () => {
    const source = html('<ul data-mdv-atomic-id="atomic-4"><li data-ref="1">alpha beta gamma delta</li></ul>');
    const host = html(page('<ul><li data-ref="1">alpha beta</li></ul>'));
    expect(auditPagination(source, host)?.problem).toBe("content was left unrendered");
  });

  it("accepts a text node split across pages and reflowed whitespace", () => {
    const source = html('<p data-ref="1">alpha  beta\n gamma delta</p>');
    const host = html(page('<p data-ref="1">alpha beta </p>') + page('<p data-ref="1">gamma delta</p>'));
    expect(auditPagination(source, host)).toBeNull();
  });
});

describe("auditPagination notes-only pages", () => {
  const source = html('<p data-ref="1">closing</p>');

  it("treats a page whose notes sit in its footnote area as complete", () => {
    const host = html(
      page('<p data-ref="1">closing</p>') + page("", '<span data-ref="9">Footnote 80 continues here</span>'),
    );
    expect(auditPagination(source, host)).toBeNull();
  });

  it("still flags a page with nothing in its body or its footnote area", () => {
    expect(auditPagination(source, html(page('<p data-ref="1">closing</p>') + page("")))?.problem).toBe(
      "page 2 is empty",
    );
  });
});
