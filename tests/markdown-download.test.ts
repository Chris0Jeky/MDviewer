import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadMarkdown, markdownFilename } from "../src/export/markdown";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren(); });

describe("local source download", () => {
  it.each([
    ["notes.md", "notes.md"], ["C:\\notes\\Research.markdown", "Research.markdown"],
    ["../ideas", "ideas.md"], ["", "Untitled.md"], ["bad?name.md", "bad_name.md"],
  ])("uses a portable Markdown filename for %s", (name, expected) => {
    expect(markdownFilename(name)).toBe(expected);
  });

  it("downloads exact source bytes and releases the object URL", async () => {
    vi.useFakeTimers();
    const source = "# Current edit\n\nUnicode: café → λ\n";
    const createObjectURL = vi.fn((_blob: Blob) => "blob:source");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { filename = this.download; });
    downloadMarkdown("notes.md", source);
    expect(filename).toBe("notes.md");
    const blob = createObjectURL.mock.calls[0]?.[0] as unknown as Blob;
    const reader = new FileReader();
    const text = new Promise<string>((resolve) => { reader.onload = () => resolve(String(reader.result)); });
    reader.readAsText(blob);
    await vi.advanceTimersByTimeAsync(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:source");
    vi.useRealTimers();
    expect(await text).toBe(source);
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
