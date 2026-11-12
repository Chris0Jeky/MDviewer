import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../src/app/state";
import type { OpenBatch, SaveResult } from "../src/desktop/native";
import { activeTab } from "./helpers/desktopTabs";
import { parseActionable } from "../src/render/actionable";

// The real desktop entry, document owner and command registry; the native host
// and the layout-dependent workspace/render boundaries are stubbed.
const boundary = vi.hoisted(() => ({
  open: vi.fn(), pending: vi.fn(), start: vi.fn(), render: vi.fn(),
  saveDocument: vi.fn(), saveDocumentAs: vi.fn(), release: vi.fn(), patch: vi.fn(),
}));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending,
  saveDocument: boundary.saveDocument, saveDocumentAs: boundary.saveDocumentAs, releaseDocument: boundary.release,
  patchDocument: boundary.patch,
  onPending: vi.fn(async () => () => {}), onFilesChanged: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}),
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
const option = (): string => activeTab();

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

describe("actionable write-back in the desktop entry", () => {
  it("adopts the generation a saved patch returns, so the next Save is not stale", async () => {
    const text = "# Card\n\n- [ ] Ship <!-- id: ship -->\n";
    const after = "# Card\n\n- [x] Ship <!-- id: ship -->\n";
    boundary.open.mockResolvedValueOnce(bound("card.md", text));
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe(text));
    boundary.patch.mockResolvedValueOnce({ outcome: "saved", generation: 7, text: after });
    const { controlHandler } = await import("../src/desktop/reader/controls");
    controlHandler()!(parseActionable(text).controls[0]!, { kind: "mark", to: "x" });
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe(after));
    expect(boundary.patch).toHaveBeenCalledWith(TOKEN, [{ line: 3, id: "ship", expect: "- [ ] Ship <!-- id: ship -->", replace: "- [x] Ship <!-- id: ship -->" }]);
    expect(option(), "a saved change leaves the document clean").toBe("card.md");
    expect(document.querySelector(".am-notice")!.textContent).toContain("Marked done");
    expect(document.querySelector(".am-notice")!.textContent).toContain("Undo");

    // Edit in the workspace and save: the host must receive generation 7, not 0.
    const store = new DocStore();
    const app = { store, settings: { viewMode: "split" }, exportState: { busy: false },
      flushRender: vi.fn(async () => {}), captureDocumentPosition: vi.fn(), restoreDocumentPosition: vi.fn(),
      focusEditor: vi.fn(), destroy: vi.fn(), updateSettings: vi.fn(), onExportStateChange: vi.fn(() => () => {}) };
    boundary.start.mockReturnValueOnce({ app, detachShortcuts: vi.fn() });
    document.getElementById("reader-workspace")!.click();
    await vi.waitFor(() => expect(app.focusEditor).toHaveBeenCalledOnce());
    store.updateText(store.active!.id, after + "More.\n");
    boundary.saveDocument.mockResolvedValueOnce(saved("card.md", 8));
    press({});
    expect(boundary.saveDocument).toHaveBeenCalledWith(TOKEN, 7, after + "More.\n", false);
    await vi.waitFor(() => expect(notice()).toBe("Saved card.md."));
  });
});
