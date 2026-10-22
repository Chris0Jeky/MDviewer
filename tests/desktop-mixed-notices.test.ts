import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBatch } from "../src/desktop/native";

const boundary = vi.hoisted(() => ({ open: vi.fn(), pending: vi.fn(), render: vi.fn(), notify: () => {} }));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending,
  onPending: vi.fn(async (callback: () => void) => { boundary.notify = callback; return () => {}; }),
  onClose: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/export/destination", () => ({ SaveCanceled: class extends Error {}, setDownloadDestination: vi.fn() }));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const empty = (): OpenBatch => ({ documents: [], errors: [], canceled: false });
function rendered(text: string, warnings: string[] = []) {
  const document = window.document.createElement("div");
  document.textContent = text;
  return { document, warnings };
}
function mixed(): OpenBatch {
  return { documents: [{ name: "good.md", text: "# Good", bytes: 6 }],
    errors: [{ name: "bad.md", message: "Invalid encoding" }], canceled: false };
}
function message(): string { return document.getElementById("reader-notice")!.textContent ?? ""; }

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  localStorage.clear();
  boundary.open.mockReset().mockResolvedValue(empty());
  boundary.pending.mockReset().mockResolvedValue(empty());
  boundary.render.mockReset().mockImplementation(async (text: string) => rendered(text));
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

describe("mixed desktop import and render notices", () => {
  it.each(["picker", "forwarded"] as const)("retains skipped-file errors with %s render warnings", async source => {
    boundary.render.mockResolvedValueOnce(rendered("# Good", ["Document warning"]));
    if (source === "picker") {
      boundary.open.mockResolvedValueOnce(mixed());
      document.getElementById("reader-open")!.click();
    } else {
      boundary.pending.mockResolvedValueOnce(mixed());
      boundary.notify();
    }
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# Good"));
    expect(message()).toBe("bad.md: Invalid encoding Document warning");
    expect(document.getElementById("reader-notice")!.hidden).toBe(false);
    expect(document.getElementById("workspace-notice")!.textContent).toBe(message());
    // The coalesced empty queue must preserve the combined notice without duplication.
    boundary.notify();
    await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledTimes(source === "picker" ? 2 : 3));
    expect(message()).toBe("bad.md: Invalid encoding Document warning");
  });

  it("retains skipped-file errors when the accepted document fails to render", async () => {
    boundary.render.mockRejectedValueOnce(new Error("Rendering unavailable"));
    boundary.pending.mockResolvedValueOnce(mixed());
    boundary.notify();
    await vi.waitFor(() => expect(message()).toContain("Rendering unavailable"));
    expect(message()).toBe("bad.md: Invalid encoding Could not render good.md: Rendering unavailable");
    expect(document.getElementById("workspace-notice")!.textContent).toBe(message());
  });

  it("does not resurrect an obsolete batch's notices after a later document opens", async () => {
    let complete!: (value: ReturnType<typeof rendered>) => void;
    boundary.render.mockReturnValueOnce(new Promise<ReturnType<typeof rendered>>(resolve => { complete = resolve; }));
    boundary.pending.mockResolvedValueOnce(mixed());
    boundary.notify();
    await vi.waitFor(() => expect(boundary.render).toHaveBeenCalledOnce());
    boundary.pending.mockResolvedValueOnce({ ...empty(), documents: [{ name: "later.md", text: "# Later", bytes: 7 }] });
    boundary.notify();
    await vi.waitFor(() => expect(document.getElementById("reader-documents")!.textContent).toContain("later.md"));
    complete(rendered("# Good", ["Obsolete warning"]));
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# Later"));
    expect(message()).toBe("");
    expect(document.getElementById("reader-notice")!.hidden).toBe(true);
  });
});
