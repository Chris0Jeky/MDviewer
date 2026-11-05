import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { simulateRasterCapture } from "./helpers/rasterCapture";
const capture = vi.hoisted(() => vi.fn(async (_page: HTMLElement, _options: unknown) => ({ toDataURL: () => "data:image/png;base64,AAAA" })));
vi.mock("html2canvas-pro", () => ({ default: capture }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage() {} addPage() {} save() {} } }));
import { exportPaginatedToPdf } from "../src/export/download";
beforeEach(() => { capture.mockReset().mockImplementation(simulateRasterCapture); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it.each([false, true])("maps pseudos when the cloner places after before ordinary children: %s", async (earlyAfter) => {
  const host = document.createElement("div");
  host.innerHTML = '<div class="pagedjs_page">Live</div>';
  document.body.append(host);
  let copy!: Document;
  const before = '<html2canvaspseudoelement style="visibility:hidden">Leader</html2canvaspseudoelement>';
  const after = '<html2canvaspseudoelement style="visibility:hidden">1</html2canvaspseudoelement>';
  const styleReader = vi.fn((_element: Element, pseudo?: string | null) => {
    const style = document.createElement("span").style;
    // Authored ::before hiding must not be mistaken for inherited hiding.
    style.visibility = pseudo === "::before" ? "hidden" : "visible";
    return style;
  });
  capture.mockImplementationOnce((page, options) => simulateRasterCapture(page, options, clone => {
    copy = clone.copy;
    copy.body.innerHTML = `<div class="pagedjs_page"><a class="___html2canvas___pseudoelement_before ___html2canvas___pseudoelement_after">${before}${earlyAfter ? after + "Title" : "Title" + after}</a></div>`;
    vi.spyOn(copy.defaultView!, "getComputedStyle").mockImplementation(styleReader);
  }));
  await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  const sheet = copy.querySelector<HTMLElement>(".pagedjs_page")!;
  expect(Array.from(sheet.querySelectorAll<HTMLElement>("html2canvaspseudoelement"), (node) => node.style.visibility)).toEqual(["hidden", "visible"]);
  expect(styleReader.mock.calls.map((call) => call[1])).toEqual(["::before", "::after"]);
});
