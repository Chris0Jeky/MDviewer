import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { createRenderScheduler, DocStore, type RenderReason } from "../src/app/state";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import type { Settings } from "../src/app/settings";

const mocks = vi.hoisted(() => ({
  highlighter: vi.fn(async () => ({})),
  capture: vi.fn(async (_host: HTMLElement, _settings: Settings, _options: { fileName: string }) => {}),
  paginateTexts: [] as string[],
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
  paginate: async (source: DocumentFragment, _css: string, host: HTMLElement) => {
    mocks.paginateTexts.push(source.textContent ?? "");
    host.replaceChildren(source);
    return { total: 1 };
  },
  teardownPagination: (host: HTMLElement) => host.replaceChildren(),
}));
vi.mock("../src/export/download", () => ({ exportPaginatedToPdf: mocks.capture }));

function fixture(initialText: string) {
  const host = document.createElement("div");
  const store = new DocStore();
  const doc = store.add("Original.md", initialText);
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

describe("stale snapshot export re-renders", () => {
  it("re-runs the pipeline for edited v2 text instead of exporting stale v1 pages", async () => {
    const V1 = "Stale snapshot v1 body";
    const V2 = "Fresh editor v2 body";
    const t = fixture(V1);

    // Prime the app: paginated snapshot and host both hold v1.
    t.scheduler.schedule("content");
    await t.scheduler.flush();
    expect(t.host.textContent).toBe(V1);

    // Isolate the export: anything paginated/exported from here must come from the re-run.
    mocks.paginateTexts.length = 0;
    mocks.capture.mockClear();

    // Editor moves on to v2; the export captures v2 input while the snapshot still holds v1.
    t.store.updateText(t.doc.id, V2);
    await t.app.exportPdf();

    // The pipeline must have re-run for v2, never reusing the v1 pages.
    expect(mocks.paginateTexts).toContain(V2);
    expect(mocks.paginateTexts).not.toContain(V1);
    expect(t.host.textContent).toBe(V2);

    // The export itself must have observed the v2 pages, not the stale v1 ones.
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    const exportedHost = mocks.capture.mock.calls[0]![0] as HTMLElement;
    expect(exportedHost.textContent).toBe(V2);
    expect(exportedHost.textContent).not.toBe(V1);

    const snapshot = (t.app as unknown as { renderedSnapshot: { text: string } | null }).renderedSnapshot;
    expect(snapshot?.text).toBe(V2);
    expect(t.app.exportState.busy).toBe(false);
  });
});
