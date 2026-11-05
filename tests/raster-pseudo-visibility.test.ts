import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { simulateRasterCapture } from "./helpers/rasterCapture";

const capture = vi.hoisted(() => vi.fn(async (_page: HTMLElement, _options: unknown) => ({
  toDataURL: () => "data:image/png;base64,AAAA",
})));
vi.mock("html2canvas-pro", () => ({ default: capture }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage() {} addPage() {} save() {} } }));
import { exportPaginatedToPdf } from "../src/export/download";

beforeEach(() => { capture.mockReset().mockImplementation(simulateRasterCapture); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("generated raster content visibility", () => {
  it("recomputes inherited hiding only for recognized generated pseudos in the copied sheet", async () => {
    const host = document.createElement("div");
    host.innerHTML = `<div class="pagedjs_page">Source page</div>`;
    document.body.append(host);
    const original = host.outerHTML;
    let copy!: Document;
    const readStyle = vi.fn((element: Element, _pseudo?: string | null) => {
      const style = document.createElement("span").style;
      style.visibility = element.id === "intentional" ? "hidden" : "visible";
      return style;
    });
    capture.mockImplementationOnce((page, options) => simulateRasterCapture(page, options, clone => {
      copy = clone.copy;
      copy.body.innerHTML = `<div class="pagedjs_page">
      <a id="both" class="___html2canvas___pseudoelement_before ___html2canvas___pseudoelement_after"><html2canvaspseudoelement style="visibility:hidden">Leader</html2canvaspseudoelement>Title<html2canvaspseudoelement style="visibility:hidden">1</html2canvaspseudoelement></a>
      <a id="intentional" class="___html2canvas___pseudoelement_after">Hidden decoration<html2canvaspseudoelement style="visibility:hidden">Secret</html2canvaspseudoelement></a>
      <span style="visibility:hidden">Ordinary hidden content</span>
      <div><html2canvaspseudoelement style="visibility:hidden">Unrecognized</html2canvaspseudoelement></div>
    </div><div id="outside"><html2canvaspseudoelement style="visibility:hidden">Other page</html2canvaspseudoelement></div>`;
      // jsdom has no pseudo style layout; real styles remain covered by E2E.
      vi.spyOn(copy.defaultView!, "getComputedStyle").mockImplementation(readStyle);
    }));
    await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
    const sheet = copy.querySelector<HTMLElement>(".pagedjs_page")!;
    const pseudos = Array.from(copy.querySelectorAll<HTMLElement>("html2canvaspseudoelement"));
    expect(pseudos.map((el) => el.style.visibility)).toEqual(["visible", "visible", "hidden", "hidden", "hidden"]);
    expect(readStyle.mock.calls.map(([element, pseudo]) => [element.id, pseudo])).toEqual([
      ["both", "::before"], ["both", "::after"], ["intentional", "::after"],
    ]);
    expect(sheet.querySelector("span")!.style.visibility).toBe("hidden");
    expect(host.outerHTML).toBe(original);
  });
});
