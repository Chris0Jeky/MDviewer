import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { renderReaderDocument } from "../src/desktop/render";
import { patchDocument } from "../src/desktop/reader/patch";
import { sourceOf } from "../src/desktop/reader/copy";

const FENCE = ["```ts", "const kept: number = 1;", "```"];
const BEFORE = ["# Notes", "", "First paragraph.", "", ...FENCE, "", "Last paragraph.", ""].join("\n");
const AFTER = ["# Notes", "", "Inserted.", "", "First paragraph, edited.", "", ...FENCE, "", "Last paragraph.", ""].join("\n");

async function patch(live: HTMLElement, text: string): Promise<number> {
  let replaced = -1;
  const result = await renderReaderDocument(text, DEFAULT_SETTINGS, "notes.md", first => {
    replaced = patchDocument(live, first);
    return live;
  });
  expect(result.document).toBe(live);
  return replaced;
}

describe("reader block patching", () => {
  it("keeps unchanged blocks, replaces changed ones and moves kept line ranges", async () => {
    const live = document.createElement("div");
    expect(await patch(live, BEFORE)).toBe(4);
    const code = live.querySelector(".reader-code")!;
    const last = live.querySelector("p:last-of-type")!;
    expect(code.querySelector("pre.shiki:not(.reader-pending)")?.getAttribute("data-src")).toBe("5-7");

    expect(await patch(live, AFTER)).toBe(2); // the inserted and the edited paragraph
    expect(live.querySelector(".reader-code")).toBe(code); // highlighted code reused, not re-rendered
    expect(code.querySelector("pre")?.getAttribute("data-src")).toBe("7-9");
    expect(live.querySelector("pre.reader-pending")).toBeNull();
    expect(live.querySelector("p:last-of-type")).toBe(last);
    expect(last.getAttribute("data-src")).toBe("11-11");
    expect([...live.querySelectorAll(":scope > p")].map(p => p.textContent)).toEqual(["Inserted.", "First paragraph, edited.", "Last paragraph."]);
    expect(sourceOf(live)?.lines.join("\n")).toBe(AFTER);
  }, 30_000);

  it("replaces a block whose markup depends on a changed block elsewhere", async () => {
    const live = document.createElement("div");
    await patch(live, "See [the docs][ref].\n\n[ref]: https://example.com/a\n");
    const paragraph = live.querySelector("p")!;
    expect(await patch(live, "See [the docs][ref].\n\n[ref]: https://example.com/b\n")).toBe(1);
    expect(live.querySelector("p")).not.toBe(paragraph);
    expect(live.querySelector("a")?.getAttribute("href")).toBe("https://example.com/b");
  });

  it("replaces a block whose markup is equal but whose inner line offsets moved", async () => {
    const live = document.createElement("div");
    await patch(live, "- a\n\n- b\n");
    const list = live.querySelector("ul")!;
    expect(await patch(live, "- a\n\n\n- b\n")).toBe(1);
    expect(live.querySelector("ul")).not.toBe(list);
    expect([...live.querySelectorAll("li")].map(item => item.getAttribute("data-src"))).toEqual(["1-1", "4-4"]);
  });

  it("re-highlights a fence whose language changed but whose body did not", async () => {
    // `{n}` metadata never reaches the reader's highlighter (markdown-it-attrs takes it), so the
    // info string that matters is the language; it rides on the placeholder and so on the key.
    const live = document.createElement("div");
    const fence = (info: string): string => ["```" + info, "const kept = 1;", "```", ""].join("\n");
    await patch(live, fence("ts"));
    const first = live.querySelector(".reader-code")!;
    expect(await patch(live, fence("js"))).toBe(1);
    const second = live.querySelector(".reader-code")!;
    expect(second).not.toBe(first);
    expect(second.querySelector("code")?.className).toContain("language-js");
    expect(await patch(live, fence("js"))).toBe(0); // unchanged: still reused
    expect(live.querySelector(".reader-code")).toBe(second);
  }, 30_000);

  it("replaces blocks it did not insert itself", async () => {
    const live = document.createElement("div");
    live.innerHTML = "<p>Fresh.</p>";
    expect(await patch(live, "Fresh.")).toBe(1);
    expect(live.textContent?.trim()).toBe("Fresh.");
  });
});
