import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HighlighterCore } from "shiki/core";
import type { App as AppController } from "../src/app/App";
import type { RenderReason } from "../src/app/state";
import type { Settings } from "../src/app/settings";

const layout = vi.hoisted(() => ({
  source: vi.fn((html: string, _settings: Settings) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content;
  }),
  paginate: vi.fn(async (source: DocumentFragment, _css: string, host: HTMLElement) => {
    host.replaceChildren(source);
    return { total: 1 };
  }),
}));

// Exercise the real App, Markdown plugins, Shiki engine and sanitizer. Only the
// layout-dependent stages are replaced because jsdom cannot paginate a document.
vi.mock("../src/render/buildSource", () => ({
  buildPaginationSource: layout.source,
  awaitFontsAndImages: async () => {}, stampAtomicBlocks: () => 0,
}));
vi.mock("../src/render/mermaid", () => ({ renderAllMermaid: async () => ({ failed: 0 }) }));
vi.mock("../src/paginate/cssBuilder", () => ({ buildStylesheet: () => "" }));
vi.mock("../src/paginate/handler", () => ({ registerHandlersOnce: async () => {}, setPaginationProgress: () => {} }));
vi.mock("../src/paginate/paginate", () => ({ paginate: layout.paginate, teardownPagination: () => {} }));

let highlighter: HighlighterCore | undefined;

beforeEach(() => {
  vi.resetModules();
  layout.source.mockClear();
  layout.paginate.mockClear();
});

afterEach(() => {
  highlighter?.dispose();
  highlighter = undefined;
});

async function fixture(source: string) {
  const { getHighlighter } = await import("../src/render/highlight");
  highlighter = await getHighlighter();
  expect(highlighter.getLoadedLanguages()).not.toContain("csharp");
  const { App } = await import("../src/app/App");
  const { DocStore } = await import("../src/app/state");
  const { DEFAULT_SETTINGS } = await import("../src/app/settings");
  const host = document.createElement("div");
  const workspaceEl = document.createElement("div");
  const canvasEl = document.createElement("main");
  canvasEl.id = "canvas";
  canvasEl.append(host);
  workspaceEl.append(canvasEl);
  const store = new DocStore();
  const doc = store.add("Code.md", source);
  const app = Object.create(App.prototype) as AppController;
  const banner = { fatal: vi.fn(), clear: vi.fn(), clearFatal: vi.fn(), warn: vi.fn() };
  Object.assign(app, {
    store, workspaceEl, settings: { ...DEFAULT_SETTINGS }, renderToken: 0, hasGoodRender: false,
    renderedSnapshot: null, banner, emptyEl: document.createElement("div"),
    canvas: { host, setPaginating: vi.fn(), setProgress: vi.fn(), setPageCount: vi.fn(),
      capturePosition: () => null, restorePosition: vi.fn() },
  });
  const pipeline = app as unknown as { runPipeline(reason: RenderReason): Promise<void> };
  return { app, host, store, doc, banner, pipeline, hl: highlighter };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

const code = "public record Person(string Name);";

describe("workspace fence grammar preparation", () => {
  it.each([
    ["escaped label", `\`\`\`c\\#\n${code}\n\`\`\``],
    ["entity label", `\`\`\`&#99;sharp\n${code}\n\`\`\``],
    ["uppercase label", `\`\`\`CS\n${code}\n\`\`\``],
    ["prefixed label", `\`\`\`language-cs\n${code}\n\`\`\``],
    ["blockquote", `> \`\`\`cs\n> ${code}\n> \`\`\``],
    ["list", `- Code example\n\n    \`\`\`cs\n    ${code}\n    \`\`\``],
    ["footnote", `Example.[^code]\n\n[^code]:\n    \`\`\`cs\n    ${code}\n    \`\`\``],
  ])("highlights the actual %s fence", async (kind, source) => {
    const t = await fixture(source);
    await t.pipeline.runPipeline("content");
    expect(t.banner.fatal).not.toHaveBeenCalled();
    expect(t.banner.warn).not.toHaveBeenCalled();
    expect(t.host.querySelector("pre")?.textContent).toContain(code);
    expect(t.host.querySelectorAll("pre.shiki span[style]").length).toBeGreaterThan(1);
    expect(t.hl.getLoadedLanguages()).toContain("csharp");
    expect(layout.paginate).toHaveBeenCalledTimes(1);
    if (kind === "footnote") {
      const ref = t.host.querySelector<HTMLAnchorElement>(".footnote-ref a");
      expect(ref?.getAttribute("href")).toBe("#fn1");
      expect(t.host.querySelector("#fn1 .footnote-backref")?.getAttribute("href")).toBe("#fnref1");
    }
  }, 30_000);

  it.each([
    ["indented code", `    \`\`\`cs\n    ${code}\n    \`\`\``],
    ["a literal fence example", `\`\`\`\`text\n\`\`\`cs\n${code}\n\`\`\`\n\`\`\`\``],
  ])("does not prepare a grammar for %s", async (_kind, source) => {
    const t = await fixture(source);
    await t.pipeline.runPipeline("content");
    expect(t.banner.fatal).not.toHaveBeenCalled();
    expect(t.banner.warn).not.toHaveBeenCalled();
    expect(t.host.textContent).toContain("```cs");
    expect(t.hl.getLoadedLanguages()).not.toContain("csharp");
    expect(layout.paginate).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("waits for grammar preparation and keeps the captured settings", async () => {
    const t = await fixture(`\`\`\`cs\n${code}\n\`\`\``);
    const entered = gate();
    const blocked = gate();
    const load = t.hl.loadLanguage.bind(t.hl);
    vi.spyOn(t.hl, "loadLanguage").mockImplementationOnce(async (...languages) => {
      entered.release();
      await blocked.promise;
      await load(...languages);
    });
    const pending = t.pipeline.runPipeline("content");
    await entered.promise;
    expect(layout.source).not.toHaveBeenCalled();
    expect(layout.paginate).not.toHaveBeenCalled();
    t.app.settings = { ...t.app.settings, showLineNumbers: true, paperSize: "letter" };
    blocked.release();
    await pending;
    expect(t.banner.fatal).not.toHaveBeenCalled();
    expect(t.host.querySelector("pre.with-line-numbers")).toBeNull();
    expect(layout.source.mock.calls[0]?.[1].paperSize).toBe("a4");
    await t.pipeline.runPipeline("settings");
    expect(t.host.querySelector("pre.with-line-numbers")).not.toBeNull();
    expect(layout.source.mock.calls[1]?.[1].paperSize).toBe("letter");
  }, 30_000);

  it("discards an older preparation when a newer render completes", async () => {
    const t = await fixture(`\`\`\`cs\n${code}\n\`\`\``);
    const entered = gate();
    const blocked = gate();
    const load = t.hl.loadLanguage.bind(t.hl);
    vi.spyOn(t.hl, "loadLanguage").mockImplementationOnce(async (...languages) => {
      entered.release();
      await blocked.promise;
      await load(...languages);
    });
    const pending = t.pipeline.runPipeline("content");
    await entered.promise;
    t.store.updateText(t.doc.id, "# Newer document");
    await t.pipeline.runPipeline("content");
    blocked.release();
    await pending;
    expect(t.banner.fatal).not.toHaveBeenCalled();
    expect(t.host.textContent).toContain("Newer document");
    expect(t.host.textContent).not.toContain(code);
    expect(layout.paginate).toHaveBeenCalledTimes(1);
  }, 30_000);
});
