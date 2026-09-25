import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
const capture = vi.hoisted(() => vi.fn(async (_page: HTMLElement, _options: unknown) => ({ toDataURL: () => "data:image/png;base64,AAAA" })));
vi.mock("html2canvas-pro", () => ({ default: capture }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage() {} addPage() {} save() {} } }));
import { exportPaginatedToPdf } from "../src/export/download";
beforeEach(() => { capture.mockReset().mockResolvedValue({ toDataURL: () => "data:image/png;base64,AAAA" }); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it.each([false, true])("maps pseudos when the cloner places after before ordinary children: %s", async (earlyAfter) => {
  const host = document.createElement("div");
  host.innerHTML = '<div class="pagedjs_page">Live</div>';
  document.body.append(host);
  await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  const { onclone } = capture.mock.calls[0]![1] as { onclone(doc: Document, sheet: HTMLElement): void };
  const copy = document.implementation.createHTMLDocument("capture");
  Object.defineProperty(copy, "defaultView", { value: window });
  const before = '<html2canvaspseudoelement style="visibility:hidden">Leader</html2canvaspseudoelement>';
  const after = '<html2canvaspseudoelement style="visibility:hidden">1</html2canvaspseudoelement>';
  copy.body.innerHTML = `<div class="pagedjs_page"><a class="___html2canvas___pseudoelement_before ___html2canvas___pseudoelement_after">${before}${earlyAfter ? after + "Title" : "Title" + after}</a></div>`;
  const styleReader = vi.spyOn(window, "getComputedStyle").mockImplementation((_element, pseudo) => {
    const style = document.createElement("span").style;
    // Authored ::before hiding must not be mistaken for inherited hiding.
    style.visibility = pseudo === "::before" ? "hidden" : "visible";
    return style;
  });
  const sheet = copy.querySelector<HTMLElement>(".pagedjs_page")!;
  onclone(copy, sheet);
  expect(Array.from(sheet.querySelectorAll<HTMLElement>("html2canvaspseudoelement"), (node) => node.style.visibility)).toEqual(["hidden", "visible"]);
  expect(styleReader.mock.calls.map((call) => call[1])).toEqual(["::before", "::after"]);
});
