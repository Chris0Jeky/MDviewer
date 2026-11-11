import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBatch } from "../src/desktop/native";

const boundary = vi.hoisted(() => ({
  pending: vi.fn(), render: vi.fn(), restore: vi.fn(), record: vi.fn(), setting: vi.fn(),
}));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: vi.fn(), takePending: boundary.pending, releaseDocument: vi.fn(async () => {}),
  session: { restore: boundary.restore, record: boundary.record, setting: boundary.setting },
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}), onFilesChanged: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: vi.fn() }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/export/destination", () => ({ SaveCanceled: class extends Error {}, setDownloadDestination: vi.fn() }));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const token = (n: number) => n.toString(16).padStart(32, "0");
function batch(names: string[], first = 1): OpenBatch {
  return { documents: names.map((name, index) => ({ name, text: `# ${name}`, bytes: 4, token: token(first + index),
    path: `C:\\n\\${name}`, dir: "C:\\n", encoding: "utf-8" as const, eol: "lf" as const })), errors: [], canceled: false };
}
const empty: OpenBatch = { documents: [], errors: [], canceled: false };
const shown = () => document.getElementById("reader-document")!.textContent;
const options = () => [...(document.getElementById("reader-documents") as HTMLSelectElement).options].map(o => o.text);

async function boot(launch: OpenBatch, restored: OpenBatch): Promise<void> {
  boundary.pending.mockResolvedValueOnce(launch).mockResolvedValue(empty);
  boundary.restore.mockResolvedValueOnce(restored);
  await import("../src/desktop/main");
  await vi.waitFor(() => expect(boundary.restore).toHaveBeenCalledOnce());
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(boundary)) mock.mockReset();
  boundary.record.mockResolvedValue(undefined);
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
  // Let this test's coalesced session record fire before the next test resets the mocks.
  await new Promise(resolve => setTimeout(resolve, 600));
  removeListeners.splice(0).forEach(remove => remove());
  document.body.replaceChildren();
});

describe("desktop session restore", () => {
  it("reopens the last session after launch files without taking focus from them", async () => {
    await boot(batch(["launched.md"], 1), batch(["a.md", "b.md"], 2));
    await vi.waitFor(() => expect(options()).toEqual(["launched.md", "a.md", "b.md"]));
    expect(shown()).toBe("# launched.md");
  });

  it("an empty launch shows the first restored file", async () => {
    await boot(empty, batch(["a.md", "b.md"], 2));
    await vi.waitFor(() => expect(shown()).toBe("# a.md"));
  });

  it("records the open bound files once they settle, and reports unreopenable ones once", async () => {
    await boot(batch(["one.md"], 1), { documents: [], errors: [{ name: "x.md", message: "gone" }, { name: "y.md", message: "gone" }], canceled: false });
    await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent).toContain("Last session: 2 file(s) could not be reopened."));
    await vi.waitFor(() => expect(boundary.record).toHaveBeenCalledWith([token(1)]), { timeout: 2000 });
    document.getElementById("reader-close")!.click();
    await vi.waitFor(() => expect(boundary.record).toHaveBeenLastCalledWith([]), { timeout: 2000 });
    expect(boundary.record.mock.calls).toEqual([[[token(1)]], [[]]]);
  });

  it("toggles the reopen-on-launch preference", async () => {
    await boot(empty, empty);
    boundary.setting.mockResolvedValueOnce({ restore: true, persisted: true }).mockResolvedValueOnce({ restore: false, persisted: true });
    const { runCommand } = await import("../src/desktop/commands");
    expect(runCommand("session.toggleRestore")).toBe(true);
    await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent).toBe("MDviewer will start empty next time."));
    expect(boundary.setting).toHaveBeenNthCalledWith(1, null);
    expect(boundary.setting).toHaveBeenNthCalledWith(2, false);
    // A store that cannot be written must not claim the preference was saved.
    boundary.setting.mockResolvedValueOnce({ restore: false, persisted: true }).mockResolvedValueOnce({ restore: true, persisted: false });
    runCommand("session.toggleRestore");
    await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent).toContain("could not be saved"));
  });
});
