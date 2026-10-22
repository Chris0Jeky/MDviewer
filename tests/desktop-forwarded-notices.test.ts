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
});
