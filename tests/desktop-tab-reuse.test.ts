import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBatch } from "../src/desktop/native";
import { tabTexts } from "./helpers/desktopTabs";

// S9: switching back to the document just left swaps its kept DOM instead of rendering again.
const boundary = vi.hoisted(() => ({ pending: vi.fn(), open: vi.fn(), render: vi.fn() }));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending, releaseDocument: vi.fn(async () => {}),
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}), onFilesChanged: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: vi.fn() }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const shown = () => document.getElementById("reader-document")!.textContent;
const tab = (label: string) => [...document.querySelectorAll<HTMLElement>('#shell-tabs [role="tab"]')].find(item => item.textContent?.includes(label))!;
const ready = () => document.getElementById("reader-document")!.getAttribute("aria-busy") === "false";

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

describe("tab switch reuse", () => {
  it("switching back swaps the kept DOM instead of rendering, both ways", async () => {
    const batch: OpenBatch = { documents: [{ name: "a.md", text: "# A", bytes: 3 }, { name: "b.md", text: "# B", bytes: 3 }], errors: [], canceled: false };
    boundary.open.mockResolvedValueOnce(batch);
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(tabTexts()).toHaveLength(2));
    await vi.waitFor(() => expect(ready()).toBe(true));
    const first = shown();
    const other = first === "# A" ? "b.md" : "a.md";
    const back = first === "# A" ? "a.md" : "b.md";
    const firstNode = document.getElementById("reader-document")!.firstChild;
    tab(other).click();
    await vi.waitFor(() => expect(shown()).not.toBe(first));
    await vi.waitFor(() => expect(ready()).toBe(true));
    const renders = boundary.render.mock.calls.length;
    tab(back).click();
    await vi.waitFor(() => expect(shown()).toBe(first));
    expect(boundary.render).toHaveBeenCalledTimes(renders); // no new render
    expect(document.getElementById("reader-document")!.firstChild).toBe(firstNode); // the same nodes
    expect(ready()).toBe(true);
    // Switching again keeps working both ways.
    tab(other).click();
    await vi.waitFor(() => expect(shown()).not.toBe(first));
    expect(boundary.render).toHaveBeenCalledTimes(renders);
  });
});
