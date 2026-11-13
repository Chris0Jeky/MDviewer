import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { mountRasterClone, rasterCanvas, type RasterCaptureOptions } from "./helpers/rasterCapture";

const { capture, save } = vi.hoisted(() => ({ capture: vi.fn(), save: vi.fn() }));
vi.mock("html2canvas-pro", () => ({ default: capture }));
vi.mock("jspdf", () => ({ jsPDF: class { addImage() {} addPage() {} save = save; } }));
import { exportPaginatedToPdf } from "../src/export/download";

let inheritController = true;
let finishNavigation = true;
const controller = { scriptURL: "http://localhost:3000/sw.js" };
const navigatorProperties = ["onLine", "serviceWorker"].map(key =>
  [key, Object.getOwnPropertyDescriptor(navigator, key)] as const);

beforeEach(() => {
  capture.mockReset();
  save.mockClear();
  inheritController = true;
  finishNavigation = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller } });
  // jsdom cannot navigate srcdoc. Model only that browser boundary; the actual
  // adoption, stylesheet placement, outcome observation and cleanup stay real.
  const setter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc")!.set!;
  vi.spyOn(HTMLIFrameElement.prototype, "srcdoc", "set").mockImplementation(function(this: HTMLIFrameElement, value: string) {
    setter.call(this, value);
    queueMicrotask(() => {
      if (!finishNavigation || !this.isConnected) return;
      const doc = this.contentDocument!;
      Object.defineProperty(doc, "URL", { configurable: true, value: "about:srcdoc" });
      Object.defineProperty(doc.defaultView!.navigator, "serviceWorker", {
        configurable: true, value: { controller: inheritController ? controller : null },
      });
      this.dispatchEvent(new Event("load"));
    });
  });
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  for (const [key, descriptor] of navigatorProperties) {
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else Reflect.deleteProperty(navigator, key);
  }
  vi.useRealTimers();
});

function sourcePage() {
  document.head.innerHTML = '<style id="before">.sample { color: black }</style>' +
    '<link id="first" rel="stylesheet" href="/assets/base.css">' +
    '<style id="between">.sample { color: blue }</style>' +
    '<link id="second" rel="stylesheet" href="/assets/theme.css" media="screen">' +
    '<style id="after">.sample { color: green }</style>' +
    '<link id="third" rel="stylesheet" href="/assets/last.css">';
  const host = document.createElement("div");
  host.innerHTML = '<div class="pagedjs_page"><style id="authored-body">.sample { color: red }</style><p class="sample">Offline</p></div>';
  document.body.append(host);
  return host;
}

function stagedCapture() {
  const observation = { stagingLinks: -1, finalURL: "", headOrder: [] as string[], bodyOrder: [] as string[], media: "" };
  capture.mockImplementationOnce(async (page: HTMLElement, options: RasterCaptureOptions & { ignoreElements?(element: Element): boolean }) => {
    const clone = mountRasterClone(page, options);
    for (const child of page.ownerDocument.head.children) {
      if (!options.ignoreElements?.(child)) clone.copy.head.appendChild(child.cloneNode(true));
    }
    // The renderer adds adopted CSS at the end of head and pseudo-hiding CSS
    // at the start of body. Neither may move ahead of the restored source CSS.
    clone.copy.head.insertAdjacentHTML("beforeend", '<style id="adopted">.sample { color: purple }</style>');
    clone.copy.body.insertAdjacentHTML("afterbegin", '<style id="generated-pseudos">.pseudo:before { content: none }</style>');
    observation.stagingLinks = clone.copy.querySelectorAll("link").length;
    await Promise.resolve();
    await clone.options.onclone(clone.copy, clone.sheet);
    const final = clone.sheet.ownerDocument;
    observation.finalURL = final.URL;
    observation.headOrder = [...final.head.querySelectorAll("style, link")].map(node => node.id);
    observation.bodyOrder = [...final.body.querySelectorAll("style")].map(node => node.id);
    observation.media = final.querySelector<HTMLLinkElement>("#second")!.media;
    clone.frame.remove();
    return rasterCanvas;
  });
  return observation;
}

async function settleStyles(outcome: "load" | "error") {
  let links: HTMLLinkElement[] = [];
  await vi.waitFor(() => {
    const frames = [...document.querySelectorAll<HTMLIFrameElement>("iframe.html2canvas-container")];
    const frame = frames.find(frame => frame.hasAttribute("srcdoc")) ?? frames.at(-1);
    links = [...(frame?.contentDocument?.querySelectorAll<HTMLLinkElement>("#first, #second, #third") ?? [])];
    expect(links).toHaveLength(3);
  });
  for (const link of links) {
    Object.defineProperty(link, "sheet", { configurable: true, value: { cssRules: [] } });
    link.dispatchEvent(new Event(outcome));
  }
}

it("loads CSS in the controlled document without changing its cascade or generated pseudo styles", async () => {
  const host = sourcePage();
  const before = document.head.innerHTML + host.outerHTML;
  const observed = stagedCapture();
  const pending = exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  await settleStyles("load");
  await pending;
  expect(observed.finalURL).toBe("about:srcdoc");
  expect(observed.stagingLinks).toBe(0);
  expect(observed.headOrder).toEqual(["before", "first", "between", "second", "after", "third", "adopted"]);
  expect(observed.bodyOrder).toEqual(["generated-pseudos", "authored-body"]);
  expect(observed.media).toBe("screen");
  expect(document.head.innerHTML + host.outerHTML).toBe(before);
  expect(save).toHaveBeenCalledWith("document.pdf", { returnPromise: true });
  expect(document.querySelector("iframe.html2canvas-container")).toBeNull();
});

it("rejects a final-document CSS error even with a sheet, removes owned frames, and permits retry", async () => {
  const host = sourcePage();
  const unrelated = document.createElement("iframe");
  document.body.append(unrelated);
  stagedCapture();
  const failure = expect(exportPaginatedToPdf(host, DEFAULT_SETTINGS)).rejects.toThrow("stylesheet could not load");
  await settleStyles("error");
  await failure;
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector("iframe.html2canvas-container")).toBeNull();
  expect(unrelated.isConnected).toBe(true);

  stagedCapture();
  const retry = exportPaginatedToPdf(host, DEFAULT_SETTINGS);
  await settleStyles("load");
  await retry;
  expect(save).toHaveBeenCalledOnce();
  expect(unrelated.isConnected).toBe(true);
  expect(document.querySelector("iframe.html2canvas-container")).toBeNull();
});

it("fails closed when the destination frame does not inherit the source controller", async () => {
  inheritController = false;
  capture.mockResolvedValueOnce(rasterCanvas);
  await expect(exportPaginatedToPdf(sourcePage(), DEFAULT_SETTINGS)).rejects.toThrow("capture lifecycle");
  expect(capture).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector("iframe.html2canvas-container")).toBeNull();
});

it("preserves inactive and empty-href CSS links without waiting for their load events", async () => {
  const host = sourcePage();
  const disabled = document.createElement("link");
  disabled.rel = "stylesheet";
  disabled.href = "/assets/disabled.css";
  disabled.disabled = true;
  document.head.append(disabled);
  document.head.insertAdjacentHTML("beforeend", '<link rel="alternate stylesheet" href="/assets/alternate.css"><link rel="stylesheet">');
  stagedCapture();
  const results = await Promise.allSettled([exportPaginatedToPdf(host, DEFAULT_SETTINGS), settleStyles("load")]);
  expect(results[0]).toEqual({ status: "fulfilled", value: "download-requested" });
  expect(results[1]).toEqual({ status: "fulfilled", value: undefined });
  expect(save).toHaveBeenCalledOnce();
  expect(disabled.disabled).toBe(true);
});

it("bounds srcdoc navigation and removes it when no load event arrives", async () => {
  vi.useFakeTimers();
  finishNavigation = false;
  capture.mockResolvedValueOnce(rasterCanvas);
  const failure = expect(exportPaginatedToPdf(sourcePage(), DEFAULT_SETTINGS)).rejects.toThrow("capture lifecycle");
  await vi.advanceTimersByTimeAsync(10_000);
  await failure;
  expect(capture).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector("iframe.html2canvas-container")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("stops srcdoc navigation on cancel before the renderer starts, then removes the frame and its timer (#201)", async () => {
  vi.useFakeTimers();
  finishNavigation = false;
  const stop = new AbortController();
  const failure = expect(exportPaginatedToPdf(sourcePage(), DEFAULT_SETTINGS, { signal: stop.signal })).rejects.toThrow("stopped");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(document.querySelector("iframe.html2canvas-container")).not.toBeNull();
  stop.abort(new Error("stopped"));
  await failure;
  expect(capture).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector("iframe.html2canvas-container")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
