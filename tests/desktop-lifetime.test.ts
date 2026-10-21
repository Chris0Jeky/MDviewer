import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../src/app/state";
import type { ReaderSession } from "../src/desktop/session";
import type { OpenBatch } from "../src/desktop/native";

// Exercise the actual entry's ownership and event wiring. Rendering and the
// native/mount boundaries are stubbed: this is source lifetime, not layout proof.
const boundary = vi.hoisted(() => ({
  sessions: [] as ReaderSession[],
  open: vi.fn(), pending: vi.fn(), start: vi.fn(), render: vi.fn(),
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
  available: true, open: boundary.open, takePending: boundary.pending,
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: boundary.start }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/export/destination", () => ({ SaveCanceled: class extends Error {}, setDownloadDestination: vi.fn() }));

type Baseline = { name: string; text: string; dirty: boolean };
const baselineMaps: Map<string, Baseline>[] = [];
const removeListeners: Array<() => void> = [];
const html = readFileSync("desktop.html", "utf8");

function batch(documents: Array<{ name: string; text: string }>): OpenBatch {
  return { documents: documents.map(doc => ({ ...doc, bytes: new TextEncoder().encode(doc.text).length })), errors: [], canceled: false };
}

function click(id: string): void { document.getElementById(id)!.click(); }

beforeEach(async () => {
  vi.resetModules();
  boundary.sessions.length = 0; baselineMaps.length = 0;
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  localStorage.clear();
  boundary.open.mockReset(); boundary.pending.mockReset().mockResolvedValue(batch([]));
  boundary.start.mockReset();
  boundary.render.mockReset().mockImplementation(async (text: string) => {
    const rendered = document.createElement("div"); rendered.textContent = text;
    return { document: rendered, warnings: [] };
  });
  // Observe the actual baseline container, without adding a production test API.
  // No references to source values are retained by this observer after teardown.
  const originalSet = Map.prototype.set;
  vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (typeof key === "string" && key.startsWith("doc-") && value && typeof value === "object"
      && "name" in value && String(value.name).startsWith("retention-") && "dirty" in value) {
      const map = this as Map<string, Baseline>;
      if (!baselineMaps.includes(map)) baselineMaps.push(map);
    }
    return originalSet.call(this, key, value);
  });
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      add(type, listener, options);
      removeListeners.push(() => target.removeEventListener(type, listener, options));
    });
  }
  await import("../src/desktop/main");
});

afterEach(() => {
  removeListeners.splice(0).forEach(remove => remove());
  baselineMaps.length = 0; boundary.sessions.length = 0;
  document.body.replaceChildren();
});

async function openReader() {
  const documents = [
    { name: "retention-alpha.md", text: "# Alpha original" },
    { name: "retention-beta.md", text: "# Beta original" },
  ];
  boundary.open.mockResolvedValueOnce(batch(documents)); click("reader-open");
  await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe(documents[0]!.text));
  return { session: boundary.sessions[0]!, documents };
}

function mount() {
  const store = new DocStore();
  const app = { store, exportState: { busy: false }, flushRender: vi.fn(async () => {}),
    focusEditor: vi.fn(), destroy: vi.fn(), onExportStateChange: vi.fn(() => () => {}) };
  boundary.start.mockReturnValueOnce({ app, detachShortcuts: vi.fn() });
  click("reader-workspace");
  return app;
}

async function entered(app: ReturnType<typeof mount>): Promise<void> {
  await vi.waitFor(() => expect(app.focusEditor).toHaveBeenCalledOnce());
}

describe("desktop source ownership", () => {
  it("releases the reader sources after transfer and follows current workspace identity", async () => {
    const before = await openReader();
    before.session.documents[1]!.dirty = true;
    before.session.activeId = before.session.documents[1]!.id;
    const app = mount(); await entered(app);
    expect(app.store.openDocs.map(({ name, text }) => ({ name, text }))).toEqual(before.documents);
    expect(app.store.active!.name).toBe("retention-beta.md");
    expect(baselineMaps[0]!.get(app.store.activeId!)!.dirty).toBe(true);
    expect(before.session.documents, "workspace owns the only open-source set").toEqual([]);
    expect(before.session.activeId).toBeNull();
    expect(document.title).toBe("retention-beta.md — MDviewer");
    app.store.setActive(app.store.openDocs[0]!.id);
    expect(document.title).toBe("retention-alpha.md — MDviewer");
    expect((document.getElementById("reader-documents") as HTMLSelectElement).selectedOptions[0]!.text).toBe("retention-alpha.md");
  });

  it("prunes a closed baseline, keeps restored edits dirty and releases baselines on return", async () => {
    await openReader(); const app = mount(); await entered(app);
    const originals = baselineMaps[0]!;
    const closed = app.store.openDocs[0]!;
    app.store.updateText(closed.id, "# Restored edited Alpha"); app.store.remove(closed.id);
    expect(originals.has(closed.id), "closed source must not remain in the baseline map").toBe(false);
    const restored = app.store.add(closed.name, closed.text);
    expect(originals.has(restored.id), "generic additions must never become pristine baselines").toBe(false);
    click("reader-return");
    await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce());
    expect(originals.size, "successful workspace teardown releases every source baseline").toBe(0);
    const reader = boundary.sessions.at(-1)!;
    expect(reader.active).toMatchObject({ name: closed.name, text: closed.text, dirty: true });
    expect(reader.documents).toHaveLength(2);
    expect(document.title).toBe("retention-alpha.md — MDviewer");
  });

  it("keeps all edited sources and baselines if return admission fails, then allows a retry", async () => {
    await openReader(); const app = mount(); await entered(app);
    const originals = baselineMaps[0]!;
    const active = app.store.active!;
    app.store.updateText(active.id, "é".repeat(12_500_000));
    click("reader-return");
    await vi.waitFor(() => expect(document.getElementById("workspace-notice")!.textContent).toContain("memory limit"));
    expect(app.store.openDocs).toHaveLength(2);
    expect(app.store.active!.text).toBe(active.text);
    expect(originals.size).toBe(2);
    expect(originals.get(active.id)!.text).toBe("# Alpha original");
    expect(app.destroy).not.toHaveBeenCalled();
    expect(document.title).toBe("retention-alpha.md — MDviewer");
    app.store.updateText(active.id, "# Smaller edited Alpha"); click("reader-return");
    await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce());
    expect(boundary.sessions.at(-1)!.active).toMatchObject({ text: "# Smaller edited Alpha", dirty: true });
    expect(originals.size).toBe(0);
  });

  it("retains the original reader when mounting fails and releases it only after retry succeeds", async () => {
    const before = await openReader();
    boundary.start.mockImplementationOnce(() => { throw new Error("Mount refused"); });
    click("reader-workspace");
    await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent).toContain("Mount refused"));
    expect(before.session.documents.map(({ name, text }) => ({ name, text }))).toEqual(before.documents);
    expect(document.getElementById("reader-shell")!.hidden).toBe(false);
    const app = mount(); await entered(app);
    expect(before.session.documents).toEqual([]);
    expect(app.store.openDocs).toHaveLength(2);
  });

  it("keeps workspace selection and clean metadata when a queued import completes during handoff", async () => {
    const before = await openReader();
    let resolveOpen!: (result: OpenBatch) => void;
    boundary.open.mockImplementationOnce(() => new Promise<OpenBatch>(resolve => { resolveOpen = resolve; }));
    click("reader-open");
    let finishRender!: () => void;
    const app = mount();
    app.flushRender.mockImplementationOnce(() => new Promise<void>(resolve => { finishRender = resolve; }));
    await vi.waitFor(() => expect(app.flushRender).toHaveBeenCalledOnce());
    resolveOpen(batch([{ name: "retention-queued.md", text: "# Queued source" }]));
    await Promise.resolve(); await Promise.resolve();
    expect(app.store.openDocs).toHaveLength(2);
    finishRender(); await entered(app);
    expect(before.session.documents).toEqual([]);
    expect(app.store.openDocs).toHaveLength(3);
    expect(document.title).toBe("retention-alpha.md — MDviewer");
    const picker = document.getElementById("reader-documents") as HTMLSelectElement;
    expect([...picker.options].map(option => option.text)).toEqual([
      "retention-alpha.md", "retention-beta.md", "retention-queued.md",
    ]);
    app.store.setActive(app.store.openDocs[2]!.id);
    expect(document.title).toBe("retention-queued.md — MDviewer");
    click("reader-return");
    await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce());
    expect(boundary.sessions.at(-1)!.active).toMatchObject({ name: "retention-queued.md", dirty: false });
  });

  it("rolls back a failed teardown with the same identities, edits and dirty baselines", async () => {
    await openReader(); const app = mount(); await entered(app);
    const originals = baselineMaps[0]!;
    const edited = app.store.openDocs[0]!;
    app.store.updateText(edited.id, "# Edited original");
    const restored = app.store.add("restored.md", "# Restored edits");
    const before = [...app.store.openDocs];
    const baselines = [...originals];
    app.flushRender.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Teardown refused"));
    click("reader-return");
    await vi.waitFor(() => expect(document.getElementById("workspace-notice")!.textContent).toContain("Teardown refused"));
    expect(app.store.openDocs).toEqual(before);
    app.store.openDocs.forEach((doc, index) => expect(doc).toBe(before[index]));
    expect(app.store.active).toBe(restored);
    expect([...originals]).toEqual(baselines);
    expect(originals.has(restored.id)).toBe(false);
    expect(app.destroy).not.toHaveBeenCalled();
    click("reader-return");
    await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce());
    expect(boundary.sessions.at(-1)!.documents.map(doc => [doc.name, doc.dirty])).toEqual([
      ["retention-alpha.md", true], ["retention-beta.md", false], ["restored.md", true],
    ]);
    expect(originals.size).toBe(0);
  });

  it("blocks workspace actions during return and releases the interaction guard after failure or success", async () => {
    await openReader(); const app = mount(); await entered(app);
    const root = document.getElementById("app")!;
    const action = document.createElement("button"); root.append(action);
    const invoke = vi.fn(); action.addEventListener("click", invoke);
    let reject!: (error: Error) => void;
    app.flushRender.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    click("reader-return");
    expect(root.inert, "no new editor/sample action can race the return snapshot").toBe(true);
    action.click(); // DocumentShortcuts dispatches the same programmatic click.
    expect(invoke).not.toHaveBeenCalled();
    reject(new Error("Preparation refused"));
    await vi.waitFor(() => expect(document.getElementById("workspace-notice")!.textContent).toContain("Preparation refused"));
    expect(root.inert).toBe(false);
    action.click(); expect(invoke).toHaveBeenCalledOnce();
    click("reader-return");
    await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce());
    expect(root.inert).toBe(false);
  });
});
