/**
 * Pulseboard SDK seam (src/app/pulse.ts). MDviewer's privacy promise is that no document
 * text, file name, title, heading, URL from a document or export content ever reaches a
 * Pulseboard call. These tests drive every instrumented path with a document full of unique
 * markers, spy on window.Pulseboard, and assert that no marker appears in any argument.
 * They also prove the product works when the SDK is absent or throws, that JavaScript error
 * events never reach a later window listener (the SDK's), and that the page loads the
 * locked artifact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { App } from "../src/app/App";
import { createRenderScheduler, DocStore, type RenderReason } from "../src/app/state";
import { DEFAULT_SETTINGS } from "../src/app/settings";
import type { Settings } from "../src/app/settings";
import { installInputHandlers } from "../src/app/input";
import {
  installErrorShield,
  pulseDocOpened,
  pulsePdfCompleted,
  pulsePrintRequested,
  pulseRoute,
  pulseTheme,
  pulseViewMode,
  resetPulseForTests,
  sizeBucket,
} from "../src/app/pulse";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(
    async (
      _host: HTMLElement,
      _settings: Settings,
      options: { fileName: string; onProgress?: (done: number, total: number) => void },
    ) => {
      options.onProgress?.(1, 3);
      options.onProgress?.(3, 3);
    },
  ),
}));
vi.mock("../src/render/highlight", () => ({ getHighlighter: async () => ({}), ensureMarkdownLanguages: async () => {} }));
vi.mock("../src/render/markdown", () => ({ createMarkdown: () => ({}), renderMarkdown: (_md: unknown, src: string) => ({ html: src, warnings: [] }) }));
vi.mock("../src/render/buildSource", () => ({
  buildPaginationSource: (html: string) => { const f = document.createDocumentFragment(); f.append(document.createTextNode(html)); return f; },
  awaitFontsAndImages: async () => {}, stampAtomicBlocks: () => 0,
}));
vi.mock("../src/render/mermaid", () => ({ renderAllMermaid: async () => ({ failed: 0 }) }));
vi.mock("../src/paginate/cssBuilder", () => ({ buildStylesheet: () => "" }));
vi.mock("../src/paginate/handler", () => ({ registerHandlersOnce: async () => {}, setPaginationProgress: () => {} }));
vi.mock("../src/paginate/paginate", () => ({
  paginate: async (source: DocumentFragment, _css: string, host: HTMLElement) => { host.replaceChildren(source); return { total: 3 }; },
  teardownPagination: (host: HTMLElement) => host.replaceChildren(),
}));
vi.mock("../src/export/download", () => ({ exportPaginatedToPdf: mocks.capture }));

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every string that must never leave: text, file names, title, headings, a URL, a secret. */
const MARKERS = [
  "ZebraSecretBody",
  "Quarterly-Salaries",
  "Top Secret Heading",
  "Confidential Title",
  "https://private.example.org/leak?id=42",
  "private.example.org",
  "leak-reviewer@example.org",
  "PastedPayloadKiwi",
  "TypedDraftMango",
];

const FILE_TEXT = `# Top Secret Heading\n\n---\ntitle: Confidential Title\n---\n\nZebraSecretBody leak-reviewer@example.org see https://private.example.org/leak?id=42\n`;
const PASTE_TEXT = "## Pasted heading\n\nPastedPayloadKiwi https://private.example.org/leak?id=42";
const TYPED_TEXT = "# TypedDraftMango\n\nZebraSecretBody";

type Spy = { route: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>; track: ReturnType<typeof vi.fn> };

function installSpy(): Spy {
  const spy = { route: vi.fn(() => true), count: vi.fn(() => true), track: vi.fn(() => true) };
  window.Pulseboard = spy;
  return spy;
}

function everyArgument(spy: Spy): string {
  return JSON.stringify([...spy.route.mock.calls, ...spy.count.mock.calls, ...spy.track.mock.calls]);
}

function fakePaste(text: string): Event {
  const evt = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clipboardData", { value: { getData: (t: string) => (t === "text/plain" ? text : "") } });
  return evt;
}

function fakeDrop(files: File[]): Event {
  const evt = new Event("drop", { bubbles: true, cancelable: true });
  const items = files.map((f) => ({ kind: "file" as const, getAsFile: () => f }));
  Object.defineProperty(evt, "dataTransfer", { value: { files, items, types: ["Files"] } });
  return evt;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** An App with the real controller methods and stubbed UI surfaces (no layout in jsdom). */
function appFixture() {
  const host = document.createElement("div");
  const store = new DocStore();
  const app = Object.create(App.prototype) as App;
  const pipeline = app as unknown as { runPipeline(reason: RenderReason): Promise<void> };
  const scheduler = createRenderScheduler((reason) => pipeline.runPipeline(reason));
  Object.assign(app, {
    store, settings: { ...DEFAULT_SETTINGS }, scheduler, renderedSnapshot: null,
    exportBusy: false, exportListeners: new Set(), settingsListeners: new Set(), renderToken: 0, hasGoodRender: false,
    canvas: { host, setBusy: vi.fn(), setPaginating: vi.fn(), setProgress: vi.fn(), setPageCount: vi.fn(),
      capturePosition: () => null, restorePosition: vi.fn(), setZoom: vi.fn() },
    editor: { setCodeTheme: vi.fn(), setDocument: vi.fn() },
    splitter: { sync: vi.fn() },
    workspaceEl: document.createElement("div"),
    banner: { fatal: vi.fn(), clear: vi.fn(), warn: vi.fn() }, emptyEl: document.createElement("div"),
  });
  store.on("change", () => app.scheduleRender("content"));
  return { app, store, scheduler };
}

beforeEach(() => {
  resetPulseForTests();
  localStorage.clear();
});

afterEach(() => {
  delete window.Pulseboard;
});

describe("pulse: no document content reaches any Pulseboard call", () => {
  it("file, drop, paste, typed and sample opens; route; view, theme; print and PDF export", async () => {
    const spy = installSpy();
    const { app, store } = appFixture();
    const detach = installInputHandlers(store, { onReject: vi.fn(), onLargeFile: async () => true });
    vi.spyOn(window, "print").mockImplementation(() => {});

    // Drop a file whose NAME is itself sensitive.
    window.dispatchEvent(fakeDrop([new File([FILE_TEXT], "Quarterly-Salaries.md", { type: "text/markdown" })]));
    await settle(); await settle();
    // Pick the same kind of file through the hidden input.
    const input = document.createElement("input");
    input.type = "file";
    input.id = "file-input";
    document.body.append(input);
    detach();
    const detach2 = installInputHandlers(store, { onReject: vi.fn(), onLargeFile: async () => true });
    Object.defineProperty(input, "files", { value: [new File([FILE_TEXT], "Quarterly-Salaries.markdown", { type: "" })], configurable: true });
    input.dispatchEvent(new Event("change"));
    await settle(); await settle();
    window.dispatchEvent(fakePaste(PASTE_TEXT));
    await settle();
    app.loadSample();
    // Typing into an empty app creates a new untitled document.
    store.openDocs.splice(0);
    store.activeId = null;
    (app as unknown as { onEditorInput(t: string): void }).onEditorInput(TYPED_TEXT);
    await app.flushRender();
    app.updateSettings({ viewMode: "preview" });
    app.updateSettings({ screenTheme: "dark" });
    await app.exportPrint();
    await app.exportPdf();
    detach2();
    input.remove();

    const tracked = spy.track.mock.calls.map(([name]) => name);
    expect(tracked).toEqual(expect.arrayContaining([
      "doc.opened", "view.mode", "theme.changed", "export.print_requested", "export.pdf_completed",
    ]));
    const sources = spy.track.mock.calls.filter(([n]) => n === "doc.opened").map(([, p]) => (p as { source: string }).source);
    expect(sources).toEqual(["file", "file", "paste", "sample", "typed"]);
    expect(spy.track).toHaveBeenCalledWith("export.pdf_completed", { pages: 3 });
    expect(spy.count.mock.calls).toEqual([["export.print_requested"], ["export.pdf_completed"]]);
    expect(spy.route).toHaveBeenCalledWith("editor");

    const all = everyArgument(spy);
    for (const marker of MARKERS) expect(all, `leaked ${marker}`).not.toContain(marker);
    // Nothing but closed enums, buckets and counts: every prop value is from an allow-list.
    const allowed = new Set(["file", "paste", "sample", "typed", "<1k", "1-10k", "10-100k", ">100k",
      "editor", "split", "preview", "light", "dark", "sepia"]);
    for (const [, props] of spy.track.mock.calls) {
      for (const value of Object.values((props ?? {}) as Record<string, unknown>)) {
        if (typeof value === "number") continue;
        expect(allowed.has(String(value)), `unexpected prop value ${String(value)}`).toBe(true);
      }
    }
  });

  it("the typed signature of every helper accepts no free text", () => {
    const spy = installSpy();
    pulseDocOpened("file", FILE_TEXT.length);
    pulseViewMode("split");
    pulseTheme("sepia");
    pulsePrintRequested();
    pulsePdfCompleted(0);
    expect(spy.track).toHaveBeenCalledWith("doc.opened", { source: "file", sizeBucket: "<1k" });
    expect(spy.track).toHaveBeenCalledWith("export.pdf_completed", {});
    for (const marker of MARKERS) expect(everyArgument(spy)).not.toContain(marker);
  });
});

describe("pulse: the product survives a missing or broken SDK", () => {
  it("does nothing when window.Pulseboard is undefined", async () => {
    delete window.Pulseboard;
    expect(() => {
      pulseRoute("editor");
      pulseDocOpened("paste", 12);
      pulseViewMode("editor");
      pulseTheme("dark");
      pulsePrintRequested();
      pulsePdfCompleted(2);
    }).not.toThrow();
    const { app, store } = appFixture();
    vi.spyOn(window, "print").mockImplementation(() => {});
    app.loadSample();
    await app.flushRender();
    await app.exportPrint();
    await app.exportPdf();
    expect(store.openDocs).toHaveLength(1);
    expect(mocks.capture).toHaveBeenCalled();
  });

  it("drops a theme or view mode outside the closed set at runtime", () => {
    const spy = installSpy();
    pulseTheme("ZebraSecretBody" as never);
    pulseViewMode("Top Secret Heading" as never);
    expect(spy.track).not.toHaveBeenCalled();
  });

  it("swallows an SDK that throws", () => {
    window.Pulseboard = {
      route: () => { throw new Error("boom"); },
      count: () => { throw new Error("boom"); },
      track: () => { throw new Error("boom"); },
    };
    expect(() => { pulseRoute("editor"); pulsePrintRequested(); pulseDocOpened("sample", 5); }).not.toThrow();
  });

  it("routes only on change, starting from the SDK's own home view", () => {
    const spy = installSpy();
    pulseRoute("home");
    pulseRoute("editor");
    pulseRoute("editor");
    pulseRoute("home");
    expect(spy.route.mock.calls).toEqual([["editor"], ["home"]]);
  });

  it("buckets sizes at the documented edges", () => {
    expect([0, 999, 1_000, 9_999, 10_000, 99_999, 100_000].map(sizeBucket))
      .toEqual(["<1k", "<1k", "1-10k", "1-10k", "10-100k", "10-100k", ">100k"]);
  });
});

describe("pulse: error events never reach the SDK's window listener", () => {
  it("stops window error and rejection events but not element resource errors", () => {
    const off = installErrorShield(window);
    const sdkListener = vi.fn();
    window.addEventListener("error", sdkListener);
    window.addEventListener("unhandledrejection", sdkListener);
    try {
      window.dispatchEvent(new ErrorEvent("error", { message: "Parse error near ZebraSecretBody" }));
      const rejection = new Event("unhandledrejection");
      Object.defineProperty(rejection, "reason", { value: new Error("ZebraSecretBody") });
      window.dispatchEvent(rejection);
      expect(sdkListener).not.toHaveBeenCalled();

      // render/buildSource.ts waits on <img> error events; the shield must let them through.
      const img = document.createElement("img");
      document.body.append(img);
      const imgListener = vi.fn();
      img.addEventListener("error", imgListener);
      img.dispatchEvent(new Event("error"));
      expect(imgListener).toHaveBeenCalledTimes(1);
      img.remove();
    } finally {
      off();
      window.removeEventListener("error", sdkListener);
      window.removeEventListener("unhandledrejection", sdkListener);
    }
  });
});

describe("pulse: the page loads the locked SDK artifact", () => {
  const html = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
  const page = new DOMParser().parseFromString(html, "text/html");

  it("loads /pulseboard.js with defer and reserves the bar right after the skip link", () => {
    const script = page.querySelector<HTMLScriptElement>("script[src='/pulseboard.js']");
    expect(script).not.toBeNull();
    expect(script?.hasAttribute("defer")).toBe(true);
    // The skip link must stay first in tab order (the bar's Choose/OK are focusable); it is
    // absolutely positioned, so the bar is still the first in-flow element on screen.
    expect(page.body.firstElementChild?.classList.contains("skip-link")).toBe(true);
    expect(page.body.firstElementChild?.nextElementSibling?.hasAttribute("data-pulseboard-bar")).toBe(true);
    expect(page.querySelector("script[src='/observatory.js']")).toBeNull();
  });

  it("releases the bar placeholder when a content blocker stops the SDK loading", () => {
    // The onerror fallback is registered at parse time, so it cannot miss the
    // failure the way a main.ts listener registered during deferred execution could.
    const script = page.querySelector<HTMLScriptElement>("script[src='/pulseboard.js']");
    expect(script?.getAttribute("onerror") ?? "").toContain("[data-pulseboard-bar]");
  });

  it("the served file is the one the lock records", () => {
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, "observatory.lock.json"), "utf8")) as {
      sdk: string; installs: Record<string, { sha256: string }>;
    };
    expect(lock.sdk).toBe("3.0.0");
    const code = readFileSync(join(REPO_ROOT, "public", "pulseboard.js"));
    expect(createHash("sha256").update(code).digest("hex")).toBe(lock.installs["public/pulseboard.js"]?.sha256);
  });
});
