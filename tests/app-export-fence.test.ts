import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { createRenderScheduler, DocStore, type RenderReason } from "../src/app/state";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import type { Settings } from "../src/app/settings";

const mocks = vi.hoisted(() => ({
  highlighter: vi.fn(async () => ({})),
  capture: vi.fn(async (_host: HTMLElement, _settings: Settings, _options: { fileName: string }) => {}),
}));
vi.mock("../src/render/highlight", () => ({ getHighlighter: mocks.highlighter, ensureMarkdownLanguages: async () => {} }));
vi.mock("../src/render/markdown", () => ({ createMarkdown: () => ({}), renderMarkdown: (_md: unknown, src: string) => ({ html: src, warnings: [] }) }));
vi.mock("../src/render/buildSource", () => ({
  buildPaginationSource: (html: string) => { const f = document.createDocumentFragment(); f.append(document.createTextNode(html)); return f; },
  awaitFontsAndImages: async () => {}, stampAtomicBlocks: () => 0,
}));
vi.mock("../src/render/mermaid", () => ({ renderAllMermaid: async () => ({ failed: 0 }) }));
vi.mock("../src/paginate/cssBuilder", () => ({ buildStylesheet: () => "" }));
vi.mock("../src/paginate/handler", () => ({ registerHandlersOnce: async () => {}, setPaginationProgress: () => {} }));
vi.mock("../src/paginate/paginate", () => ({
  paginate: async (source: DocumentFragment, _css: string, host: HTMLElement) => { host.replaceChildren(source); return { total: 1 }; },
  teardownPagination: (host: HTMLElement) => host.replaceChildren(),
}));
vi.mock("../src/export/download", () => ({ exportPaginatedToPdf: mocks.capture }));

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function fixture() {
  const host = document.createElement("div");
  const store = new DocStore();
  const doc = store.add("Original.md", "First render");
  const app = Object.create(App.prototype) as App;
  const pipeline = app as unknown as { runPipeline(reason: RenderReason): Promise<void> };
  const scheduler = createRenderScheduler((reason) => pipeline.runPipeline(reason));
  Object.assign(app, {
    store, settings: { ...DEFAULT_SETTINGS }, scheduler, renderedSnapshot: null,
    exportBusy: false, exportListeners: new Set(), renderToken: 0, hasGoodRender: false,
    canvas: { host, setBusy: vi.fn(), setPaginating: vi.fn(), setProgress: vi.fn(), setPageCount: vi.fn(),
      capturePosition: () => null, restorePosition: vi.fn() },
    banner: { fatal: vi.fn(), clear: vi.fn(), warn: vi.fn() }, emptyEl: document.createElement("div"),
  });
  return { app, host, store, doc, scheduler };
}

describe("immutable export request while earlier preparation is running", () => {
  for (const mutation of ["close", "edit"] as const) {
    it(`exports the requested source/settings, not a subsequent ${mutation}`, async () => {
      const t = fixture();
      const slow = gate();
      const entered = gate();
      mocks.highlighter.mockReset().mockResolvedValue({}).mockImplementationOnce(async () => {
        entered.release(); await slow.promise; return {};
      });
      const captures: Array<{ text: string; name: string; paper: string }> = [];
      mocks.capture.mockReset().mockImplementation(async (host, settings, options) => {
        captures.push({ text: host.textContent ?? "", name: options.fileName, paper: settings.paperSize });
      });
      t.scheduler.schedule("content");
      const initial = t.scheduler.flush();
      await entered.promise;
      t.store.updateText(t.doc.id, "Requested export source");
      t.scheduler.schedule("content");
      const exported = t.app.exportPdf();
      t.app.settings = { ...t.app.settings, paperSize: "letter" };
      if (mutation === "close") t.store.remove(t.doc.id);
      else t.store.updateText(t.doc.id, "Later editor source");
      t.scheduler.schedule("content");
      const later = t.scheduler.flush();
      slow.release();
      await Promise.all([initial, exported, later]);
      expect(captures).toEqual([{ text: "Requested export source", name: "Original.pdf", paper: "a4" }]);
      expect(t.host.textContent).toBe(mutation === "close" ? "" : "Later editor source");
      expect(t.app.exportState.busy).toBe(false);
    });
  }
});
