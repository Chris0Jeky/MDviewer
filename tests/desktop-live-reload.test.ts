import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../src/app/state";
import type { OpenBatch, ReadResult } from "../src/desktop/native";
import { activeTab } from "./helpers/desktopTabs";

// The real desktop entry and document owner; the host watcher, native reads and
// the layout-dependent workspace/render boundaries are stubbed.
const boundary = vi.hoisted(() => ({
  open: vi.fn(), pending: vi.fn(), start: vi.fn(), render: vi.fn(), read: vi.fn(),
  saveDocument: vi.fn(), saveDocumentAs: vi.fn(), release: vi.fn(),
  changed: null as ((tokens: string[]) => void) | null,
}));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending, readDocument: boundary.read,
  saveDocument: boundary.saveDocument, saveDocumentAs: boundary.saveDocumentAs, releaseDocument: boundary.release,
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}),
  onFilesChanged: vi.fn(async (callback: (tokens: string[]) => void) => { boundary.changed = callback; return () => {}; }),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: boundary.start }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/export/destination", () => ({ SaveCanceled: class extends Error {}, setDownloadDestination: vi.fn() }));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const TOKEN = "c".repeat(32);

function bound(name: string, text: string): OpenBatch {
  return { documents: [{ name, text, bytes: text.length, token: TOKEN, path: `C:\\notes\\${name}`, dir: "C:\\notes",
    encoding: "utf-8", eol: "lf" }], errors: [], canceled: false };
}
function changed(text: string | null, generation = 1): ReadResult {
  return { outcome: "changed", text, generation, encoding: "utf-8", eol: "lf" };
}
const shown = () => document.getElementById("reader-document")!.textContent;
const option = (): string => activeTab();
const bars = () => [...document.querySelectorAll<HTMLElement>(".file-conflict")];
const visibleBar = () => bars().find(bar => !bar.hidden);

async function openReader(batch: OpenBatch): Promise<void> {
  boundary.open.mockResolvedValueOnce(batch);
  document.getElementById("reader-open")!.click();
  await vi.waitFor(() => expect(shown()).toBe(batch.documents[0]!.text));
}
async function workspace(batch: OpenBatch) {
  await openReader(batch);
  const app = { store: new DocStore(), settings: { viewMode: "split" }, exportState: { busy: false },
    flushRender: vi.fn(async () => {}), captureDocumentPosition: vi.fn(), restoreDocumentPosition: vi.fn(),
    focusEditor: vi.fn(), destroy: vi.fn(), updateSettings: vi.fn(), onExportStateChange: vi.fn(() => () => {}) };
  boundary.start.mockReturnValueOnce({ app, detachShortcuts: vi.fn() });
  document.getElementById("reader-workspace")!.click();
  await vi.waitFor(() => expect(app.focusEditor).toHaveBeenCalledOnce());
  return app;
}

beforeEach(async () => {
  vi.resetModules();
  for (const mock of [boundary.open, boundary.pending, boundary.start, boundary.render, boundary.read,
    boundary.saveDocument, boundary.saveDocumentAs, boundary.release]) mock.mockReset();
  boundary.changed = null;
  boundary.pending.mockResolvedValue({ documents: [], errors: [], canceled: false });
  boundary.render.mockImplementation(async (text: string) => {
    const rendered = document.createElement("div"); rendered.textContent = text;
    return { document: rendered, warnings: [] };
  });
  boundary.release.mockResolvedValue(undefined);
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  localStorage.clear();
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      add(type, listener, options);
      removeListeners.push(() => target.removeEventListener(type, listener, options));
    });
  }
  await import("../src/desktop/main");
  await vi.waitFor(() => expect(boundary.changed).toBeTypeOf("function"));
});
afterEach(() => {
  removeListeners.splice(0).forEach(remove => remove());
  document.body.replaceChildren();
});

describe("desktop live reload", () => {
  it("a clean document follows its file and keeps the reading position", async () => {
    await openReader(bound("notes.md", "# One"));
    const scroll = document.getElementById("reader-scroll")!;
    scroll.scrollTop = 140;
    boundary.read.mockResolvedValueOnce(changed("# One\n\nAdded by an agent."));
    boundary.changed!([TOKEN]);
    await vi.waitFor(() => expect(shown()).toBe("# One\n\nAdded by an agent."));
    expect(boundary.read).toHaveBeenCalledWith(TOKEN, true, 0);
    expect(option(), "a reload is a clean state, not an edit").toBe("notes.md");
    expect(scroll.scrollTop).toBe(140);
    expect(bars().every(bar => bar.hidden)).toBe(true);
  });

  it("a clean workspace document reloads into the editor, not only the store", async () => {
    const app = await workspace(bound("notes.md", "# One"));
    const reseeded = vi.fn();
    app.store.on("change", reseeded); // App re-seeds the source editor on "change".
    boundary.read.mockResolvedValueOnce(changed("# Agent rewrite"));
    boundary.changed!([TOKEN]);
    await vi.waitFor(() => expect(app.store.active!.text).toBe("# Agent rewrite"));
    expect(reseeded).toHaveBeenCalled();
    expect(option()).toBe("notes.md");
  });

  it("our own save echoing back changes nothing", async () => {
    await openReader(bound("notes.md", "# One"));
    const renders = boundary.render.mock.calls.length;
    boundary.read.mockResolvedValueOnce({ outcome: "unchanged" });
    boundary.changed!([TOKEN]);
    await vi.waitFor(() => expect(boundary.read).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(boundary.render).toHaveBeenCalledTimes(renders);
    expect(shown()).toBe("# One");
  });

  it("a dirty document keeps its edits and offers Reload, Keep mine and Save As", async () => {
    const app = await workspace(bound("notes.md", "# One"));
    const doc = app.store.active!;
    app.store.updateText(doc.id, "# Mine");
    boundary.read.mockResolvedValueOnce(changed(null));
    boundary.changed!([TOKEN]);
    await vi.waitFor(() => expect(visibleBar()).toBeDefined());
    expect(boundary.read).toHaveBeenCalledWith(TOKEN, false, 0);
    expect(visibleBar()!.textContent).toContain("notes.md changed on disk");
    expect(app.store.active!.text, "nothing is discarded without a click").toBe("# Mine");
    // Keep mine hides the bar; the edits stay dirty and Save will still conflict.
    visibleBar()!.querySelector<HTMLButtonElement>('[data-conflict-action="keep"]')!.click();
    expect(visibleBar()).toBeUndefined();
    expect(option()).toBe("• notes.md");
    // A later outside change shows it again; Reload takes the file's text.
    boundary.read.mockResolvedValueOnce(changed(null));
    boundary.changed!([TOKEN]);
    await vi.waitFor(() => expect(visibleBar()).toBeDefined());
    boundary.read.mockResolvedValueOnce(changed("# Theirs", 1));
    visibleBar()!.querySelector<HTMLButtonElement>('[data-conflict-action="reload"]')!.click();
    await vi.waitFor(() => expect(app.store.active!.text).toBe("# Theirs"));
    expect(boundary.read).toHaveBeenLastCalledWith(TOKEN, true, 0);
    expect(option()).toBe("notes.md");
    expect(visibleBar()).toBeUndefined();
  });

  it("edits typed while a reload is read are kept, and Save then refuses to overwrite in place", async () => {
    const app = await workspace(bound("notes.md", "# One"));
    const doc = app.store.active!;
    let finish!: (result: ReadResult) => void;
    boundary.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    boundary.changed!([TOKEN]);
    expect(boundary.read).toHaveBeenCalledWith(TOKEN, true, 0); // Clean when the notification arrived.
    app.store.updateText(doc.id, "# Typed meanwhile");
    finish(changed("# Theirs"));
    await vi.waitFor(() => expect(visibleBar()).toBeDefined());
    expect(app.store.active!.text).toBe("# Typed meanwhile");
    // The host already moved to the outside bytes; an in-place Save must not land on them.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(boundary.saveDocument).not.toHaveBeenCalled();
    expect(document.getElementById("workspace-notice")!.textContent).toContain("changed on disk");
    visibleBar()!.querySelector<HTMLButtonElement>('[data-conflict-action="keep"]')!.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(boundary.saveDocument, "Keep mine still never overwrites in place").not.toHaveBeenCalled();
  });

  it("Save As from the bar keeps the edits in another file", async () => {
    const app = await workspace(bound("notes.md", "# One"));
    app.store.updateText(app.store.active!.id, "# Mine");
    boundary.read.mockResolvedValueOnce(changed(null));
    boundary.changed!([TOKEN]);
    await vi.waitFor(() => expect(visibleBar()).toBeDefined());
    boundary.saveDocumentAs.mockResolvedValueOnce({ outcome: "canceled" });
    visibleBar()!.querySelector<HTMLButtonElement>('[data-conflict-action="save-as"]')!.click();
    expect(boundary.saveDocumentAs).toHaveBeenCalledWith(TOKEN, "notes.md", "# Mine", false);
  });

  it("a moved or deleted file keeps the text and says so", async () => {
    await openReader(bound("notes.md", "# One"));
    boundary.read.mockResolvedValueOnce({ outcome: "missing" });
    boundary.changed!([TOKEN]);
    await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent).toContain("notes.md was moved or deleted"));
    expect(shown()).toBe("# One");
  });

  it("ignores tokens no open document holds", async () => {
    await openReader(bound("notes.md", "# One"));
    boundary.changed!(["f".repeat(32)]);
    await Promise.resolve();
    expect(boundary.read).not.toHaveBeenCalled();
  });
});
