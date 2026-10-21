import { afterEach, expect, it, vi } from "vitest";
import { paintFootnoteMarkers } from "../src/export/footnoteMarkers";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function fixture(firstBaselineOffset = 14) {
  document.body.innerHTML = `<div class="pagedjs_pages">
    <div class="pagedjs_page"><h1 id="fn1">ID collision</h1>
      <sup class="footnote-ref"><a href="#note-generated-1">[1]</a></sup>
      <sup class="footnote-ref"><a href="#note-generated-12">[12]</a></sup>
    </div><div class="pagedjs_page">
      <sup class="footnote-ref"><a href="#note-generated-1">[1:1]</a></sup>
      <div class="pagedjs_footnote_area" style="position:relative">
        <div class="pagedjs_footnote_inner_content">
          <span class="footnote" id="note-generated-1" data-id="fn1-footnote-1" data-footnote-marker="generated-1">First note</span>
          <span class="footnote" id="note-generated-12" data-footnote-marker="generated-12">Twelfth note</span>
          <span class="footnote" data-footnote-marker="generated-12" data-split-from="generated-12">Continued note</span>
        </div>
      </div>
    </div>
  </div>`;
  const source = document.querySelectorAll<HTMLElement>(".pagedjs_page")[1]!;
  const sheet = source.cloneNode(true) as HTMLElement;
  document.body.append(sheet);
  const anchor = sheet.querySelector<HTMLElement>(".pagedjs_footnote_area")!;
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 100, 400, 80));
  const notes = [...sheet.querySelectorAll<HTMLElement>(".footnote")];
  notes.forEach((note, index) => {
    note.style.cssText = "display:list-item;line-height:18px;font-size:12px;padding:0;border:0;counter-increment:footnote-marker;opacity:.8";
    vi.spyOn(note, "getBoundingClientRect").mockReturnValue(new DOMRect(30, 120 + index * 18, 380, 18));
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.style.display !== "inline-block") return new DOMRect();
    if (this.parentElement?.hasAttribute("data-raster-footnote-marker")) return new DOMRect(0, 14, 0, 0);
    const index = notes.indexOf(this.parentElement!);
    return new DOMRect(0, 120 + index * 18 + (index === 0 ? firstBaselineOffset : 14), 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (this: HTMLElement) {
    return this.closest(".pagedjs_footnote_area");
  });
  const nativeMarker = document.createElement("span").style;
  nativeMarker.cssText = 'content:counter(footnote-marker) ". ";font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;color:rgb(75,85,99);visibility:visible';
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => pseudo === "::marker" ? nativeMarker : getStyle(element));
  vi.spyOn(document, "createRange").mockReturnValue({
    setStartBefore: vi.fn(), setEndAfter: vi.fn(), getClientRects: () => [],
  } as unknown as Range);
  return { source, sheet, anchor, notes, nativeMarker };
}

it("paints the linked global number in reserved clone space while preserving IDs, counters and source", () => {
  const { source, sheet, anchor, notes } = fixture();
  const liveBefore = source.closest(".pagedjs_pages")!.outerHTML;
  const styles = notes.map(note => note.getAttribute("style"));
  paintFootnoteMarkers(sheet, source);
  const paints = [...sheet.querySelectorAll<HTMLElement>("[data-raster-footnote-marker]")];
  expect(paints.map(paint => paint.textContent)).toEqual(["1. ", "12. "]);
  expect(paints.map(paint => paint.parentElement)).toEqual(notes.slice(0, 2));
  expect(paints.map(paint => paint.style.left)).toEqual(["20px", "20px"]);
  expect(paints.map(paint => paint.style.top)).toEqual(["20px", "38px"]);
  expect(paints[0]!.style.position).toBe("absolute");
  expect(paints[0]!.style.fontVariantNumeric).toBe("tabular-nums");
  expect(paints[0]!.style.color).toBe("rgb(75, 85, 99)");
  expect(paints.every(paint => paint.children.length === 0), "baseline probes must be gone before capture").toBe(true);
  expect(notes.map(note => note.getAttribute("style"))).toEqual(styles);
  expect(notes[0]!.id).toBe("note-generated-1");
  expect(notes[0]!.dataset.id).toBe("fn1-footnote-1");
  expect(anchor.getAttribute("style")).toBe("position:relative");
  expect(source.closest(".pagedjs_pages")!.outerHTML).toBe(liveBefore);
});

it("aligns to a tall first line's baseline instead of the note's top edge", () => {
  const { source, sheet } = fixture(56);
  paintFootnoteMarkers(sheet, source);
  expect(sheet.querySelector<HTMLElement>("[data-raster-footnote-marker]")!.style.top).toBe("62px");
});

it("rejects a probe that would create a new line and removes it", () => {
  const { source, sheet, notes } = fixture();
  const note = notes[0]!;
  const original = note.innerHTML;
  vi.mocked(note.getBoundingClientRect).mockImplementation(() => new DOMRect(30, 120, 380,
    note.firstChild instanceof HTMLElement && note.firstChild.style.display === "inline-block" ? 36 : 18));
  expect(() => paintFootnoteMarkers(sheet, source)).toThrow("could not align a footnote marker without changing its layout");
  expect(note.innerHTML).toBe(original);
});

it.each([['"custom"', "visible"], ["none", "visible"], ['counter(footnote-marker) ". "', "hidden"]])(
  "preserves explicitly customized or hidden native markers (%s, %s)", (content, visibility) => {
    const { source, sheet, nativeMarker } = fixture();
    nativeMarker.content = content;
    nativeMarker.visibility = visibility;
    paintFootnoteMarkers(sheet, source);
    expect(sheet.querySelector("[data-raster-footnote-marker]")).toBeNull();
  },
);

it("rejects an unresolved generated destination rather than exporting a guessed number", () => {
  const { source, sheet, notes } = fixture();
  notes[0]!.id = "missing-target";
  expect(() => paintFootnoteMarkers(sheet, source)).toThrow("could not resolve a footnote marker");
});
