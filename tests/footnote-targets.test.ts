import { describe, expect, it } from "vitest";
import { repairFootnoteLinks } from "../src/paginate/footnoteLinks";
import { transformFootnotesToInline } from "../src/render/buildSource";

describe("floated footnote anchor identity (#61)", () => {
  it("keeps first and repeated citations connected to exactly one note", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p>
      <sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>
      <sup class="footnote-ref"><a href="#fn1" id="fnref1:1">[1:1]</a></sup>
      <sup class="footnote-ref"><a href="#fn2" id="fnref2">[2]</a></sup>
    </p><section class="footnotes"><ol>
      <li class="footnote-item" id="fn1"><p>First note</p></li>
      <li class="footnote-item" id="fn2"><p>Second note</p></li>
    </ol></section>`;
    transformFootnotesToInline(root);
    expect(root.querySelector("section.footnotes")).toBeNull();
    expect(root.querySelectorAll("span.footnote")).toHaveLength(2);
    for (const link of root.querySelectorAll<HTMLAnchorElement>("sup.footnote-ref a")) {
      const id = link.getAttribute("href")!.slice(1);
      const targets = Array.from(root.querySelectorAll("[id]")).filter((el) => el.id === id);
      expect(targets).toHaveLength(1);
      expect(targets[0]?.className).toBe("footnote");
    }
    expect(root.querySelector("#fn1")?.textContent).toBe("First note");
    expect(root.querySelector("#fn2")?.textContent).toBe("Second note");
  });

  it("supports a bare anchor reference without changing its href", () => {
    const root = document.createElement("div");
    root.innerHTML = `<a class="footnote-ref" href="#fn9">[9]</a>
      <section class="footnotes"><ol><li id="fn9"><p>Note</p></li></ol></section>`;
    transformFootnotesToInline(root);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("#fn9");
    expect(root.querySelector("span.footnote")?.id).toBe("fn9");
  });

  it("leaves unmatched source footnotes untouched", () => {
    const root = document.createElement("div");
    root.innerHTML = `<section class="footnotes"><ol><li id="fn1"><p>Note</p></li></ol></section>`;
    const before = root.innerHTML;
    transformFootnotesToInline(root);
    expect(root.innerHTML).toBe(before);
  });
});

describe("Paged.js generated footnote destinations", () => {
  it("repairs first and repeated citations without renaming generated targets", () => {
    const host = document.createElement("div");
    host.innerHTML = `<sup class="footnote-ref"><a href="#fn1">[1]</a></sup>
      <sup class="footnote-ref"><a href="#fn1">[1:1]</a></sup>
      <a class="footnote-ref" href="#missing">[2]</a>
      <a href="#fn1">unrelated link</a>
      <span id="note-ref" data-id="fn1" data-footnote-marker="ref">Note</span>`;
    repairFootnoteLinks(host);
    repairFootnoteLinks(host);
    expect(Array.from(host.querySelectorAll("sup a"), (a) => a.getAttribute("href"))).toEqual(["#note-ref", "#note-ref"]);
    expect(host.querySelector("span")?.id).toBe("note-ref");
    expect(host.querySelector("a.footnote-ref")?.getAttribute("href")).toBe("#missing");
    expect(host.querySelector("a[href='#fn1']")?.textContent).toBe("unrelated link");
  });
});
