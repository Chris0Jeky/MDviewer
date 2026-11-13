import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBatch } from "../src/desktop/native";
import { sanitizeRenderedHtml } from "../src/render/sanitize";
import { activeTab, tabTexts } from "./helpers/desktopTabs";

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
    const guideScroll = 420;
    document.getElementById("reader-scroll")!.scrollTop = guideScroll;
    boundary.openRelative.mockResolvedValueOnce(batch("next.md", "Next page", "b".repeat(32)));
    document.querySelector<HTMLAnchorElement>('.doc a[href^="../"]')!.click();
    expect(boundary.openRelative).toHaveBeenCalledWith("a".repeat(32), "../docs/next.md#part");
    await vi.waitFor(() => expect(shown()).toBe("Next page"));
    // Run-card acceptance: Back returns to the desk at its previous scroll position.
    const scroll = document.getElementById("reader-scroll")!;
    scroll.scrollTop = 0;
    alt("ArrowLeft");
    await vi.waitFor(() => expect(shown()).toContain("Guide"));
    expect(scroll.scrollTop).toBe(guideScroll);
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

  it("a failed readAsset leaves the image inert with alt text naming the source, and keeps an authored alt", async () => {
    boundary.readAsset.mockRejectedValue(new Error("not found"));
    boundary.open.mockResolvedValueOnce(batch("pic.md", "Pic ![](img/missing.png) ![](img/also.webp)", "c".repeat(32)));
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(document.querySelectorAll(".doc img[alt]").length).toBe(2));
    const images = [...document.querySelectorAll<HTMLImageElement>(".doc img")];
    expect(images.map(image => image.alt)).toEqual(["img/missing.png could not be loaded", "img/also.webp could not be loaded"]);
    expect(images.map(image => image.getAttribute("src"))).toEqual([null, null]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    // `alt ||=`: an author's own description is never overwritten by the failure text.
    boundary.open.mockResolvedValueOnce(batch("described.md", "Described ![](img/described.png)", "d".repeat(32)));
    boundary.render.mockImplementationOnce(async () => {
      const rendered = document.createElement("div");
      rendered.className = "doc";
      rendered.innerHTML = sanitizeRenderedHtml('<img src="img/described.png" alt="A hand-drawn map">').html;
      return { document: rendered, warnings: [] };
    });
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(boundary.readAsset).toHaveBeenCalledWith("d".repeat(32), "img/described.png"));
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>(".doc img")?.getAttribute("alt")).toBe("A hand-drawn map"));
    await Promise.resolve();
    expect(document.querySelector<HTMLImageElement>(".doc img")!.alt).toBe("A hand-drawn map");
  });

  it("an image that finishes loading after a newer render started is dropped, not shown or counted", async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    boundary.readAsset.mockReturnValueOnce(new Promise<ArrayBuffer>(resolve => { finish = resolve; }));
    boundary.open.mockResolvedValueOnce(batch("pic.md", "Pic ![](img/slow.png)", "c".repeat(32)));
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(boundary.readAsset).toHaveBeenCalledWith("c".repeat(32), "img/slow.png"));
    boundary.open.mockResolvedValueOnce(batch("other.md", "Other page", "e".repeat(32)));
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(shown()).toBe("Other page"));
    finish(new Uint8Array([137, 80, 78, 71]).buffer);
    await new Promise(resolve => setTimeout(resolve, 20));
    // The fence sits before the blob is made: no URL is created (and so none leaks), and the new document has no image.
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(shown()).toBe("Other page");
    expect(document.querySelector(".doc img")).toBeNull();
  });

  it("Back and Forward skip documents that were closed since the link was followed", async () => {
    boundary.open.mockResolvedValueOnce(batch("a.md", "Doc A [to b](b.md)", "a".repeat(32)));
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(shown()).toContain("Doc A"));
    boundary.openRelative.mockResolvedValueOnce(batch("b.md", "Doc B [to c](c.md)", "b".repeat(32)));
    document.querySelector<HTMLAnchorElement>('.doc a[href="b.md"]')!.click();
    await vi.waitFor(() => expect(shown()).toContain("Doc B"));
    boundary.openRelative.mockResolvedValueOnce(batch("c.md", "Doc C", "c".repeat(32)));
    document.querySelector<HTMLAnchorElement>('.doc a[href="c.md"]')!.click();
    await vi.waitFor(() => expect(shown()).toBe("Doc C"));
    // Close B from its tab while C stays active, then go Back: B is skipped, A is next.
    document.querySelector<HTMLButtonElement>('button[aria-label="Close b.md"]')!.click();
    await vi.waitFor(() => expect(tabTexts()).toEqual(["a.md", "c.md"]));
    alt("ArrowLeft");
    await vi.waitFor(() => expect(shown()).toContain("Doc A"));
    expect(activeTab()).toBe("a.md");
    // Forward from A: B is gone, so it lands on C and nothing is left beyond it.
    alt("ArrowRight");
    await vi.waitFor(() => expect(shown()).toBe("Doc C"));
    expect(activeTab()).toBe("c.md");
    alt("ArrowRight");
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(shown()).toBe("Doc C");
  });

  it("a relative link in a document with no file binding explains itself and asks the host nothing", async () => {
    boundary.open.mockResolvedValueOnce({
      documents: [{ name: "pasted.md", text: "Loose [next](next.md)", bytes: 21, token: null }], errors: [], canceled: false,
    } satisfies OpenBatch);
    document.getElementById("reader-open")!.click();
    await vi.waitFor(() => expect(shown()).toContain("Loose"));
    document.querySelector<HTMLAnchorElement>('.doc a[href="next.md"]')!.click();
    await vi.waitFor(() => expect(document.getElementById("reader-notice")!.textContent)
      .toBe("Local links open in the Windows app for documents opened from a file."));
    expect(boundary.openRelative).not.toHaveBeenCalled();
    expect(shown()).toContain("Loose");
    expect(tabTexts()).toEqual(["pasted.md"]);
  });

  it("the sanitizer keeps only relative image references, inert", () => {
    const out = sanitizeRenderedHtml('<img src="a/b.png"><img src="https://x.test/t.png"><img src="/abs.png"><img src="file:///C:/x.png">').html;
    const doc = new DOMParser().parseFromString(out, "text/html");
    const images = [...doc.querySelectorAll("img")];
    expect(images.map(image => image.getAttribute("src"))).toEqual([null, null, null, null]);
    expect(images.map(image => image.getAttribute("data-local-src"))).toEqual(["a/b.png", null, null, null]);
  });
});
