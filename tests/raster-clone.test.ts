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
    let clone!: Document;
    let sheet!: HTMLElement;
    let unrelated!: HTMLElement;
    let documentTransform!: string;
    let unrelatedTransform!: string;
    capture.mockImplementationOnce((page, options) => simulateRasterCapture(page, options, ({ copy }) => {
      clone = copy;
      clone.body.innerHTML = before + `<div class="pagedjs_pages" id="unrelated" style="transform: scale(.25)"></div>`;
      sheet = clone.querySelector<HTMLElement>(".pagedjs_page")!;
      documentTransform = sheet.querySelector("figure")!.style.transform;
      unrelated = clone.querySelector<HTMLElement>("#unrelated")!;
      unrelatedTransform = unrelated.style.transform;
    }));
    await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
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
