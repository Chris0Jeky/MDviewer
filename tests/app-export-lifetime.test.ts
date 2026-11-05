import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { createRenderScheduler, DocStore, type RenderReason } from "../src/app/state";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { SaveCanceled } from "../src/export/destination";
import { mountBanner } from "../src/ui/Banner";
import type { FallbackPdfOptions, PdfExportResult } from "../src/export/download";

const mocks = vi.hoisted(() => ({
  exportPdf: vi.fn<(host: HTMLElement, settings: unknown, options: FallbackPdfOptions) => Promise<PdfExportResult | void>>(async () => {}),
  highlighter: vi.fn(async () => { throw new Error("Preparation failed"); }),
}));
vi.mock("../src/export/download", () => ({ exportPaginatedToPdf: mocks.exportPdf }));
vi.mock("../src/render/highlight", () => ({ getHighlighter: mocks.highlighter }));

function fixture(afterRender?: (banner: ReturnType<typeof mountBanner>) => void) {
  const host = document.createElement("div");
  host.textContent = "Completed pages";
  const store = new DocStore();
  store.add("Original.md", "Original");
  const snapshot = { id: store.activeId!, text: "Original", name: "Original.md", settings: { ...DEFAULT_SETTINGS } };
  const bannerRoot = document.createElement("div");
  const banner = mountBanner(bannerRoot);
  const fatal = vi.spyOn(banner, "fatal");
  const scheduler = createRenderScheduler(async () => { host.replaceChildren(); afterRender?.(banner); });
  const app = Object.create(App.prototype) as App;
  Object.assign(app, {
    store, settings: { ...DEFAULT_SETTINGS }, scheduler, renderedSnapshot: snapshot,
    exportBusy: false, exportListeners: new Set(), renderToken: 0, hasGoodRender: true,
    canvas: { host, setBusy: vi.fn(), setPaginating: vi.fn(), capturePosition: () => null },
    banner, emptyEl: document.createElement("div"),
  });
  return { app, host, store, snapshot, scheduler, fatal, banner,
    errorCard: bannerRoot.querySelector<HTMLElement>("#error-card")!,
    warningBanner: bannerRoot.querySelector<HTMLElement>("#warning-banner")! };
}

beforeEach(() => { mocks.exportPdf.mockReset().mockResolvedValue(undefined); });

describe("App export ownership and completed-render metadata", () => {
  it("publishes preparation before the lease and waits for native save before claiming success", async () => {
    const t = fixture();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const saving = new Promise<void>(resolve => { release = resolve; });
    const states: string[] = [];
    t.app.onExportStateChange(state => { if (state.pdf) states.push(state.pdf.phase); });
    mocks.exportPdf.mockImplementationOnce(async (_host, _settings, options) => {
      options.onProgress?.(1, 2);
      options.onProgress?.(2, 2);
      options.onSaving?.("native");
      started();
      await saving;
      return "saved";
    });
    const pending = t.app.exportPdf();
    expect(t.app.exportState.pdf.phase).toBe("preparing");
    await entered;
    expect(t.app.exportState.pdf.phase).toBe("saving");
    expect(t.app.exportState.busy).toBe(true);
    expect(states).not.toContain("saved");
    release();
    await pending;
    expect(t.app.exportState.pdf.phase).toBe("saved");
    expect(t.app.exportState.busy).toBe(false);
    expect(states).toContain("rendering");
  });

  it("reports failure, then a successful retry without changing the captured document", async () => {
    const t = fixture();
    mocks.exportPdf.mockRejectedValueOnce(new Error("Capture failed"));
    await t.app.exportPdf();
    expect(t.app.exportState.pdf.phase).toBe("failed");
    expect(t.app.exportState.busy).toBe(false);
    mocks.exportPdf.mockResolvedValueOnce("download-requested");
    await t.app.exportPdf();
    expect(t.app.exportState.pdf.phase).toBe("download-requested");
    expect(t.errorCard.hidden).toBe(true);
    expect(t.store.active?.text).toBe("Original");
  });

  it("releases the export lease after native save cancellation without a fatal error", async () => {
    const t = fixture();
    t.banner.fatal("Earlier capture failure");
    t.fatal.mockClear();
    mocks.exportPdf.mockRejectedValueOnce(new SaveCanceled());
    await t.app.exportPdf();
    expect(t.fatal).not.toHaveBeenCalled();
    expect(t.errorCard.hidden).toBe(false);
    expect(t.errorCard.textContent).toContain("Earlier capture failure");
    expect(t.app.exportState.busy).toBe(false);
    expect(t.app.exportState.pdf.phase).toBe("canceled");
    t.scheduler.schedule("content");
    await t.scheduler.flush();
    expect(t.host.textContent).toBe("");
  });

  it("clears only fatal feedback after a successful PDF retry finishes", async () => {
    const t = fixture();
    t.banner.notice([{ kind: "content", message: "Skipped unreadable.md" }]);
    t.banner.warn([{ kind: "lang", message: "Unknown code language" }]);
    t.banner.fatal("Earlier capture failure");
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const capture = new Promise<void>((resolve) => { release = resolve; });
    mocks.exportPdf.mockImplementationOnce(async () => { started(); await capture; });

    const exported = t.app.exportPdf();
    await entered;
    expect(t.errorCard.hidden).toBe(false);
    expect(t.errorCard.textContent).toContain("Earlier capture failure");
    release();
    await exported;

    expect(t.errorCard.hidden).toBe(true);
    expect(t.errorCard.textContent).not.toContain("Earlier capture failure");
    expect(t.warningBanner.hidden).toBe(false);
    expect(t.warningBanner.textContent).toContain("Skipped unreadable.md");
    expect(t.warningBanner.textContent).toContain("Unknown code language");
  });

  it("preserves a newer render failure when an export hands off its lease", async () => {
    const t = fixture(banner => banner.fatal("Newer render failed"));
    t.banner.fatal("Earlier capture failure");
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const capture = new Promise<void>((resolve) => { release = resolve; });
    mocks.exportPdf.mockImplementationOnce(async () => { started(); await capture; });

    const exported = t.app.exportPdf();
    await entered;
    t.scheduler.schedule("content");
    const rendered = t.scheduler.flush();
    release();
    await Promise.all([exported, rendered]);

    expect(t.errorCard.hidden).toBe(false);
    expect(t.errorCard.textContent).toContain("Newer render failed");
    expect(t.errorCard.textContent).not.toContain("Earlier capture failure");
  });
  it("keeps pages alive while a close waits and uses their original metadata", async () => {
    const t = fixture();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const capture = new Promise<void>((resolve) => { release = resolve; });
    mocks.exportPdf.mockImplementation(async () => { started(); await capture; });
    const exported = t.app.exportPdf();
    await entered;
    t.store.remove(t.store.activeId!);
    t.app.settings.paperSize = "letter";
    t.scheduler.schedule("content");
    const closed = t.scheduler.flush();
    await Promise.resolve();
    expect(t.host.textContent).toBe("Completed pages");
    expect(t.app.exportState.busy).toBe(true);
    expect(mocks.exportPdf).toHaveBeenCalledWith(t.host, t.snapshot.settings,
      expect.objectContaining({ fileName: "Original.pdf" }));
    expect(t.snapshot.settings.paperSize).toBe(DEFAULT_SETTINGS.paperSize);
    release();
    await Promise.all([exported, closed]);
    expect(t.host.textContent).toBe("");
    expect(t.app.exportState.busy).toBe(false);
  });

  it("does not export old pages after newer preparation fails", async () => {
    const t = fixture();
    const pipeline = t.app as unknown as { runPipeline(reason: RenderReason): Promise<void> };
    await pipeline.runPipeline("content");
    await t.app.exportPdf();
    expect(mocks.exportPdf).not.toHaveBeenCalled();
    expect(t.fatal).toHaveBeenCalledWith(expect.stringContaining("No paginated document"));
  });
});
