import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBatch } from "../src/desktop/native";
import { sanitizeRenderedHtml } from "../src/render/sanitize";

// The real desktop entry; the host and the layout-dependent render are stubbed.
const boundary = vi.hoisted(() => ({
  open: vi.fn(), pending: vi.fn(), render: vi.fn(), openRelative: vi.fn(), readAsset: vi.fn(), external: vi.fn(),
}));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending, external: boundary.external,
  openRelative: boundary.openRelative, readAsset: boundary.readAsset, releaseDocument: vi.fn(async () => {}),
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}), onFilesChanged: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: vi.fn() }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/export/destination", () => ({ SaveCanceled: class extends Error {}, setDownloadDestination: vi.fn() }));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const batch = (name: string, text: string, token: string): OpenBatch => ({
  documents: [{ name, text, bytes: text.length, token, path: `C:\\repo\\${name}`, dir: "C:\\repo", encoding: "utf-8", eol: "lf" }],
  errors: [], canceled: false,
});
const shown = () => document.getElementById("reader-document")!.textContent;
const alt = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true }));

beforeEach(async () => {
  vi.resetModules();
  for (const mock of Object.values(boundary)) mock.mockReset();
  boundary.pending.mockResolvedValue({ documents: [], errors: [], canceled: false });
  boundary.external.mockResolvedValue(undefined);
  // Render the Markdown text as-is, but make "[x](y)" a link and "![](z)" an image like the reader would.
  boundary.render.mockImplementation(async (text: string) => {
    const rendered = document.createElement("div");
    rendered.className = "doc";
    rendered.innerHTML = sanitizeRenderedHtml(text
      .replace(/!\[\]\(([^)]+)\)/g, '<img src="$1">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')).html;
    return { document: rendered, warnings: [] };
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:local-image"), revokeObjectURL: vi.fn() }));
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
afterEach(() => {
  removeListeners.splice(0).forEach(remove => remove());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function openGuide(): Promise<void> {
  boundary.open.mockResolvedValueOnce(batch("guide.md", "Guide [next](../docs/next.md#part) [web](https://example.com)", "a".repeat(32)));
  document.getElementById("reader-open")!.click();
  await vi.waitFor(() => expect(shown()).toContain("Guide"));
}

describe("desktop relative links, images and history", () => {
  it("opens a relative link through the host, then goes back and forward", async () => {
    await openGuide();
    boundary.openRelative.mockResolvedValueOnce(batch("next.md", "Next page", "b".repeat(32)));
    document.querySelector<HTMLAnchorElement>('.doc a[href^="../"]')!.click();
    expect(boundary.openRelative).toHaveBeenCalledWith("a".repeat(32), "../docs/next.md#part");
    await vi.waitFor(() => expect(shown()).toBe("Next page"));
    alt("ArrowLeft");
    await vi.waitFor(() => expect(shown()).toContain("Guide"));
    alt("ArrowRight");
    await vi.waitFor(() => expect(shown()).toBe("Next page"));
    // Web links still go to the system browser only.
    alt("ArrowLeft");
    await vi.waitFor(() => expect(shown()).toContain("Guide"));
    document.querySelector<HTMLAnchorElement>('.doc a[href^="https:"]')!.click();
    expect(boundary.external).toHaveBeenCalledWith("https://example.com/");
  });

  it("loads a relative image through the host as a blob URL", async () => {
    boundary.readAsset.mockResolvedValueOnce(new Uint8Array([137, 80, 78, 71]).buffer);
    boundary.open.mockResolvedValueOnce(batch("pic.md", "Pic ![](img/diagram.png)", "c".repeat(32)));
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>(".doc img")?.getAttribute("src")).toBe("blob:local-image"));
    expect(boundary.readAsset).toHaveBeenCalledWith("c".repeat(32), "img/diagram.png");
  });

  it("the sanitizer keeps only relative image references, inert", () => {
    const out = sanitizeRenderedHtml('<img src="a/b.png"><img src="https://x.test/t.png"><img src="/abs.png"><img src="file:///C:/x.png">').html;
    const doc = new DOMParser().parseFromString(out, "text/html");
    const images = [...doc.querySelectorAll("img")];
    expect(images.map(image => image.getAttribute("src"))).toEqual([null, null, null, null]);
    expect(images.map(image => image.getAttribute("data-local-src"))).toEqual(["a/b.png", null, null, null]);
  });
});
