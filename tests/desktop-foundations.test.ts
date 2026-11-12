import { afterEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../src/app/state";
import type { App } from "../src/app/App";
import { commandForEvent, installShortcuts, listCommands, registerCommand, runCommand } from "../src/desktop/commands";
import { DesktopDocuments, bindingOf } from "../src/desktop/documents";
import { listPanels, registerPanel } from "../src/desktop/panels";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

function key(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...init });
}

describe("command registry", () => {
  it("matches exact modifiers, claims repeated or disabled shortcuts and unregisters", () => {
    const run = vi.fn();
    let enabled = true;
    cleanups.push(registerCommand({ id: "t.save", title: "Save", keys: ["Mod+S"], enabled: () => enabled, run }));
    cleanups.push(registerCommand({ id: "t.saveAs", title: "Save As", keys: ["Mod+Shift+S"], run: vi.fn() }));
    expect(commandForEvent(key("s"))?.id).toBe("t.save");
    expect(commandForEvent(key("S", { shiftKey: true }))?.id).toBe("t.saveAs");
    expect(commandForEvent(key("s", { ctrlKey: false }))).toBeUndefined();
    expect(commandForEvent(key("s", { metaKey: true })), "Ctrl and Cmd together is not Mod").toBeUndefined();
    expect(commandForEvent(key("s", { altKey: true }))).toBeUndefined();

    let active = true;
    cleanups.push(installShortcuts(window, () => active));
    const plain = key("s"); window.dispatchEvent(plain);
    expect(run).toHaveBeenCalledOnce(); expect(plain.defaultPrevented).toBe(true);
    const repeated = key("s", { repeat: true }); window.dispatchEvent(repeated);
    enabled = false; const disabled = key("s"); window.dispatchEvent(disabled);
    expect(run).toHaveBeenCalledOnce();
    expect([repeated.defaultPrevented, disabled.defaultPrevented]).toEqual([true, true]);
    active = false; const inactive = key("s"); window.dispatchEvent(inactive);
    expect(inactive.defaultPrevented).toBe(false);
    expect(runCommand("t.save")).toBe(false);
    enabled = true; expect(runCommand("t.save")).toBe(true);
    expect(() => registerCommand({ id: "t.save", title: "dup", run: vi.fn() })).toThrow(/already registered/);
    cleanups.splice(0).forEach(cleanup => cleanup());
    expect(listCommands().map(command => command.id)).not.toContain("t.save");
  });

  it("registers and removes panels", () => {
    const remove = registerPanel({ id: "t.library", title: "Library", mount: () => () => {} });
    expect(listPanels().map(panel => panel.id)).toContain("t.library");
    remove();
    expect(listPanels().map(panel => panel.id)).not.toContain("t.library");
  });
});

describe("desktop document ownership", () => {
  it("carries a stable key and binding from an open through the workspace and back", () => {
    const docs = new DesktopDocuments();
    const opened = { name: "a.md", text: "# A", bytes: 3, token: "f".repeat(32), path: "C:\\notes\\a.md", dir: "C:\\notes", encoding: "utf-8-bom" as const, eol: "crlf" as const };
    expect(docs.addBatch([opened, { name: "b.md", text: "# B", bytes: 3 }], true)).toEqual([]);
    const [a, b] = docs.reader.documents;
    expect(a!.binding).toEqual({ ...bindingOf(opened), disk: "synced" });
    expect(b!.binding).toBeUndefined();
    expect(a!.key).not.toBe(b!.key);

    const store = new DocStore();
    const app = { store, restoreDocumentPosition: vi.fn() } as unknown as App;
    docs.adoptReaderInto(app);
    docs.releaseReader();
    const [wa] = store.openDocs;
    expect(docs.baselines.get(wa!.id)).toMatchObject({ key: a!.key, binding: a!.binding, dirty: false });
    store.updateText(wa!.id, "# A edited");
    expect(docs.list().docs.map(doc => [doc.key, doc.dirty])).toEqual([[a!.key, true], [b!.key, false]]);

    const next = docs.readerSnapshot(app);
    docs.returnToReader(next);
    expect(docs.workspace).toBeNull();
    expect(docs.baselines.size).toBe(0);
    expect(docs.reader.documents.map(doc => [doc.key, doc.dirty, doc.binding?.token])).toEqual([
      [a!.key, true, opened.token], [b!.key, false, undefined],
    ]);
  });

  it("ignores host fields without a token", () => {
    expect(bindingOf({ name: "a.md", text: "", bytes: 0, token: null, path: "C:\\a.md" })).toBeUndefined();
  });
});
