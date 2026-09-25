import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { createRenderScheduler, DocStore, type RenderReason } from "../src/app/state";
import { DEFAULT_SETTINGS } from "../src/app/settings";

const mocks = vi.hoisted(() => ({
  exportPdf: vi.fn(async (_host: HTMLElement, _settings: unknown, _options: unknown) => {}),
  highlighter: vi.fn(async () => { throw new Error("Preparation failed"); }),
}));
vi.mock("../src/export/download", () => ({ exportPaginatedToPdf: mocks.exportPdf }));
vi.mock("../src/render/highlight", () => ({ getHighlighter: mocks.highlighter }));

function fixture() {
  const host = document.createElement("div");
  host.textContent = "Completed pages";
  const store = new DocStore();
  store.add("Original.md", "Original");
  const snapshot = { id: store.activeId!, text: "Original", name: "Original.md", settings: { ...DEFAULT_SETTINGS } };
  const fatal = vi.fn();
  const scheduler = createRenderScheduler(async () => { host.replaceChildren(); });
  const app = Object.create(App.prototype) as App;
  Object.assign(app, {
    store, settings: { ...DEFAULT_SETTINGS }, scheduler, renderedSnapshot: snapshot,
    exportBusy: false, exportListeners: new Set(), renderToken: 0, hasGoodRender: true,
    canvas: { host, setBusy: vi.fn(), setPaginating: vi.fn(), capturePosition: () => null },
    banner: { fatal }, emptyEl: document.createElement("div"),
  });
  return { app, host, store, snapshot, scheduler, fatal };
}

beforeEach(() => { mocks.exportPdf.mockReset().mockResolvedValue(undefined); });

describe("App export ownership and completed-render metadata", () => {
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
