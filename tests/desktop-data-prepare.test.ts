import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBatch } from "../src/desktop/native";

// A data kind whose parser fails to load shows the reader's error state, never a blank page.
const boundary = vi.hoisted(() => ({ pending: vi.fn(), open: vi.fn(), render: vi.fn() }));
vi.mock("../src/data", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/data")>();
  return { ...actual, prepare: vi.fn(async (kind: string) => { if (kind === "yaml") throw new Error("The YAML parser could not load."); }) };
});
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending, releaseDocument: vi.fn(async () => {}),
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}), onFilesChanged: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: vi.fn() }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const batch = (name: string, text: string): OpenBatch => ({ documents: [{ name, text, bytes: text.length }], errors: [], canceled: false });

beforeEach(async () => {
  vi.resetModules();
  for (const mock of Object.values(boundary)) mock.mockReset();
  boundary.pending.mockResolvedValue({ documents: [], errors: [], canceled: false });
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
  await import("../src/desktop/main");
  await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledOnce());
});
afterEach(() => { removeListeners.splice(0).forEach(remove => remove()); document.body.replaceChildren(); });

describe("data kinds that load a parser", () => {
  it("a failed parser load is the render's error state, and toReadable is never reached", async () => {
    boundary.open.mockResolvedValueOnce(batch("config.yaml", "name: demo\n"));
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent).toContain("Could not render config.yaml: The YAML parser could not load."));
    expect(document.getElementById("reader-status")!.textContent).toContain("Rendering failed");
    expect(boundary.render).not.toHaveBeenCalled();
  });
});
