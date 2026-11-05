import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../src/app/state";
import type { ReaderSession } from "../src/desktop/session";
import type { OpenBatch } from "../src/desktop/native";
import type { DownloadDestination } from "../src/export/destination";
import type { ViewMode } from "../src/app/settings";

// Keep the real entry, admission and document store. The native host and the
// layout-dependent workspace/render boundaries are exercised in desktop E2E.
const boundary = vi.hoisted(() => ({
  sessions: [] as ReaderSession[], open: vi.fn(), pending: vi.fn(), start: vi.fn(),
  render: vi.fn(), save: vi.fn(), destination: null as DownloadDestination | null,
}));
vi.mock("../src/desktop/session", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/desktop/session")>();
  return { ...actual, ReaderSession: class extends actual.ReaderSession {
    constructor(...args: ConstructorParameters<typeof actual.ReaderSession>) {
      super(...args); boundary.sessions.push(this);
    }
  } };
});
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending, save: boundary.save,
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: boundary.start }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/export/destination", () => ({
  SaveCanceled: class extends Error {},
  setDownloadDestination: (save: DownloadDestination | null) => { boundary.destination = save; },
}));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
function batch(documents: Array<{ name: string; text: string }> = []): OpenBatch {
  return { documents: documents.map(doc => ({ ...doc, bytes: new TextEncoder().encode(doc.text).length })), errors: [], canceled: false };
}
function click(id: string): void { document.getElementById(id)!.click(); }
function key(init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}
function sources(store: DocStore): Array<{ name: string; text: string }> {
  return store.openDocs.map(({ name, text }) => ({ name, text }));
}
function prepareWorkspace(viewMode: ViewMode = "split") {
  const input = document.createElement("textarea");
  const store = new DocStore();
  const settings = { viewMode };
  const exportListeners = new Set<(state: { busy: boolean; hasDocument: boolean }) => void>();
  const app = {
    store, settings, exportState: { busy: false, hasDocument: false },
    flushRender: vi.fn(async () => {}), destroy: () => { input.remove(); },
    updateSettings: (patch: { viewMode: ViewMode }) => { Object.assign(settings, patch); },
    focusEditor: () => { input.focus(); },
    captureDocumentPosition: vi.fn(), restoreDocumentPosition: vi.fn(),
    onExportStateChange: (listener: (state: { busy: boolean; hasDocument: boolean }) => void) => {
      exportListeners.add(listener); listener(app.exportState);
      return () => { exportListeners.delete(listener); };
    },
  };
  boundary.start.mockImplementationOnce((root: HTMLElement) => {
    root.append(input);
    return { app, detachShortcuts: () => {} };
  });
  return {
    app, input,
    create: () => {
      const create = boundary.start.mock.calls.at(-1)?.[3] as (() => Promise<void>) | undefined;
      expect(create, "the desktop workspace receives the bounded New action").toBeTypeOf("function");
      return create!();
    },
    exportBusy: (busy: boolean) => {
      app.exportState.busy = busy;
      exportListeners.forEach(listener => listener(app.exportState));
    },
  };
}
async function entered(t: ReturnType<typeof prepareWorkspace>): Promise<void> {
  await vi.waitFor(() => expect(document.activeElement).toBe(t.input));
  expect(document.getElementById("desktop-workspace")!.hidden).toBe(false);
}
async function openReader(documents: Array<{ name: string; text: string }>): Promise<void> {
  boundary.open.mockResolvedValueOnce(batch(documents)); click("reader-open");
  await vi.waitFor(() => expect(boundary.sessions[0]!.documents).toHaveLength(documents.length));
}

beforeEach(async () => {
  vi.resetModules();
  boundary.sessions.length = 0; boundary.destination = null;
  boundary.open.mockReset(); boundary.pending.mockReset().mockResolvedValue(batch());
  boundary.start.mockReset(); boundary.save.mockReset().mockResolvedValue({ canceled: false });
  boundary.render.mockReset().mockImplementation(async (text: string) => {
    const rendered = document.createElement("div"); rendered.textContent = text;
    return { document: rendered, warnings: [] };
  });
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
  await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledOnce());
});
afterEach(() => {
  removeListeners.splice(0).forEach(remove => remove());
  boundary.sessions.length = 0; boundary.destination = null;
  document.body.replaceChildren();
});

describe("desktop New document", () => {
  it.each(["shortcut", "toolbar", "empty state"])("creates and focuses a blank document from the empty reader %s", async entry => {
    const t = prepareWorkspace();
    expect(boundary.start).not.toHaveBeenCalled();
    if (entry === "shortcut") expect(key().defaultPrevented).toBe(true);
    else click(entry === "toolbar" ? "reader-new" : "reader-new-empty");
    await entered(t);
    expect(sources(t.app.store)).toEqual([{ name: "Untitled.md", text: "" }]);
    expect(document.title).toBe("Untitled.md — MDviewer");
    expect(boundary.sessions[0]!.documents).toEqual([]);
  });

  it("preserves existing sources and avoids case-insensitive name collisions", async () => {
    const originals = [{ name: "UNTITLED.MD", text: "# Original" }, { name: "Untitled 2.md", text: "Keep me" }];
    await openReader(originals);
    const t = prepareWorkspace();
    key(); await entered(t);
    expect(sources(t.app.store)).toEqual([...originals, { name: "Untitled 3.md", text: "" }]);
    await t.create();
    expect(sources(t.app.store)).toEqual([...originals, { name: "Untitled 3.md", text: "" }, { name: "Untitled 4.md", text: "" }]);
    expect(t.app.store.active?.name).toBe("Untitled 4.md");
  });

  it.each(["split", "editor", "preview"] as const)("reveals the source without changing an existing %s editing layout", async view => {
    const t = prepareWorkspace(view);
    key(); await entered(t);
    expect(t.app.settings.viewMode).toBe(view === "preview" ? "editor" : view);
    t.app.settings.viewMode = "preview";
    await t.create();
    expect(t.app.settings.viewMode).toBe("editor");
    expect(document.activeElement).toBe(t.input);
  });

  it.each([false, true])("keeps a new document clean until edited across a reader round trip (edited: %s)", async edited => {
    const t = prepareWorkspace(); key(); await entered(t);
    await t.create();
    if (edited) t.app.store.updateText(t.app.store.activeId!, "# My new note\n\nKeep this source.");
    click("reader-return");
    await vi.waitFor(() => expect(document.getElementById("reader-shell")!.hidden).toBe(false));
    const reader = boundary.sessions.at(-1)!;
    expect(reader.active).toMatchObject({ name: "Untitled 2.md", text: edited ? "# My new note\n\nKeep this source." : "", dirty: edited });
    expect(reader.documents[0]).toMatchObject({ name: "Untitled.md", text: "", dirty: false });
    const options = document.querySelectorAll<HTMLOptionElement>("#reader-documents option");
    expect([...options].map(option => option.text)).toEqual(["Untitled.md", edited ? "• Untitled 2.md" : "Untitled 2.md"]);
  });

  it("can start again after the final workspace document is closed", async () => {
    const t = prepareWorkspace(); key(); await entered(t);
    t.app.store.remove(t.app.store.activeId!);
    await t.create();
    expect(sources(t.app.store)).toEqual([{ name: "Untitled.md", text: "" }]);
    expect(t.app.store.active?.name).toBe("Untitled.md");
    expect(document.activeElement).toBe(t.input);
  });

  it("refuses a thirty-third document in either mode without changing the open set or selection", async () => {
    const originals = Array.from({ length: 32 }, (_, index) => ({ name: `note-${index}.md`, text: `# Keep ${index}` }));
    await openReader(originals);
    const reader = boundary.sessions[0]!;
    const active = reader.activeId;
    key();
    expect(reader.documents.map(({ name, text }) => ({ name, text }))).toEqual(originals);
    expect(reader.activeId).toBe(active);
    expect(boundary.start).not.toHaveBeenCalled();
    expect(document.getElementById("reader-notice")!.textContent).toContain("at most 32 documents");
    const t = prepareWorkspace(); click("reader-workspace"); await entered(t);
    const selected = t.app.store.active;
    await t.create();
    expect(sources(t.app.store)).toEqual(originals);
    expect(t.app.store.active).toBe(selected);
    expect(document.getElementById("workspace-notice")!.textContent).toContain("at most 32 documents");
  });

  it("checks current edited UTF-8 bytes before New and retries after capacity is freed", async () => {
    const t = prepareWorkspace(); key(); await entered(t);
    const original = t.app.store.active!;
    const large = "é".repeat(12_500_001);
    t.app.store.updateText(original.id, large);
    await t.create();
    expect(t.app.store.openDocs).toEqual([original]);
    expect(t.app.store.active).toBe(original);
    expect(t.app.store.active!.text).toBe(large);
    expect(document.getElementById("workspace-notice")!.textContent).toContain("memory limit");
    t.app.store.updateText(original.id, "# Smaller note");
    await t.create();
    expect(sources(t.app.store)).toEqual([{ name: "Untitled.md", text: "# Smaller note" }, { name: "Untitled 2.md", text: "" }]);
  });

  it("retains all reader sources after a failed workspace mount and permits retry", async () => {
    await openReader([{ name: "keep.md", text: "# Keep the original" }]);
    boundary.start.mockImplementationOnce(() => { throw new Error("Workspace unavailable"); });
    key();
    await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent).toContain("Workspace unavailable"));
    expect(boundary.sessions[0]!.documents.map(({ name, text }) => ({ name, text }))).toEqual([
      { name: "keep.md", text: "# Keep the original" }, { name: "Untitled.md", text: "" },
    ]);
    expect(document.getElementById("reader-shell")!.hidden).toBe(false);
    const t = prepareWorkspace(); click("reader-workspace"); await entered(t);
    expect(sources(t.app.store)).toEqual([{ name: "keep.md", text: "# Keep the original" }, { name: "Untitled.md", text: "" }]);
  });

  it("keeps New selected when an earlier native open completes during workspace entry", async () => {
    let finishOpen!: (result: OpenBatch) => void;
    boundary.open.mockImplementationOnce(() => new Promise<OpenBatch>(resolve => { finishOpen = resolve; }));
    click("reader-open");
    const t = prepareWorkspace();
    let finishRender!: () => void;
    t.app.flushRender.mockImplementationOnce(() => new Promise<void>(resolve => { finishRender = resolve; }));
    key();
    await vi.waitFor(() => expect(t.app.store.active?.name).toBe("Untitled.md"));
    finishOpen(batch([{ name: "late.md", text: "# Late file" }]));
    await Promise.resolve(); await Promise.resolve();
    expect(t.app.store.openDocs).toHaveLength(1);
    finishRender(); await entered(t);
    await vi.waitFor(() => expect(t.app.store.openDocs).toHaveLength(2));
    expect(t.app.store.active?.name).toBe("Untitled.md");
    expect(sources(t.app.store)).toEqual([{ name: "Untitled.md", text: "" }, { name: "late.md", text: "# Late file" }]);
  });

  it("blocks New through entry/return transitions, export and native-save ownership", async () => {
    const t = prepareWorkspace();
    let finishEntry!: () => void;
    t.app.flushRender.mockImplementationOnce(() => new Promise<void>(resolve => { finishEntry = resolve; }));
    key();
    await vi.waitFor(() => expect(t.app.store.openDocs).toHaveLength(1));
    const returnButton = document.getElementById("reader-return") as HTMLButtonElement;
    expect(document.getElementById("app")!.inert).toBe(true);
    expect(returnButton.disabled, "the immediate idle export notification must not unlock entry").toBe(true);
    await t.create();
    expect(t.app.store.openDocs).toHaveLength(1);
    finishEntry(); await entered(t);
    t.exportBusy(true); await t.create();
    expect(returnButton.disabled).toBe(true);
    expect(t.app.store.openDocs).toHaveLength(1);
    t.exportBusy(false);
    let finishSave!: (result: { canceled: boolean }) => void;
    boundary.save.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    const saved = boundary.destination!(new Blob(["source"]), "Untitled.md");
    t.exportBusy(false);
    expect(returnButton.disabled, "idle export updates must not unlock a native save").toBe(true);
    await t.create(); expect(t.app.store.openDocs).toHaveLength(1);
    t.exportBusy(true);
    finishSave({ canceled: false }); await saved;
    expect(returnButton.disabled, "save completion must not unlock an active export").toBe(true);
    t.exportBusy(false);
    expect(returnButton.disabled).toBe(false);
    await t.create(); expect(t.app.store.openDocs).toHaveLength(2);
    let finishReturn!: () => void;
    t.app.flushRender.mockImplementationOnce(() => new Promise<void>(resolve => { finishReturn = resolve; }));
    click("reader-return"); await t.create();
    expect(t.app.store.openDocs).toHaveLength(2);
    finishReturn();
    await vi.waitFor(() => expect(document.getElementById("reader-shell")!.hidden).toBe(false));
    expect(boundary.sessions.at(-1)!.documents).toHaveLength(2);
  });

  it("does not create documents for held, composing, modified or already handled keys", () => {
    expect(key({ repeat: true }).defaultPrevented).toBe(true);
    for (const init of [{ isComposing: true }, { shiftKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: false }]) {
      expect(key(init).defaultPrevented).toBe(false);
    }
    const handled = new KeyboardEvent("keydown", { key: "n", ctrlKey: true, cancelable: true });
    handled.preventDefault(); window.dispatchEvent(handled);
    expect(boundary.sessions[0]!.documents).toEqual([]);
    expect(boundary.start).not.toHaveBeenCalled();
  });
});
