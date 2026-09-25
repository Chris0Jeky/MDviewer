import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";

const capture = vi.hoisted(() => vi.fn(async (_page: HTMLElement, _options: unknown) => ({
  toDataURL: () => "data:image/png;base64,AAAA",
})));
vi.mock("html2canvas-pro", () => ({ default: capture }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage() {} addPage() {} save() {} } }));
import { exportPaginatedToPdf } from "../src/export/download";

beforeEach(() => { capture.mockReset().mockResolvedValue({ toDataURL: () => "data:image/png;base64,AAAA" }); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("generated raster content visibility", () => {
  it("recomputes inherited hiding only for recognized generated pseudos in the copied sheet", async () => {
    const host = document.createElement("div");
    host.innerHTML = `<div class="pagedjs_page">Source page</div>`;
    document.body.append(host);
    const original = host.outerHTML;
    await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
    const { onclone } = capture.mock.calls[0]![1] as { onclone(doc: Document, sheet: HTMLElement): void };
    const copy = document.implementation.createHTMLDocument("capture");
    // jsdom has no browsing context for createHTMLDocument. Only this test
    // supplies a style reader; real-iframe pseudo styles are covered by E2E.
    Object.defineProperty(copy, "defaultView", { value: window });
    copy.body.innerHTML = `<div class="pagedjs_page">
      <a id="both" class="___html2canvas___pseudoelement_before ___html2canvas___pseudoelement_after"><html2canvaspseudoelement style="visibility:hidden">Leader</html2canvaspseudoelement>Title<html2canvaspseudoelement style="visibility:hidden">1</html2canvaspseudoelement></a>
      <a id="intentional" class="___html2canvas___pseudoelement_after">Hidden decoration<html2canvaspseudoelement style="visibility:hidden">Secret</html2canvaspseudoelement></a>
      <span style="visibility:hidden">Ordinary hidden content</span>
      <div><html2canvaspseudoelement style="visibility:hidden">Unrecognized</html2canvaspseudoelement></div>
    </div><div id="outside"><html2canvaspseudoelement style="visibility:hidden">Other page</html2canvaspseudoelement></div>`;
    const readStyle = vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = document.createElement("span").style;
      style.visibility = element.id === "intentional" ? "hidden" : "visible";
      return style;
    });
    const sheet = copy.querySelector<HTMLElement>(".pagedjs_page")!;
    onclone(copy, sheet);
    const pseudos = Array.from(copy.querySelectorAll<HTMLElement>("html2canvaspseudoelement"));
    expect(pseudos.map((el) => el.style.visibility)).toEqual(["visible", "visible", "hidden", "hidden", "hidden"]);
    expect(readStyle.mock.calls.map(([element, pseudo]) => [element.id, pseudo])).toEqual([
      ["both", "::before"], ["both", "::after"], ["intentional", "::after"],
    ]);
    expect(sheet.querySelector("span")!.style.visibility).toBe("hidden");
    expect(host.outerHTML).toBe(original);
  });
});
