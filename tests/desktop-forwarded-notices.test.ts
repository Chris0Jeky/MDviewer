import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBatch } from "../src/desktop/native";

const boundary = vi.hoisted(() => ({ open: vi.fn(), pending: vi.fn(), notify: () => {} }));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending,
  onPending: vi.fn(async (callback: () => void) => { boundary.notify = callback; return () => {}; }),
  onClose: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: async (text: string) => {
  const document = window.document.createElement("div"); document.textContent = text;
  return { document, warnings: [] };
} }));
vi.mock("../src/export/destination", () => ({ SaveCanceled: class extends Error {}, setDownloadDestination: vi.fn() }));
const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const empty = (): OpenBatch => ({ documents: [], errors: [], canceled: false });

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  localStorage.clear();
  boundary.open.mockReset().mockRejectedValue(new Error("Previous picker failure"));
  boundary.pending.mockReset().mockResolvedValue(empty());
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      add(type, listener, options);
      removeListeners.push(() => target.removeEventListener(type, listener, options));
    });
  }
  await import("../src/desktop/main");
  await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledOnce());
  document.getElementById("reader-open")!.click();
  await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent).toContain("Previous picker failure"));
});
afterEach(() => { removeListeners.splice(0).forEach(remove => remove()); document.body.replaceChildren(); });

describe("forwarded-file notice lifetime", () => {
  it.each([false, true])("only a nonempty forwarded batch takes selection from a pending picker (nonempty: %s)", async nonempty => {
    boundary.pending.mockResolvedValueOnce({ ...empty(), documents: [{ name: "existing.md", text: "# Existing", bytes: 10 }] });
    boundary.notify();
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# Existing"));

    let complete!: (batch: OpenBatch) => void;
    boundary.open.mockReturnValueOnce(new Promise<OpenBatch>(resolve => { complete = resolve; }));
    document.getElementById("reader-open")!.click();
    boundary.pending.mockResolvedValueOnce(nonempty
      ? { ...empty(), documents: [{ name: "forwarded.md", text: "# Forwarded", bytes: 11 }] }
      : empty());
    boundary.notify();
    await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledTimes(3));
    if (nonempty) await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# Forwarded"));

    complete({ ...empty(), documents: [{ name: "picked.md", text: "# Picked", bytes: 8 }] });
    await vi.waitFor(() => expect(document.querySelectorAll("#reader-documents option")).toHaveLength(nonempty ? 3 : 2));
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe(nonempty ? "# Forwarded" : "# Picked"));
    const picker = document.getElementById("reader-documents") as HTMLSelectElement;
    expect(picker.selectedOptions[0]!.textContent).toBe(nonempty ? "forwarded.md" : "picked.md");
  });

  it("keeps a newer picker selection when an earlier forwarded read completes", async () => {
    let complete!: (batch: OpenBatch) => void;
    boundary.pending.mockReturnValueOnce(new Promise<OpenBatch>(resolve => { complete = resolve; }));
    boundary.notify();
    await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledTimes(2));
    boundary.open.mockResolvedValueOnce({ ...empty(), documents: [{ name: "picked.md", text: "# Picked", bytes: 8 }] });
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# Picked"));
    complete({ ...empty(), documents: [{ name: "forwarded.md", text: "# Forwarded", bytes: 11 }] });
    await vi.waitFor(() => expect(document.querySelectorAll("#reader-documents option")).toHaveLength(2));
    expect(document.getElementById("reader-document")!.textContent).toBe("# Picked");
    const picker = document.getElementById("reader-documents") as HTMLSelectElement;
    expect(picker.selectedOptions[0]!.textContent).toBe("picked.md");
  });

  it("clears the previous failure when a clean forwarded document opens", async () => {
    boundary.pending.mockResolvedValueOnce({ ...empty(), documents: [{ name: "forwarded.md", text: "# Forwarded clean", bytes: 17 }] });
    boundary.notify();
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# Forwarded clean"));
    expect(document.getElementById("reader-notice")!.textContent).toBe("");
    expect(document.getElementById("reader-notice")!.hidden).toBe(true);
    expect(document.getElementById("workspace-notice")!.textContent).toBe("");
  });

  it("retains new batch failures instead of suppressing them with a successful render", async () => {
    boundary.pending.mockResolvedValueOnce({ documents: [{ name: "good.md", text: "# Good", bytes: 6 }],
      errors: [{ name: "bad.md", message: "Invalid encoding" }], canceled: false });
    boundary.notify();
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# Good"));
    expect(document.getElementById("reader-notice")!.textContent).toBe("bad.md: Invalid encoding");
    expect(document.getElementById("reader-notice")!.hidden).toBe(false);
  });

  it("surfaces a new pending-file command failure", async () => {
    boundary.pending.mockRejectedValueOnce(new Error("Forwarding failed")); boundary.notify();
    await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent).toBe("Could not open launched files: Forwarding failed"));
  });

  it("does not erase an existing notice when the native queue is empty", async () => {
    boundary.notify();
    await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledTimes(2));
    expect(document.getElementById("reader-notice")!.textContent).toBe("Could not open files: Previous picker failure");
  });

  it("keeps first-pass failures when coalesced notifications cause an empty second pass", async () => {
    let complete!: (batch: OpenBatch) => void;
    boundary.pending.mockReturnValueOnce(new Promise<OpenBatch>(resolve => { complete = resolve; }));
    boundary.notify();
    await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledTimes(2));
    boundary.notify();
    complete({ ...empty(), errors: [{ name: "bad.md", message: "Invalid encoding" }] });
    await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledTimes(3));
    expect(document.getElementById("reader-notice")!.textContent).toBe("bad.md: Invalid encoding");
    expect(document.getElementById("reader-notice")!.hidden).toBe(false);
    expect(document.getElementById("workspace-notice")!.textContent).toBe("bad.md: Invalid encoding");
  });
});
