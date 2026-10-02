import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { DocStore, type RenderReason } from "../src/app/state";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import { IDS } from "../src/app/dom";
import { mountBanner } from "../src/ui/Banner";
import type { RenderWarning } from "../src/render/markdown";

const mocks = vi.hoisted(() => ({
  highlighter: vi.fn(async () => ({})),
  warnings: [] as RenderWarning[],
}));
// jsdom has no layout. Keep the real App warning lifecycle and Banner DOM while
// replacing the unrelated renderer and pagination engine, as in the export tests.
vi.mock("../src/render/highlight", () => ({ getHighlighter: mocks.highlighter, ensureMarkdownLanguages: async () => {} }));
vi.mock("../src/render/markdown", () => ({ createMarkdown: () => ({}), renderMarkdown: () => ({ html: "<p>Document</p>", warnings: mocks.warnings }) }));
vi.mock("../src/render/buildSource", () => ({
  buildPaginationSource: () => document.createDocumentFragment(),
  awaitFontsAndImages: async () => {}, stampAtomicBlocks: () => 0,
}));
vi.mock("../src/render/mermaid", () => ({ renderAllMermaid: async () => ({ failed: 0 }) }));
vi.mock("../src/paginate/cssBuilder", () => ({ buildStylesheet: () => "" }));
vi.mock("../src/paginate/handler", () => ({ registerHandlersOnce: async () => {}, setPaginationProgress: () => {} }));
vi.mock("../src/paginate/paginate", () => ({ paginate: async () => ({ total: 1 }), teardownPagination: () => {} }));

function fixture() {
  const root = document.createElement("div");
  document.body.append(root);
  const store = new DocStore();
  store.add("Valid.md", "# Document");
  const app = Object.create(App.prototype) as App;
  Object.assign(app, {
    store, settings: { ...DEFAULT_SETTINGS }, renderToken: 0, hasGoodRender: false,
    banner: mountBanner(root), emptyEl: document.createElement("div"),
    canvas: { host: root, setPaginating: () => {}, setProgress: () => {}, setPageCount: () => {},
      capturePosition: () => null, restorePosition: () => {} },
  });
  const lifecycle = app as unknown as {
    onReject(names: string[], tooLarge: string[], unreadable?: string[]): void;
    onTooLarge(name: string): void;
    runPipeline(reason: RenderReason): Promise<void>;
  };
  return { root, store, lifecycle, banner: root.querySelector<HTMLElement>(`#${IDS.warningBanner}`)! };
}

beforeEach(() => { mocks.highlighter.mockReset().mockResolvedValue({}); mocks.warnings = []; });
afterEach(() => { document.body.replaceChildren(); });

describe("App ingestion notice lifetime", () => {
  it("preserves mixed skip notices after a successful render without warnings", async () => {
    const t = fixture();
    t.lifecycle.onReject(["image.png"], ["huge.md"]);
    await t.lifecycle.runPipeline("content");
    expect(t.banner.hidden).toBe(false);
    expect(t.banner.textContent).toContain("image.png");
    expect(t.banner.textContent).toContain("25 MB");
  });

  it("keeps skip details beside render warnings, even beyond the summary threshold", async () => {
    const t = fixture();
    mocks.warnings = Array.from({ length: 4 }, () => ({ kind: "math", message: "Invalid math" }));
    t.lifecycle.onReject(["image.png"], []);
    await t.lifecycle.runPipeline("content");
    expect(t.banner.textContent).toContain("image.png");
    expect(t.banner.textContent).toContain("4 math");
  });

  it("does not resurrect a notice dismissed during an asynchronous render", async () => {
    const t = fixture();
    let release!: () => void;
    mocks.highlighter.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({}); }));
    t.lifecycle.onReject(["image.png"], []);
    const pending = t.lifecycle.runPipeline("content");
    t.banner.querySelector<HTMLButtonElement>("button")!.click();
    release();
    await pending;
    expect(t.banner.hidden).toBe(true);
    expect(t.banner.textContent).not.toContain("image.png");
  });

  it("preserves paste or editor size refusals across repagination", async () => {
    const t = fixture();
    t.lifecycle.onTooLarge("Inserted text");
    await t.lifecycle.runPipeline("settings");
    expect(t.banner.hidden).toBe(false);
    expect(t.banner.textContent).toContain("Inserted text");
    expect(t.banner.textContent).toContain("25 MB");
  });

  it("preserves skip notices when the final document is closed", async () => {
    const t = fixture();
    t.lifecycle.onReject(["image.png"], []);
    t.store.remove(t.store.activeId!);
    await t.lifecycle.runPipeline("content");
    expect(t.banner.hidden).toBe(false);
    expect(t.banner.textContent).toContain("image.png");
  });

  it("labels unreadable Markdown separately from unsupported types", () => {
    const t = fixture();
    t.lifecycle.onReject([], [], ["unreadable.md"]);
    expect(t.banner.hidden).toBe(false);
    expect(t.banner.textContent).toContain("unreadable.md");
    expect(t.banner.textContent).toContain("could not be read");
    expect(t.banner.textContent).not.toContain("only .md");
  });
});
