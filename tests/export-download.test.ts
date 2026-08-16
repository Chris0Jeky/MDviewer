import { describe, it, expect, vi, beforeEach } from "vitest";
import { PAGEDJS } from "../src/app/dom";
import { DEFAULT_SETTINGS, type Settings } from "../src/app/settings";

// vi.mock factories are hoisted above imports, so all mock state lives in vi.hoisted.
const { addImage, addPage, save, jsPDFCtor, html2canvas } = vi.hoisted(() => {
  const addImage = vi.fn();
  const addPage = vi.fn();
  const save = vi.fn();
  // jsPDF is a named export `{ jsPDF }`; the constructor yields the page API.
  const jsPDFCtor = vi.fn(function (this: unknown, _opts?: unknown) {
    return { addImage, addPage, save };
  });
  // html2canvas-pro is a default export returning a canvas-like object.
  const html2canvas = vi.fn(async (_el: unknown, _opts?: unknown) => ({
    toDataURL: (_type?: string) => "data:image/png;base64,AAAA",
    width: 800,
    height: 1131,
  }));
  return { addImage, addPage, save, jsPDFCtor, html2canvas };
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
  jsPDFCtor.mockReset().mockImplementation(function (this: unknown, _opts?: unknown) {
    return { addImage, addPage, save };
  });
  html2canvas.mockReset().mockImplementation(async (_el: unknown, _opts?: unknown) => ({
    toDataURL: (_type?: string) => "data:image/png;base64,AAAA",
    width: 800,
    height: 1131,
  }));
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
    expect(save).toHaveBeenCalledWith("my-paper.pdf");
  });

  it("forwards a custom scale to html2canvas", async () => {
    const host = hostWithPages(1);
    await exportPaginatedToPdf(host, settings(), { scale: 1.5 });
    const opts = html2canvas.mock.calls[0]?.[1] as { scale?: number } | undefined;
    expect(opts?.scale).toBe(1.5);
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
    await expect(exportPaginatedToPdf(host, settings())).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
