import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";

const capture = vi.hoisted(() => vi.fn(async (_page: HTMLElement, _options: unknown) => ({
  toDataURL: () => "data:image/png;base64,AAAA",
})));
vi.mock("html2canvas-pro", () => ({ default: capture }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage() {} addPage() {} save() {} } }));
import { exportPaginatedToPdf } from "../src/export/download";

beforeEach(() => { capture.mockReset().mockResolvedValue({ toDataURL: () => "data:image/png;base64,AAAA" }); });
afterEach(() => { document.body.replaceChildren(); });

describe("raster capture clone isolation", () => {
  it("removes only cloned preview transforms, preserving live state and document transforms", async () => {
    const host = document.createElement("div");
    host.id = "paged-output";
    host.setAttribute("style", "width: 400px; height: 600px; overflow: clip");
    host.innerHTML = `<div class="pagedjs_pages" style="transform: scale(.5); transition: transform 140ms">
      <div class="pagedjs_page"><figure style="transform: scale(.8)">Document block</figure></div></div>`;
    document.body.append(host);
    const before = host.outerHTML;
    await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
    const options = capture.mock.calls[0]![1] as { onclone(doc: Document, sheet: HTMLElement): void };
    const clone = document.implementation.createHTMLDocument("capture");
    clone.body.innerHTML = before + `<div class="pagedjs_pages" id="unrelated" style="transform: scale(.25)"></div>`;
    const sheet = clone.querySelector<HTMLElement>(".pagedjs_page")!;
    const documentTransform = sheet.querySelector("figure")!.style.transform;
    const unrelated = clone.querySelector<HTMLElement>("#unrelated")!;
    const unrelatedTransform = unrelated.style.transform;
    options.onclone(clone, sheet);
    expect(clone.querySelector<HTMLElement>("#paged-output")!.style.height).toBe("auto");
    expect(clone.querySelector<HTMLElement>("#paged-output")!.style.width).toBe("auto");
    expect(clone.querySelector<HTMLElement>("#paged-output")!.style.overflow).toBe("visible");
    expect(sheet.parentElement!.style.transform).toBe("none");
    expect(sheet.parentElement!.style.getPropertyPriority("transform")).toBe("important");
    expect(sheet.style.visibility).toBe("visible");
    expect(sheet.querySelector("figure")!.style.transform).toBe(documentTransform);
    expect(unrelated.style.transform).toBe(unrelatedTransform);
    expect(host.outerHTML).toBe(before);
  });
});
