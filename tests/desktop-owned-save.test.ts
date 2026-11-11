import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../src/app/state";
import type { OpenBatch, SaveResult } from "../src/desktop/native";

// The real desktop entry, document owner and command registry; the native host
// and the layout-dependent workspace/render boundaries are stubbed.
const boundary = vi.hoisted(() => ({
  open: vi.fn(), pending: vi.fn(), start: vi.fn(), render: vi.fn(),
  saveDocument: vi.fn(), saveDocumentAs: vi.fn(), release: vi.fn(),
}));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending,
  saveDocument: boundary.saveDocument, saveDocumentAs: boundary.saveDocumentAs, releaseDocument: boundary.release,
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: boundary.start }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/export/destination", () => ({ SaveCanceled: class extends Error {}, setDownloadDestination: vi.fn() }));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const TOKEN = "a".repeat(32);

function bound(name: string, text: string, extra: Partial<OpenBatch["documents"][number]> = {}): OpenBatch {
  return { documents: [{ name, text, bytes: new TextEncoder().encode(text).length, token: TOKEN,
    path: `C:\\notes\\${name}`, dir: "C:\\notes", encoding: "utf-8", eol: "lf", ...extra }], errors: [], canceled: false };
}
function saved(name: string, generation: number, token = TOKEN): SaveResult {
  return { outcome: "saved", token, generation, name, path: `C:\\notes\\${name}`, dir: "C:\\notes", encoding: "utf-8", eol: "lf" };
}
function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}
const notice = () => document.getElementById("workspace-notice")!.textContent ?? "";
const option = () => (document.getElementById("reader-documents") as HTMLSelectElement).selectedOptions[0]!.text;

async function workspaceWith(batch: OpenBatch) {
  boundary.open.mockResolvedValueOnce(batch);
  document.getElementById("reader-open")!.click();
  await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe(batch.documents[0]!.text));
  const store = new DocStore();
  const app = { store, settings: { viewMode: "split" }, exportState: { busy: false },
    flushRender: vi.fn(async () => {}), captureDocumentPosition: vi.fn(), restoreDocumentPosition: vi.fn(),
    focusEditor: vi.fn(), destroy: vi.fn(), updateSettings: vi.fn(), onExportStateChange: vi.fn(() => () => {}) };
  boundary.start.mockReturnValueOnce({ app, detachShortcuts: vi.fn() });
  document.getElementById("reader-workspace")!.click();
  await vi.waitFor(() => expect(app.focusEditor).toHaveBeenCalledOnce());
  return app;
}

beforeEach(async () => {
  vi.resetModules();
  for (const mock of Object.values(boundary)) mock.mockReset();
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
  await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledOnce());
});
afterEach(() => {
  removeListeners.splice(0).forEach(remove => remove());
  document.body.replaceChildren();
});

describe("desktop owned Save", () => {
  it("saves the captured text in place, keeps newer edits dirty, then saves them with the next generation", async () => {
    const app = await workspaceWith(bound("notes.md", "# One"));
    const doc = app.store.active!;
    app.store.updateText(doc.id, "# One edited");
    let finish!: (result: SaveResult) => void;
    boundary.saveDocument.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const event = press({});
    expect(event.defaultPrevented, "Ctrl+S is claimed before the workspace's copy shortcut").toBe(true);
    expect(boundary.saveDocument).toHaveBeenCalledWith(TOKEN, 0, "# One edited", false);
    press({}); // One transaction at a time.
    expect(boundary.saveDocument).toHaveBeenCalledOnce();
    app.store.updateText(doc.id, "# One edited twice");
    finish(saved("notes.md", 1));
    await vi.waitFor(() => expect(notice()).toContain("newer edits remain unsaved"));
    expect(option()).toBe("• notes.md");
    boundary.saveDocument.mockResolvedValueOnce(saved("notes.md", 2));
    press({});
    expect(boundary.saveDocument).toHaveBeenLastCalledWith(TOKEN, 1, "# One edited twice", false);
    await vi.waitFor(() => expect(notice()).toBe("Saved notes.md."));
    expect(option()).toBe("notes.md");
    press({});
    await vi.waitFor(() => expect(notice()).toContain("no unsaved changes"));
    expect(boundary.saveDocument).toHaveBeenCalledTimes(2);
  });

  it("keeps the text and baseline on a conflict and points to Save As", async () => {
    const app = await workspaceWith(bound("notes.md", "# One"));
    app.store.updateText(app.store.active!.id, "# Mine");
    boundary.saveDocument.mockResolvedValueOnce({ outcome: "conflict", reason: "changed" });
    press({});
    await vi.waitFor(() => expect(notice()).toContain("notes.md changed on disk"));
    expect(notice()).toContain("Save As");
    expect(app.store.active!.text).toBe("# Mine");
    expect(option()).toBe("• notes.md");
  });

  it("Save on an unbound document opens Save As, then binds and renames it", async () => {
    const app = await workspaceWith({ documents: [{ name: "Untitled.md", text: "draft", bytes: 5 }], errors: [], canceled: false });
    boundary.saveDocumentAs.mockResolvedValueOnce({ outcome: "canceled" });
    press({});
    expect(boundary.saveDocumentAs).toHaveBeenCalledWith(null, "Untitled.md", "draft", false);
    await vi.waitFor(() => expect(notice()).toContain("Save canceled"));
    expect(option(), "cancel changes neither name nor state").toBe("Untitled.md");
    boundary.saveDocumentAs.mockResolvedValueOnce(saved("plan.md", 0, "b".repeat(32)));
    press({ shiftKey: true, key: "S" });
    await vi.waitFor(() => expect(notice()).toBe("Saved plan.md."));
    expect(app.store.active!.name).toBe("plan.md");
    expect(option()).toBe("plan.md");
    app.store.updateText(app.store.active!.id, "draft 2");
    boundary.saveDocument.mockResolvedValueOnce(saved("plan.md", 1, "b".repeat(32)));
    press({});
    expect(boundary.saveDocument).toHaveBeenCalledWith("b".repeat(32), 0, "draft 2", false);
  });

  it("asks before normalising mixed line endings", async () => {
    const app = await workspaceWith(bound("mixed.md", "a\r\nb\n", { eol: "mixed" }));
    app.store.updateText(app.store.active!.id, "a\nb\nc\n");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    press({});
    expect(confirm).toHaveBeenCalledOnce();
    expect(boundary.saveDocument).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    boundary.saveDocument.mockResolvedValueOnce({ ...saved("mixed.md", 1), eol: "lf" });
    press({});
    expect(boundary.saveDocument).toHaveBeenCalledWith(TOKEN, 0, "a\nb\nc\n", true);
    confirm.mockRestore();
  });

  it("a completion for a closed document changes nothing, and closing releases its capability", async () => {
    const app = await workspaceWith(bound("notes.md", "# One"));
    const doc = app.store.active!;
    app.store.updateText(doc.id, "# Edited");
    let finish!: (result: SaveResult) => void;
    boundary.saveDocument.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    press({});
    app.store.remove(doc.id);
    expect(boundary.release).toHaveBeenCalledWith(TOKEN);
    const restored = app.store.add(doc.name, doc.text); // Undo Close: a fresh, unbound identity.
    finish(saved("notes.md", 1));
    await vi.waitFor(() => expect(boundary.saveDocument).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(option()).toBe("• notes.md");
    expect(app.store.active).toBe(restored);
    boundary.saveDocumentAs.mockResolvedValueOnce({ outcome: "canceled" });
    press({});
    expect(boundary.saveDocumentAs, "the restored document cannot revive the revoked token").toHaveBeenCalledWith(null, "notes.md", "# Edited", false);
  });

  it("fences close and handoff while a save is pending", async () => {
    boundary.open.mockResolvedValueOnce(bound("notes.md", "# One"));
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# One"));
    let finish!: (result: SaveResult) => void;
    boundary.saveDocumentAs.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    press({ shiftKey: true, key: "S" });
    expect(boundary.saveDocumentAs).toHaveBeenCalledOnce();
    expect((document.getElementById("reader-workspace") as HTMLButtonElement).disabled).toBe(true);
    document.getElementById("reader-close")!.click();
    expect(document.getElementById("reader-notice")!.textContent).toContain("Wait for the save to finish");
    expect(option()).toBe("notes.md");
    finish(saved("copy.md", 0, "d".repeat(32)));
    await vi.waitFor(() => expect(option()).toBe("copy.md"));
    expect(boundary.release).not.toHaveBeenCalled();
  });

  it("releases a Save As capability whose document disappeared before completion", async () => {
    const app = await workspaceWith({ documents: [{ name: "Untitled.md", text: "draft", bytes: 5 }], errors: [], canceled: false });
    let finish!: (result: SaveResult) => void;
    boundary.saveDocumentAs.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    press({});
    app.store.remove(app.store.active!.id);
    finish(saved("plan.md", 0, "e".repeat(32)));
    await vi.waitFor(() => expect(boundary.release).toHaveBeenCalledWith("e".repeat(32)));
  });

  it("refuses to save text with an unpaired surrogate instead of writing a replacement character", async () => {
    const { native } = await vi.importActual<typeof import("../src/desktop/native")>("../src/desktop/native");
    const lone = String.fromCharCode(0xd800);
    // Refused before any IPC call; the caller reports it and keeps the text open.
    expect(() => native.saveDocument(TOKEN, 0, `bad ${lone} text`, false)).toThrow(/invalid Unicode/);
  });

  it("saves from reading view after edits made in the workspace", async () => {
    const app = await workspaceWith(bound("notes.md", "# One"));
    app.store.updateText(app.store.active!.id, "# Edited in the workspace");
    document.getElementById("reader-return")!.click();
    await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(option()).toBe("• notes.md"));
    boundary.saveDocument.mockResolvedValueOnce(saved("notes.md", 1));
    press({});
    expect(boundary.saveDocument).toHaveBeenCalledWith(TOKEN, 0, "# Edited in the workspace", false);
    await vi.waitFor(() => expect(option()).toBe("notes.md"));
    expect(document.getElementById("reader-notice")!.textContent).toBe("Saved notes.md.");
  });

  it("moving between reading and the workspace never releases a capability", async () => {
    const app = await workspaceWith(bound("notes.md", "# One"));
    document.getElementById("reader-return")!.click();
    await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce());
    expect(boundary.release).not.toHaveBeenCalled();
    document.getElementById("reader-close")!.click();
    expect(boundary.release).toHaveBeenCalledWith(TOKEN);
  });
});
