import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";

type CloneOptions = { onclone(doc: Document, sheet: HTMLElement): Promise<void> };
const { capture, addImage, save } = vi.hoisted(() => ({
  capture: vi.fn<(page: HTMLElement, options: CloneOptions) => Promise<{ toDataURL(): string }>>(),
  addImage: vi.fn(),
  save: vi.fn(),
}));
vi.mock("html2canvas-pro", () => ({ default: capture }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage = addImage; addPage() {} save = save; } }));
import { exportPaginatedToPdf } from "../src/export/download";

beforeEach(() => { capture.mockReset(); addImage.mockClear(); save.mockClear(); });
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

function sourcePages() {
  const host = document.createElement("div");
  host.innerHTML = '<div class="pagedjs_page">The source survives a failed capture.</div>';
  document.body.append(host);
  return host;
}

function mountedClone(stylesLoaded = true) {
  const frame = document.createElement("iframe");
  frame.className = "html2canvas-container";
  document.body.append(frame);
  // Keep the owning iframe relationship without issuing real CSS requests.
  const copy = document.implementation.createHTMLDocument("capture");
  Object.defineProperty(copy, "defaultView", { value: frame.contentWindow });
  copy.head.innerHTML = '<link rel="stylesheet" href="/assets/document.css">';
  copy.body.innerHTML = '<div class="pagedjs_page" style="visibility:hidden"></div>';
  const link = copy.querySelector<HTMLLinkElement>("link")!;
  const sheet = copy.querySelector<HTMLElement>(".pagedjs_page")!;
  if (stylesLoaded) Object.defineProperty(link, "sheet", { value: {} });
  capture.mockImplementationOnce(async (_page, { onclone }) => {
    // html2canvas-pro 2.6 invokes this only after its stylesheet wait settles,
    // including on error or timeout. The hook must validate that outcome.
    await onclone(copy, sheet);
    frame.remove();
    return { toDataURL: () => "data:image/png;base64,AAAA" };
  });
  return { copy, link, sheet, frame };
}

it("waits for fonts used after revealing the styled clone before saving", async () => {
  const host = sourcePages();
  const { copy, sheet } = mountedClone();
  let releaseFonts!: () => void;
  Object.defineProperty(copy, "fonts", { value: { ready: new Promise<void>(resolve => { releaseFonts = resolve; }) } });
  const pending = exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  await Promise.resolve();
  expect(sheet.style.visibility).toBe("visible");
  expect(addImage).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  releaseFonts();
  await pending;
  expect(addImage).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith("document.pdf");
});

it.each(["error", "timeout"])("rejects a stylesheet %s that settled before onclone, cleans up and permits a retry", async mode => {
  vi.useFakeTimers();
  const host = sourcePages();
  const original = host.innerHTML;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { link, sheet, frame } = mountedClone(false);
    // Match 2.6's lifecycle: the failed event or readiness deadline has already
    // passed before it calls onclone. No second event will wake a new listener.
    if (mode === "error") link.dispatchEvent(new Event("error"));
    else await vi.advanceTimersByTimeAsync(10_000);
    const failure = vi.fn();
    const pending = exportPaginatedToPdf(host, DEFAULT_SETTINGS).catch(failure);
    await vi.advanceTimersByTimeAsync(0);
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({
      message: "The PDF capture stylesheet could not load. Try Print / Save as PDF.",
    }));
    await pending;
    expect(sheet.style.visibility).toBe("hidden");
    expect(frame.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(addImage).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe(original);
  }
  mountedClone();
  await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  expect(addImage).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledOnce();
  expect(document.querySelector("iframe.html2canvas-container")).toBeNull();
});

it("does not require unused stylesheet links that the library skips", async () => {
  const host = sourcePages();
  const { copy } = mountedClone();
  const disabled = copy.createElement("link");
  disabled.rel = "stylesheet";
  disabled.href = "/assets/disabled.css";
  disabled.disabled = true;
  copy.head.append(disabled);
  copy.head.insertAdjacentHTML("beforeend", '<link rel="alternate stylesheet" href="/assets/alternate.css"><link rel="stylesheet">');
  await exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  expect(save).toHaveBeenCalledOnce();
});

it("bounds post-reveal font loading and releases a timed-out capture without saving", async () => {
  vi.useFakeTimers();
  const host = sourcePages();
  const { copy, frame } = mountedClone();
  Object.defineProperty(copy, "fonts", { value: { ready: new Promise<void>(() => {}) } });
  const rejected = expect(exportPaginatedToPdf(host, DEFAULT_SETTINGS)).rejects.toThrow("fonts did not finish loading. Try Print / Save as PDF.");
  await vi.advanceTimersByTimeAsync(9_999);
  expect(frame.isConnected).toBe(true);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(frame.isConnected).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(addImage).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
