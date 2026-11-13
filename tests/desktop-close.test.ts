import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBatch } from "../src/desktop/native";

// The real entry against a mocked host: close handling and the session flush ordering (#305, #250).
const boundary = vi.hoisted(() => ({
  pending: vi.fn(), render: vi.fn(), restore: vi.fn(), record: vi.fn(), setting: vi.fn(),
  onClose: vi.fn(), onPending: vi.fn(), onFilesChanged: vi.fn(),
}));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: vi.fn(), takePending: boundary.pending, releaseDocument: vi.fn(async () => {}),
  session: { restore: boundary.restore, record: boundary.record, setting: boundary.setting },
  onPending: boundary.onPending, onClose: boundary.onClose, onFilesChanged: boundary.onFilesChanged,
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: vi.fn() }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/export/destination", () => ({ SaveCanceled: class extends Error {}, setDownloadDestination: vi.fn() }));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const token = (n: number) => n.toString(16).padStart(32, "0");
const empty: OpenBatch = { documents: [], errors: [], canceled: false };
const launched: OpenBatch = { documents: [{ name: "a.md", text: "# a", bytes: 3, token: token(1),
  path: "C:\\n\\a.md", dir: "C:\\n", encoding: "utf-8", eol: "lf" }], errors: [], canceled: false };
const never = () => new Promise<never>(() => {});
type Close = [() => boolean, () => Promise<void>];
const closeHandlers = (): Close => boundary.onClose.mock.calls[0] as Close;

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(boundary)) mock.mockReset();
  boundary.record.mockResolvedValue(undefined);
  boundary.onClose.mockResolvedValue(() => {});
  boundary.onPending.mockResolvedValue(() => {});
  boundary.onFilesChanged.mockResolvedValue(() => {});
  boundary.pending.mockResolvedValue(empty);
  boundary.render.mockImplementation(async (text: string) => {
    const rendered = document.createElement("div"); rendered.textContent = text;
    return { document: rendered, warnings: [] };
  });
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      add(type, listener, options);
      removeListeners.push(() => target.removeEventListener(type, listener, options));
    });
  }
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 600));
  removeListeners.splice(0).forEach(remove => remove());
  document.body.replaceChildren();
});

describe("desktop close while starting (#305)", () => {
  it("registers the close handler before any other startup step resolves", async () => {
    boundary.onPending.mockReturnValue(never());
    boundary.onFilesChanged.mockReturnValue(never());
    await import("../src/desktop/main");
    await vi.waitFor(() => expect(boundary.onPending).toHaveBeenCalled());
    expect(boundary.onClose).toHaveBeenCalledOnce();
    expect(boundary.onClose.mock.invocationCallOrder[0]!).toBeLessThan(boundary.onPending.mock.invocationCallOrder[0]!);
    expect(boundary.onFilesChanged).not.toHaveBeenCalled();
    const [canClose, flush] = closeHandlers();
    expect(canClose(), "nothing is loaded yet, so nothing can be lost").toBe(true);
    await expect(flush()).resolves.toBeUndefined();
  });

  it("a close before the last session is restored still records the launch files", async () => {
    boundary.pending.mockResolvedValueOnce(launched).mockResolvedValue(empty);
    boundary.restore.mockReturnValue(never());
    await import("../src/desktop/main");
    await vi.waitFor(() => expect(boundary.restore).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# a"));
    await closeHandlers()[1]();
    expect(boundary.record).toHaveBeenCalledExactlyOnceWith([token(1)]);
  });
});

describe("desktop session flush ordering (#250)", () => {
  it("sends the closing list only after a record still in flight has landed", async () => {
    boundary.pending.mockResolvedValueOnce(launched).mockResolvedValue(empty);
    boundary.restore.mockResolvedValue(empty);
    let land!: () => void;
    boundary.record.mockImplementationOnce(() => new Promise<void>(resolve => { land = resolve; }));
    await import("../src/desktop/main");
    await vi.waitFor(() => expect(boundary.record).toHaveBeenCalledWith([token(1)]), { timeout: 2000 });
    document.getElementById("reader-close")!.click(); // The open set is now empty.
    const flushed = closeHandlers()[1]();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(boundary.record, "the newer list waits for the older one").toHaveBeenCalledTimes(1);
    land();
    await flushed;
    expect(boundary.record.mock.calls).toEqual([[[token(1)]], [[]]]);
  });
});
