import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { mountRasterClone, rasterCanvas, type RasterClone } from "./helpers/rasterCapture";

const { capture, addImage, save } = vi.hoisted(() => ({
  capture: vi.fn<(page: HTMLElement, options: unknown) => Promise<{ toDataURL(): string }>>(),
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

type StyledClone = RasterClone & { link: HTMLLinkElement };

function queuedClone(configure?: (clone: StyledClone) => void) {
  let clone!: StyledClone;
  let enterCallback!: () => void;
  const beforeCallback = new Promise<void>(resolve => { enterCallback = resolve; });
  capture.mockImplementationOnce(async (page, options) => {
    const mounted = mountRasterClone(page, options);
    mounted.copy.head.innerHTML = '<link rel="stylesheet" href="/assets/document.css">';
    mounted.sheet.style.visibility = "hidden";
    clone = { ...mounted, link: mounted.copy.querySelector<HTMLLinkElement>("link")! };
    // Chromium may retain this object on failure. Its presence and rule count
    // cannot replace the load/error outcome; empty successful CSS is valid.
    Object.defineProperty(clone.link, "sheet", { configurable: true, value: { cssRules: [] } });
    configure?.(clone);
    await beforeCallback;
    await clone.options.onclone(clone.copy, clone.sheet);
    clone.frame.remove();
    return rasterCanvas;
  });
  return { get clone() { return clone; }, enterCallback };
}

async function flushCallback() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

it.each(["empty", "inaccessible"])("rejects a pre-callback CSS error with a retained %s sheet, cleans up and permits a retry", async shape => {
  const host = sourcePages();
  const original = host.outerHTML;
  const unrelated = document.createElement("iframe");
  unrelated.className = "html2canvas-container";
  document.body.append(unrelated);
  for (let attempt = 0; attempt < 2; attempt++) {
    const queued = queuedClone(({ link }) => {
      if (shape === "inaccessible") Object.defineProperty(link, "sheet", {
        value: { get cssRules() { throw new DOMException("Cannot access rules", "SecurityError"); } },
      });
    });
    const failure = expect(exportPaginatedToPdf(host, DEFAULT_SETTINGS)).rejects.toThrow("stylesheet could not load");
    const { link, sheet, frame, options } = queued.clone;
    expect((options.iframeContainer as HTMLElement).getAttribute("data-html2canvas-ignore")).toBe("true");
    link.dispatchEvent(new Event("error"));
    // Errors may precede onclone by an entire task; no rejected promise should
    // escape while the library is still waiting for fonts or images.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    queued.enterCallback();
    await failure;
    expect(sheet.style.visibility).toBe("hidden");
    expect(frame.isConnected).toBe(false);
    expect(options.iframeContainer?.isConnected).toBe(false);
    expect(unrelated.isConnected).toBe(true);
    expect(addImage).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(host.outerHTML).toBe(original);
  }
  const retry = queuedClone();
  const pending = exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  retry.clone.link.dispatchEvent(new Event("load"));
  retry.enterCallback();
  await pending;
  expect(addImage).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledOnce();
  expect(unrelated.isConnected).toBe(true);
  expect(document.querySelectorAll("iframe.html2canvas-container")).toHaveLength(1);
  expect(host.outerHTML).toBe(original);
});

it.each(["load", "error"])("waits for a queued %s after onclone even when upstream polling found a sheet", async outcome => {
  const host = sourcePages();
  const queued = queuedClone();
  let settled = false;
  const pending = exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  const result = pending.then(() => { settled = true; return null; }, error => { settled = true; return error as Error; });
  queued.enterCallback();
  await flushCallback();
  expect(settled).toBe(false);
  expect(queued.clone.sheet.style.visibility).toBe("hidden");
  expect(save).not.toHaveBeenCalled();
  queued.clone.link.dispatchEvent(new Event(outcome));
  const error = await result;
  if (outcome === "error") {
    expect(error?.message).toContain("stylesheet could not load");
    expect(addImage).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  } else {
    expect(error).toBeNull();
    expect(save).toHaveBeenCalledOnce();
  }
  expect(queued.clone.frame.isConnected).toBe(false);
  expect(queued.clone.options.iframeContainer?.isConnected).toBe(false);
});

it.each(["empty", "inaccessible"])("accepts successful %s CSS and waits for fonts used after revealing the clone", async shape => {
  const host = sourcePages();
  let releaseFonts!: () => void;
  const queued = queuedClone(({ copy, link }) => {
    Object.defineProperty(copy, "fonts", { value: { ready: new Promise<void>(resolve => { releaseFonts = resolve; }) } });
    if (shape === "inaccessible") Object.defineProperty(link, "sheet", {
      value: { get cssRules() { throw new DOMException("Cannot access rules", "SecurityError"); } },
    });
  });
  const pending = exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  queued.clone.link.dispatchEvent(new Event("load"));
  queued.enterCallback();
  await flushCallback();
  expect(queued.clone.sheet.style.visibility).toBe("visible");
  expect(addImage).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  releaseFonts();
  await pending;
  expect(save).toHaveBeenCalledWith("document.pdf", { returnPromise: true });
});

it("requires every active stylesheet while ignoring disabled, alternate and empty-href links", async () => {
  const queued = queuedClone(({ copy }) => {
    const disabled = copy.createElement("link");
    disabled.rel = "stylesheet";
    disabled.href = "/assets/disabled.css";
    disabled.disabled = true;
    copy.head.append(disabled);
    copy.head.insertAdjacentHTML("beforeend", '<link rel="alternate stylesheet" href="/assets/alternate.css"><link rel="stylesheet"><link rel="stylesheet" href="/assets/second.css" id="second">');
    Object.defineProperty(copy.querySelector("#second"), "sheet", { value: { cssRules: [] } });
  });
  const pending = exportPaginatedToPdf(sourcePages(), DEFAULT_SETTINGS);
  queued.clone.link.dispatchEvent(new Event("load"));
  queued.enterCallback();
  await flushCallback();
  expect(save).not.toHaveBeenCalled();
  queued.clone.copy.querySelector("#second")!.dispatchEvent(new Event("load"));
  await pending;
  expect(save).toHaveBeenCalledOnce();
});

it("rejects a stylesheet timeout at the existing mount deadline without starting another wait", async () => {
  vi.useFakeTimers();
  const queued = queuedClone(({ link }) => { Object.defineProperty(link, "sheet", { value: null }); });
  const failure = expect(exportPaginatedToPdf(sourcePages(), DEFAULT_SETTINGS)).rejects.toThrow("stylesheet could not load");
  await vi.advanceTimersByTimeAsync(10_000);
  queued.enterCallback();
  await failure;
  expect(vi.getTimerCount()).toBe(0);
  expect(queued.clone.options.iframeContainer?.isConnected).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it("starts the font deadline after CSS and reveal, then releases a timed-out capture", async () => {
  vi.useFakeTimers();
  const queued = queuedClone(({ copy }) => {
    Object.defineProperty(copy, "fonts", { value: { ready: new Promise<void>(() => {}) } });
  });
  const failure = expect(exportPaginatedToPdf(sourcePages(), DEFAULT_SETTINGS)).rejects.toThrow("fonts did not finish loading");
  // Upstream can enter onclone before its queued link event has dispatched.
  queued.enterCallback();
  await vi.advanceTimersByTimeAsync(4_000);
  expect(queued.clone.sheet.style.visibility).toBe("hidden");
  queued.clone.link.dispatchEvent(new Event("load"));
  await vi.advanceTimersByTimeAsync(0);
  expect(queued.clone.sheet.style.visibility).toBe("visible");
  await vi.advanceTimersByTimeAsync(9_999);
  expect(queued.clone.frame.isConnected).toBe(true);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await failure;
  expect(queued.clone.options.iframeContainer?.isConnected).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(addImage).not.toHaveBeenCalled();
});

it("rejects a font load error even when fonts.ready has settled", async () => {
  const queued = queuedClone(({ copy }) => {
    Object.defineProperty(copy, "fonts", { value: {
      ready: Promise.resolve(),
      *[Symbol.iterator]() { yield { status: "error" }; },
    } });
  });
  const failure = expect(exportPaginatedToPdf(sourcePages(), DEFAULT_SETTINGS)).rejects.toThrow("fonts could not load");
  queued.clone.link.dispatchEvent(new Event("load"));
  queued.enterCallback();
  await failure;
  expect(save).not.toHaveBeenCalled();
  expect(queued.clone.options.iframeContainer?.isConnected).toBe(false);
});

it.each([false, true])("cleans all owned state when capture fails outside onclone (mounted: %s)", async mounted => {
  vi.useFakeTimers();
  const unrelated = document.createElement("iframe");
  unrelated.className = "html2canvas-container";
  document.body.append(unrelated);
  let owned: HTMLElement | ShadowRoot | undefined;
  capture.mockImplementationOnce(async (page, options) => {
    owned = (options as { iframeContainer?: HTMLElement }).iframeContainer;
    if (mounted) mountRasterClone(page, options).copy.head.innerHTML = '<link rel="stylesheet" href="/assets/pending.css">';
    throw new Error("Capture failed before onclone");
  });
  await expect(exportPaginatedToPdf(sourcePages(), DEFAULT_SETTINGS)).rejects.toThrow("Capture failed before onclone");
  expect(owned?.isConnected).toBe(false);
  expect(unrelated.isConnected).toBe(true);
  expect(document.querySelectorAll("iframe.html2canvas-container")).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(save).not.toHaveBeenCalled();
});

it("rejects an unobserved callback document instead of accepting a lifecycle change", async () => {
  capture.mockImplementationOnce(async (page, options) => {
    const clone = mountRasterClone(page, options);
    const other = document.implementation.createHTMLDocument("unobserved");
    other.body.innerHTML = page.outerHTML;
    await Promise.resolve();
    await clone.options.onclone(other, other.querySelector<HTMLElement>(".pagedjs_page")!);
    return rasterCanvas;
  });
  await expect(exportPaginatedToPdf(sourcePages(), DEFAULT_SETTINGS)).rejects.toThrow("capture lifecycle");
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector("iframe.html2canvas-container")).toBeNull();
});

it("requires onclone to have completed before using a returned canvas", async () => {
  capture.mockResolvedValueOnce(rasterCanvas);
  await expect(exportPaginatedToPdf(sourcePages(), DEFAULT_SETTINGS)).rejects.toThrow("capture lifecycle");
  expect(save).not.toHaveBeenCalled();
});
