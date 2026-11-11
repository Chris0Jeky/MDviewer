import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { DocStore, type RenderReason } from "../src/app/state";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import type { CanvasPosition } from "../src/ui/Canvas";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(async () => ({})),
  paginate: vi.fn(async (source: DocumentFragment, _css: string, host: HTMLElement) => {
    host.replaceChildren(source); return { total: 10 };
  }),
}));
vi.mock("../src/render/highlight", () => ({ getHighlighter: mocks.prepare, ensureLang: async () => {} }));
vi.mock("../src/render/markdown", () => ({
  createMarkdown: () => ({ parse: (source: string) => [source] }),
  installMarkdownHighlighter: () => {}, parsedFenceLanguages: () => [],
  renderMarkdownTokens: (_md: unknown, tokens: string[]) => ({ html: tokens.join(""), warnings: [] }),
}));
vi.mock("../src/render/buildSource", () => ({
  buildPaginationSource: (html: string) => {
    const fragment = document.createDocumentFragment(); fragment.append(document.createTextNode(html)); return fragment;
  },
  awaitFontsAndImages: async () => {}, stampAtomicBlocks: () => 0,
}));
vi.mock("../src/render/mermaid", () => ({ renderAllMermaid: async () => ({ failed: 0 }) }));
vi.mock("../src/paginate/cssBuilder", () => ({ buildStylesheet: () => "" }));
vi.mock("../src/paginate/handler", () => ({ registerHandlersOnce: async () => {}, setPaginationProgress: () => {} }));
vi.mock("../src/paginate/paginate", () => ({
  paginate: mocks.paginate, teardownPagination: (host: HTMLElement) => host.replaceChildren(),
  PaginationIncompleteError: class PaginationIncompleteError extends Error {},
}));

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

function fixture() {
  const store = new DocStore();
  const [a, b] = store.addBatch([{ name: "a.md", text: "A" }, { name: "b.md", text: "B" }]);
  const host = document.createElement("div");
  const workspaceEl = document.createElement("div");
  const canvasEl = document.createElement("main");
  canvasEl.id = "canvas";
  canvasEl.append(host);
  workspaceEl.append(canvasEl);
  let position: CanvasPosition = { page: 1, offset: 0 };
  const restore = vi.fn((next: CanvasPosition | null) => { position = next ?? { page: 1, offset: 0 }; });
  const app = Object.create(App.prototype) as App;
  Object.assign(app, {
    store, workspaceEl, settings: { ...DEFAULT_SETTINGS }, renderToken: 0, hasGoodRender: false,
    renderedSnapshot: null, visiblePreviewId: null, editorDocumentId: a!.id,
    emptyEl: document.createElement("div"),
    banner: { fatal: vi.fn(), warn: vi.fn(), clear: vi.fn() },
    editor: { capturePosition: () => ({ start: 0, end: 0, direction: "none", scrollTop: 0, scrollLeft: 0 }) },
    canvas: { host, capturePosition: () => ({ ...position }), restorePosition: restore,
      setPaginating: vi.fn(), setProgress: vi.fn(), setPageCount: vi.fn() },
  });
  const pipeline = app as unknown as {
    runPipeline(reason: RenderReason): Promise<void>;
    renderedSnapshot: { id: string } | null;
    visiblePreviewId: string | null;
  };
  store.on("beforechange", () => app.captureDocumentPosition());
  store.on("change", () => Object.assign(app, { editorDocumentId: store.activeId }));
  return { app, store, a: a!, b: b!, host, restore, pipeline,
    run: () => pipeline.runPipeline("content"),
    scroll: (next: CanvasPosition) => { position = next; },
  };
}

beforeEach(() => {
  mocks.prepare.mockReset().mockResolvedValue({});
  mocks.paginate.mockReset().mockImplementation(async (source, _css, host) => {
    host.replaceChildren(source); return { total: 10 };
  });
});

describe("complete visible preview ownership", () => {
  it("captures scrolling while preparation is held without restoring export readiness", async () => {
    const t = fixture(); await t.run();
    t.scroll({ page: 3, offset: 0.2 });
    const entered = gate(), held = gate();
    mocks.prepare.mockImplementationOnce(async () => { entered.release(); await held.promise; return {}; });
    t.store.updateText(t.a.id, "A edited");
    const pending = t.run(); await entered.promise;
    expect(t.pipeline.renderedSnapshot).toBeNull();
    expect(t.pipeline.visiblePreviewId).toBe(t.a.id);
    const latest = { page: 4, offset: 0.6 };
    t.scroll(latest);
    t.store.setActive(t.b.id);
    expect(t.store.positions.get(t.a.id)?.preview).toEqual(latest);
    held.release(); await pending;
    await t.run();
    expect(t.host.textContent).toBe("B");
    t.store.setActive(t.a.id); await t.run();
    expect(t.restore).toHaveBeenLastCalledWith(latest);
    expect(t.host.textContent).toBe("A edited");
  });

  it("keeps old visible pages attributable after preparation for a different document fails", async () => {
    const t = fixture(); await t.run();
    t.scroll({ page: 3, offset: 0.1 }); t.store.setActive(t.b.id);
    mocks.prepare.mockRejectedValueOnce(new Error("Preparation failed"));
    await t.run();
    expect(t.pipeline.renderedSnapshot).toBeNull();
    expect(t.pipeline.visiblePreviewId).toBe(t.a.id);
    expect(t.host.textContent).toBe("A");
    const latest = { page: 5, offset: 0.4 };
    t.scroll(latest); t.store.setActive(t.a.id);
    expect(t.store.positions.get(t.a.id)?.preview).toEqual(latest);
    expect(t.store.positions.get(t.b.id)?.preview).toBeUndefined();
    await t.run(); expect(t.restore).toHaveBeenLastCalledWith(latest);
  });

  it("an obsolete preparation cannot replace a newer completed preview owner", async () => {
    const t = fixture(); await t.run();
    const saved = { page: 2, offset: 0.7 }; t.scroll(saved);
    const entered = gate(), held = gate();
    mocks.prepare.mockImplementationOnce(async () => { entered.release(); await held.promise; return {}; });
    const old = t.run(); await entered.promise;
    t.store.setActive(t.b.id); await t.run();
    held.release(); await old;
    expect(t.pipeline.visiblePreviewId).toBe(t.b.id);
    expect(t.pipeline.renderedSnapshot?.id).toBe(t.b.id);
    expect(t.host.textContent).toBe("B");
    expect(t.store.positions.get(t.a.id)?.preview).toEqual(saved);
  });

  it("partial pages from failed pagination cannot overwrite the last complete position", async () => {
    const t = fixture(); await t.run();
    const saved = { page: 4, offset: 0.3 }; t.scroll(saved);
    mocks.paginate.mockImplementationOnce(async (_source, _css, host) => {
      host.textContent = "Partial pages"; t.scroll({ page: 99, offset: 0.9 });
      throw new Error("Pagination failed");
    });
    await t.run();
    expect(t.pipeline.visiblePreviewId).toBeNull();
    expect(t.pipeline.renderedSnapshot).toBeNull();
    t.store.setActive(t.b.id);
    expect(t.store.positions.get(t.a.id)?.preview).toEqual(saved);
    await t.run(); t.store.setActive(t.a.id); await t.run();
    expect(t.restore).toHaveBeenLastCalledWith(saved);
  });

  it("does not resurrect a closed document's position while its old pages await teardown", async () => {
    const t = fixture(); await t.run();
    t.scroll({ page: 3, offset: 0.8 }); t.store.remove(t.a.id);
    t.app.captureDocumentPosition();
    expect(t.store.positions.get(t.a.id)).toBeUndefined();
    t.store.remove(t.b.id); await t.run();
    expect(t.pipeline.visiblePreviewId).toBeNull();
    expect(t.pipeline.renderedSnapshot).toBeNull();
    expect(t.host.textContent).toBe("");
    expect(t.store.positions.size).toBe(0);
  });
});
