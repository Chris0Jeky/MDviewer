import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { renderReaderDocument } from "../src/desktop/render";
import { patchDocument } from "../src/desktop/reader/patch";
import { sourceOf } from "../src/desktop/reader/copy";

const FENCE = ["```ts", "const kept: number = 1;", "```"];
const BEFORE = ["# Notes", "", "First paragraph.", "", ...FENCE, "", "Last paragraph.", ""].join("\n");
const AFTER = ["# Notes", "", "Inserted.", "", "First paragraph, edited.", "", ...FENCE, "", "Last paragraph.", ""].join("\n");

describe("reader block patching", () => {
  it("keeps unchanged blocks, replaces changed ones and moves kept line ranges", async () => {
    const live = (await renderReaderDocument(BEFORE, DEFAULT_SETTINGS, "notes.md")).document;
    const code = live.querySelector(".reader-code")!;
    const last = live.querySelector("p:last-of-type")!;
    expect(code.querySelector("pre.shiki:not(.reader-pending)")?.getAttribute("data-src")).toBe("5-7");

    let replaced = -1;
    const result = await renderReaderDocument(AFTER, DEFAULT_SETTINGS, "notes.md", first => {
      replaced = patchDocument(live, first);
      return live;
    });
    expect(result.document).toBe(live);
    expect(replaced).toBe(2); // the inserted and the edited paragraph
    expect(live.querySelector(".reader-code")).toBe(code); // highlighted code reused, not re-rendered
    expect(code.querySelector("pre")?.getAttribute("data-src")).toBe("7-9");
    expect(live.querySelector("pre.reader-pending")).toBeNull();
    expect(live.querySelector("p:last-of-type")).toBe(last);
    expect(last.getAttribute("data-src")).toBe("11-11");
    expect([...live.querySelectorAll(":scope > p")].map(p => p.textContent)).toEqual(["Inserted.", "First paragraph, edited.", "Last paragraph."]);
    expect(sourceOf(live)?.lines.join("\n")).toBe(AFTER);
  }, 30_000);

  it("replaces every block when the old document has no source", async () => {
    const live = document.createElement("div");
    live.innerHTML = "<p>stale</p>";
    const result = await renderReaderDocument("Fresh.", DEFAULT_SETTINGS, "x.md", first => { patchDocument(live, first); return live; });
    expect(result.document.textContent).toBe("Fresh.");
  });
});
