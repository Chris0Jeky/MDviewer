import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SaveCanceled, setDownloadDestination } from "../src/export/destination";
import { PAGEDJS } from "../src/app/dom";
import { DEFAULT_SETTINGS, type Settings } from "../src/app/settings";
import { simulateRasterCapture } from "./helpers/rasterCapture";

// vi.mock factories are hoisted above imports, so all mock state lives in vi.hoisted.
const { addImage, addPage, save, output, jsPDFCtor, html2canvas } = vi.hoisted(() => {
  const addImage = vi.fn();
  const addPage = vi.fn();
  const save = vi.fn();
  const output = vi.fn();
  // jsPDF is a named export `{ jsPDF }`; the constructor yields the page API.
  const jsPDFCtor = vi.fn(function (this: unknown, _opts?: unknown) {
    return { addImage, addPage, save, output };
  });
  // html2canvas-pro is a default export returning a canvas-like object.
  const html2canvas = vi.fn(async (_el: HTMLElement, _opts?: unknown) => ({
    toDataURL: (_type?: string) => "data:image/png;base64,AAAA",
    width: 800,
    height: 1131,
  }));
  return { addImage, addPage, save, output, jsPDFCtor, html2canvas };
});

vi.mock("jspdf", () => ({
  jsPDF: jsPDFCtor as unknown,
}));

vi.mock("html2canvas-pro", () => ({
  default: html2canvas,
}));

import { exportPaginatedToPdf } from "../src/export/download";

/** Build a host element containing `n` `.pagedjs_page` children. */
function hostWithPages(n: number): HTMLElement {
  const host = document.createElement("div");
  for (let i = 0; i < n; i++) {
    const page = document.createElement("div");
    page.className = PAGEDJS.pageClass;
    page.setAttribute(PAGEDJS.pageNumberAttr, String(i + 1));
    host.appendChild(page);
  }
  document.body.appendChild(host);
  return host;
}

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

beforeEach(() => {
  document.body.replaceChildren();
  // vitest.config has restoreMocks:true, which strips implementations before each
  // test — re-establish them (and clear call history) so every test starts clean.
  addImage.mockReset();
  addPage.mockReset();
  save.mockReset();
  output.mockReset().mockImplementation(() => new Blob(["%PDF-test"], { type: "application/pdf" }));
  jsPDFCtor.mockReset().mockImplementation(function (this: unknown, _opts?: unknown) {
    return { addImage, addPage, save, output };
  });
  html2canvas.mockReset().mockImplementation(simulateRasterCapture);
});
afterEach(() => { setDownloadDestination(null); });

it("keeps the export pending until its native destination settles", async () => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const saving = new Promise<void>(resolve => { release = resolve; });
  setDownloadDestination(async (blob, name) => {
    expect(blob.type).toBe("application/pdf");
    expect(name).toBe("native.pdf");
    expect(addImage).toHaveBeenCalledTimes(2);
    started();
    await saving;
  });
  let done = false;
  const onSaving = vi.fn();
  const pending = exportPaginatedToPdf(hostWithPages(2), settings(), { fileName: "native.pdf", onSaving }).then(result => { done = true; return result; });
  await entered;
  expect(done).toBe(false);
  expect(onSaving).toHaveBeenCalledExactlyOnceWith("native");
  expect(save).not.toHaveBeenCalled();
  expect(output).toHaveBeenCalledWith("blob");
  release();
  expect(await pending).toBe("saved");
  expect(done).toBe(true);
});

it("waits for the browser download handoff and reports it without claiming a disk save", async () => {
  let release!: () => void;
  save.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const onSaving = vi.fn();
  const pending = exportPaginatedToPdf(hostWithPages(1), settings(), { onSaving });
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  expect(onSaving).toHaveBeenCalledExactlyOnceWith("browser");
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await expect(pending).resolves.toBe("download-requested");
});

it("propagates a browser download handoff failure", async () => {
  save.mockRejectedValueOnce(new Error("Download unavailable"));
  await expect(exportPaginatedToPdf(hostWithPages(1), settings())).rejects.toThrow("Download unavailable");
});

it("propagates native cancellation without falling through to browser saving", async () => {
  setDownloadDestination(async () => { throw new SaveCanceled(); });
  await expect(exportPaginatedToPdf(hostWithPages(1), settings())).rejects.toBeInstanceOf(SaveCanceled);
  expect(save).not.toHaveBeenCalled();
});

describe("exportPaginatedToPdf: one canvas per already-broken page", () => {
  it("rasterizes each .pagedjs_page exactly once", async () => {
    const host = hostWithPages(3);
    await exportPaginatedToPdf(host, settings());
    expect(html2canvas).toHaveBeenCalledTimes(3);
  });

  it("adds one image per page", async () => {
    const host = hostWithPages(4);
    await exportPaginatedToPdf(host, settings());
    expect(addImage).toHaveBeenCalledTimes(4);
  });

  it("adds (pageCount - 1) new PDF pages (the first page is implicit)", async () => {
    const host = hostWithPages(4);
    await exportPaginatedToPdf(host, settings());
    expect(addPage).toHaveBeenCalledTimes(3);
  });

  it("saves the PDF exactly once", async () => {
    const host = hostWithPages(2);
    await exportPaginatedToPdf(host, settings());
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("exportPaginatedToPdf: single page", () => {
  it("adds one image and no extra page for a one-page document", async () => {
    const host = hostWithPages(1);
    await exportPaginatedToPdf(host, settings());
    expect(addImage).toHaveBeenCalledTimes(1);
    expect(addPage).toHaveBeenCalledTimes(0);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("exportPaginatedToPdf: empty host", () => {
  it("rejects with a helpful message and produces no images when there are no pages", async () => {
    const host = hostWithPages(0);
    await expect(exportPaginatedToPdf(host, settings())).rejects.toThrow(/no paginated pages/i);
    expect(addImage).not.toHaveBeenCalled();
    expect(addPage).not.toHaveBeenCalled();
  });
});

describe("exportPaginatedToPdf: options", () => {
  it("passes the requested fileName through to save()", async () => {
    const host = hostWithPages(1);
    await exportPaginatedToPdf(host, settings(), { fileName: "my-paper.pdf" });
    expect(save).toHaveBeenCalledWith("my-paper.pdf", { returnPromise: true });
  });

  it("forwards a custom scale to html2canvas", async () => {
    const host = hostWithPages(1);
    await exportPaginatedToPdf(host, settings(), { scale: 1.5 });
    const opts = html2canvas.mock.calls[0]?.[1] as { scale?: number } | undefined;
    expect(opts?.scale).toBe(1.5);
  });

  it.each([0.5, 1, 1.5, 2, 4])("passes through valid scale %s", async (scale) => {
    const host = hostWithPages(1);
    await exportPaginatedToPdf(host, settings(), { scale });
    const opts = html2canvas.mock.calls[0]?.[1] as { scale?: number } | undefined;
    expect(opts?.scale).toBe(scale);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.25, 4.1, 1000])(
    "falls back to default scale 2 for invalid scale %s",
    async (scale) => {
      const host = hostWithPages(1);
      await exportPaginatedToPdf(host, settings(), { scale });
      const opts = html2canvas.mock.calls[0]?.[1] as { scale?: number } | undefined;
      expect(opts?.scale).toBe(2);
    },
  );

  it("uses default scale 2 when scale is omitted", async () => {
    const host = hostWithPages(1);
    await exportPaginatedToPdf(host, settings());
    const opts = html2canvas.mock.calls[0]?.[1] as { scale?: number } | undefined;
    expect(opts?.scale).toBe(2);
  });

  it("constructs jsPDF with the format matching the paper size", async () => {
    const host = hostWithPages(1);
    await exportPaginatedToPdf(host, settings({ paperSize: "letter" }));
    const ctorArg = jsPDFCtor.mock.calls[0]?.[0] as { format?: string } | undefined;
    expect(ctorArg?.format).toBe("letter");
  });

  it("renders pages on a white background for legible rasterization", async () => {
    const host = hostWithPages(1);
    await exportPaginatedToPdf(host, settings());
    const opts = html2canvas.mock.calls[0]?.[1] as { backgroundColor?: string } | undefined;
    expect(opts?.backgroundColor).toBe("#ffffff");
  });

  /**
   * html2canvas-pro's `logging` defaults to true and prints a block of clone/timing
   * chatter per captured element, so a multi-page export buries anything real in the
   * console (TECH-2). Pinned with objectContaining so the flag cannot be dropped by a
   * future options refactor.
   */
  it("disables html2canvas logging so an export does not flood the console", async () => {
    const host = hostWithPages(2);
    await exportPaginatedToPdf(host, settings());
    for (const call of html2canvas.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ logging: false }));
    }
  });
});

/**
 * Rasterizing is a long blocking loop with no built-in progress signal, so this
 * callback is the app's only way to tell the user anything is happening (UX-1).
 */
describe("exportPaginatedToPdf: progress reporting", () => {
  it("reports progress exactly once per page, in order, with the total", async () => {
    const host = hostWithPages(3);
    const onProgress = vi.fn();
    await exportPaginatedToPdf(host, settings(), { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("reports a single-page export once", async () => {
    const host = hostWithPages(1);
    const onProgress = vi.fn();
    await exportPaginatedToPdf(host, settings(), { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });

  it("never reports progress when there is nothing to export", async () => {
    const host = hostWithPages(0);
    const onProgress = vi.fn();
    await expect(exportPaginatedToPdf(host, settings(), { onProgress })).rejects.toThrow();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("stays optional — omitting onProgress still exports", async () => {
    const host = hostWithPages(2);
    await expect(exportPaginatedToPdf(host, settings())).resolves.toBe("download-requested");
    expect(save).toHaveBeenCalledTimes(1);
  });
});

/**
 * #201: cooperative cancellation. The renderer is never assumed to stop on request, so every
 * case where a page is in flight proves the export waits for it before it rejects.
 */
describe("exportPaginatedToPdf: cancellation", () => {
  class Stop extends Error {}
  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>(resolve => { open = resolve; });
    return { opened, open };
  };
  const rendered = () => ({ toDataURL: () => "data:image/png;base64,AAAA" as const, width: 800, height: 1131 });
  const settled = async (promise: Promise<unknown>) => {
    let done = false;
    void promise.then(() => { done = true; }, () => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    return done;
  };

  it("hands the renderer its signal", async () => {
    const controller = new AbortController();
    await exportPaginatedToPdf(hostWithPages(1), settings(), { signal: controller.signal });
    expect((html2canvas.mock.calls[0]?.[1] as { signal?: AbortSignal }).signal).toBe(controller.signal);
  });

  it("captures, adds and saves nothing when canceled while queued", async () => {
    const controller = new AbortController();
    controller.abort(new Stop());
    const onProgress = vi.fn();
    await expect(exportPaginatedToPdf(hostWithPages(3), settings(), { signal: controller.signal, onProgress })).rejects.toBeInstanceOf(Stop);
    expect(html2canvas).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps waiting for a renderer that ignores the signal, then drops its page and saves nothing (early/mid phase)", async () => {
    const stalled = gate();
    const started = gate();
    html2canvas.mockImplementation(async () => { started.open(); await stalled.opened; return rendered(); });
    const controller = new AbortController();
    const onProgress = vi.fn();
    const result = exportPaginatedToPdf(hostWithPages(3), settings(), { signal: controller.signal, onProgress });
    await started.opened;
    controller.abort(new Stop());
    expect(await settled(result), "the export must not settle while the renderer can still read the host").toBe(false);
    stalled.open();
    await expect(result).rejects.toBeInstanceOf(Stop);
    expect(html2canvas).toHaveBeenCalledTimes(1);
    expect(addImage).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("reports the abort reason, not the renderer's AbortError, when a cooperative renderer rejects", async () => {
    const started = gate();
    html2canvas.mockImplementation((_el: HTMLElement, options: unknown) => new Promise((_resolve, reject) => {
      const { signal } = options as { signal: AbortSignal };
      signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      started.open();
    }));
    const controller = new AbortController();
    const result = exportPaginatedToPdf(hostWithPages(2), settings(), { signal: controller.signal });
    await started.opened;
    controller.abort(new Stop());
    await expect(result).rejects.toBeInstanceOf(Stop);
    expect(document.querySelectorAll("div[data-html2canvas-ignore]")).toHaveLength(0);
  });

  it("stops between pages and assembles no partial PDF (late phase)", async () => {
    const controller = new AbortController();
    const onProgress = vi.fn((done: number) => { if (done === 2) controller.abort(new Stop()); });
    await expect(exportPaginatedToPdf(hostWithPages(4), settings(), { signal: controller.signal, onProgress })).rejects.toBeInstanceOf(Stop);
    expect(html2canvas).toHaveBeenCalledTimes(2);
    expect(addImage).toHaveBeenCalledTimes(2);
    expect(output).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("does not encode a page that finished after the cancel, and frees its bitmap", async () => {
    const stalled = gate();
    const started = gate();
    const canvas = rendered();
    html2canvas.mockImplementation(async () => { started.open(); await stalled.opened; return canvas; });
    const controller = new AbortController();
    const result = exportPaginatedToPdf(hostWithPages(1), settings(), { signal: controller.signal });
    await started.opened;
    controller.abort(new Stop());
    stalled.open();
    await expect(result).rejects.toBeInstanceOf(Stop);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(addImage).not.toHaveBeenCalled();
  });

  it("frees every page bitmap once it is encoded", async () => {
    const canvases: Array<{ width: number; height: number }> = [];
    html2canvas.mockImplementation(async (el: HTMLElement, options: unknown) => {
      await simulateRasterCapture(el, options);
      const canvas = rendered();
      canvases.push(canvas);
      return canvas;
    });
    await exportPaginatedToPdf(hostWithPages(3), settings(), { signal: new AbortController().signal });
    expect(canvases.map(canvas => canvas.width)).toEqual([0, 0, 0]);
  });

  it("honors a cancel up to the instant before the save is handed off", async () => {
    const controller = new AbortController();
    const onSaving = vi.fn();
    const onProgress = vi.fn(() => controller.abort(new Stop()));
    await expect(exportPaginatedToPdf(hostWithPages(1), settings(), { signal: controller.signal, onProgress, onSaving })).rejects.toBeInstanceOf(Stop);
    expect(onSaving).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("does not try to recall a save that was already handed off", async () => {
    const controller = new AbortController();
    const dialog = gate();
    setDownloadDestination(async () => { controller.abort(new Stop()); await dialog.opened; });
    const result = exportPaginatedToPdf(hostWithPages(1), settings(), { signal: controller.signal });
    dialog.open();
    await expect(result).resolves.toBe("saved");
  });
});
