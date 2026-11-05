import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";

const capture = vi.hoisted(() => vi.fn(async (_page: HTMLElement, _options: unknown) => ({
  toDataURL: () => "data:image/png;base64,AAAA",
})));
vi.mock("html2canvas-pro", () => ({ default: capture }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage() {} addPage() {} save() {} } }));
import { exportPaginatedToPdf } from "../src/export/download";

beforeEach(() => { capture.mockClear(); });
afterEach(() => { document.body.replaceChildren(); });

it("removes copied SVG hiding but preserves authored visibility and the live SVG", async () => {
  const host = document.createElement("div");
  host.innerHTML = `<div class="pagedjs_page"><svg xmlns="http://www.w3.org/2000/svg">
    <rect width="10" height="10" />
    <rect style="visibility:hidden !important" />
    <rect visibility="hidden" />
  </svg></div>`;
  document.body.append(host);
  const original = host.outerHTML;
  await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  const { onclone } = capture.mock.calls[0]![1] as { onclone(doc: Document, sheet: HTMLElement): Promise<void> };
  const copy = document.implementation.createHTMLDocument("capture");
  Object.defineProperty(copy, "defaultView", { value: window });
  copy.body.innerHTML = original;
  const nodes = Array.from(copy.querySelectorAll<SVGElement>("svg, svg *"));
  // html2canvas inlines these inherited values from the parked preview before
  // calling onclone; the owning stylesheet cannot override that inline copy.
  nodes.forEach((node) => { node.style.visibility = "hidden"; });
  await onclone(copy, copy.querySelector<HTMLElement>(".pagedjs_page")!);
  expect(nodes.map((node) => node.style.visibility)).toEqual(["", "", "hidden", ""]);
  expect(nodes[2]!.style.getPropertyPriority("visibility")).toBe("important");
  expect(nodes[3]!.getAttribute("visibility")).toBe("hidden");
  expect(host.outerHTML).toBe(original);
});

it("captures styled task checkboxes as static paint without changing live controls", async () => {
  const host = document.createElement("div");
  host.innerHTML = `<div class="pagedjs_page"><input type="checkbox" disabled checked
    class="task-list-item-checkbox" style="position:absolute;width:14px;height:14px;background-color:rgb(26, 79, 184);border:1.5px solid rgb(26, 79, 184)"></div>`;
  document.body.append(host);
  const original = host.outerHTML;
  await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  const { onclone } = capture.mock.calls[0]![1] as { onclone(doc: Document, sheet: HTMLElement): Promise<void> };
  const copy = document.implementation.createHTMLDocument("capture");
  Object.defineProperty(copy, "defaultView", { value: window });
  copy.body.innerHTML = original;
  await onclone(copy, copy.querySelector<HTMLElement>(".pagedjs_page")!);
  expect(copy.querySelector("input")).toBeNull();
  const paint = copy.querySelector<HTMLElement>("span.task-list-item-checkbox")!;
  expect(paint).not.toBeNull();
  expect(paint.style.width).toBe("14px");
  expect(paint.style.height).toBe("14px");
  expect(paint.style.backgroundColor).toBe("rgb(26, 79, 184)");
  expect(paint.style.position).toBe("absolute");
  expect(host.outerHTML).toBe(original);
});
