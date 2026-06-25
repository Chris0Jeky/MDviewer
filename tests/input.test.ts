import { describe, it, expect, vi } from "vitest";
import {
  MD_EXTENSIONS,
  SIZE_SOFT_BYTES,
  SIZE_HARD_BYTES,
  isMarkdownFile,
  classifyFiles,
  openMarkdown,
  installInputHandlers,
} from "../src/app/input";
import { DocStore } from "../src/app/state";

/** Build a File with a given name, type, and byte length. */
function fileOf(name: string, type: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("input: constants", () => {
  it("MD_EXTENSIONS contains .md and .markdown", () => {
    expect(MD_EXTENSIONS).toContain(".md");
    expect(MD_EXTENSIONS).toContain(".markdown");
  });

  it("size guards are ordered soft < hard and in the documented range", () => {
    expect(SIZE_SOFT_BYTES).toBeGreaterThan(0);
    expect(SIZE_HARD_BYTES).toBeGreaterThan(SIZE_SOFT_BYTES);
    expect(SIZE_SOFT_BYTES).toBeLessThanOrEqual(5_000_000);
    expect(SIZE_HARD_BYTES).toBeGreaterThanOrEqual(10_000_000);
  });
});

describe("input: isMarkdownFile", () => {
  it("accepts .md and .markdown by extension regardless of MIME", () => {
    expect(isMarkdownFile("notes.md", "")).toBe(true);
    expect(isMarkdownFile("paper.markdown", "application/octet-stream")).toBe(true);
    expect(isMarkdownFile("UPPER.MD", "")).toBe(true);
  });

  it("accepts a text/markdown MIME even with an odd name", () => {
    expect(isMarkdownFile("download", "text/markdown")).toBe(true);
  });

  it("rejects non-markdown extensions with non-markdown MIME", () => {
    expect(isMarkdownFile("photo.png", "image/png")).toBe(false);
    expect(isMarkdownFile("data.json", "application/json")).toBe(false);
    expect(isMarkdownFile("archive.md.zip", "application/zip")).toBe(false);
  });
});

describe("input: classifyFiles", () => {
  it("splits accepted markdown from rejected files", () => {
    const files = [
      fileOf("a.md", "text/markdown"),
      fileOf("b.markdown", ""),
      fileOf("c.png", "image/png"),
      fileOf("d.txt", "text/plain"),
    ];
    const { accept, reject } = classifyFiles(files);
    expect(accept.map((f) => f.name)).toEqual(["a.md", "b.markdown"]);
    expect(reject).toContain("c.png");
    expect(reject).toContain("d.txt");
  });

  it("returns empty arrays for an empty input", () => {
    const { accept, reject } = classifyFiles([]);
    expect(accept).toEqual([]);
    expect(reject).toEqual([]);
  });
});

describe("input: openMarkdown", () => {
  it("returns a Doc carrying the normalized text and a derived display name", async () => {
    const doc = await openMarkdown("# Hello", "hello.md");
    expect(doc.text).toBe("# Hello");
    expect(doc.name).toContain("hello");
    // The id is intentionally empty here — DocStore.add assigns the real id on insert.
    expect(typeof doc.id).toBe("string");
  });

  it("normalizes CRLF/CR line endings to LF", async () => {
    const doc = await openMarkdown("a\r\nb\rc", "x.md");
    expect(doc.text).toBe("a\nb\nc");
  });

  it("derives a basename from a path-like filename", async () => {
    const doc = await openMarkdown("text", "C:/some/dir/Paper.md");
    expect(doc.name).toBe("Paper.md");
  });
});

/**
 * jsdom (25) does not implement DataTransfer/ClipboardEvent.clipboardData, so we build
 * a minimal duck-typed transfer object and attach it to a plain Event. The handlers in
 * input.ts only read `.getData`, `.types`, `.items`, and `.files`.
 */
function fakeClipboardEvent(text: string): Event {
  const evt = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  return evt;
}

function fakeFileDrop(files: File[]): Event {
  const evt = new Event("drop", { bubbles: true, cancelable: true });
  const items = files.map((f) => ({ kind: "file" as const, getAsFile: () => f }));
  Object.defineProperty(evt, "dataTransfer", {
    value: {
      types: ["Files"],
      files,
      items,
      dropEffect: "none",
    },
  });
  return evt;
}

describe("input: installInputHandlers", () => {
  it("returns an uninstall function and wires handlers without throwing", () => {
    const store = new DocStore();
    const uninstall = installInputHandlers(store, {
      onReject: vi.fn(),
      onLargeFile: vi.fn(async () => true),
    });
    expect(typeof uninstall).toBe("function");
    expect(() => uninstall()).not.toThrow();
  });

  it("routes pasted markdown text into the store as a new active doc", async () => {
    const store = new DocStore();
    const onReject = vi.fn();
    const uninstall = installInputHandlers(store, {
      onReject,
      onLargeFile: async () => true,
    });

    window.dispatchEvent(fakeClipboardEvent("# Pasted Title\n\nbody"));
    await new Promise((r) => setTimeout(r, 0)); // let the async open settle

    expect(store.openDocs.length).toBeGreaterThanOrEqual(1);
    expect(store.active?.text ?? "").toContain("Pasted Title");
    expect(onReject).not.toHaveBeenCalled();
    uninstall();
  });

  it("ignores an empty/whitespace-only paste", async () => {
    const store = new DocStore();
    const uninstall = installInputHandlers(store, {
      onReject: vi.fn(),
      onLargeFile: async () => true,
    });
    window.dispatchEvent(fakeClipboardEvent("   \n\t  "));
    await new Promise((r) => setTimeout(r, 0));
    expect(store.openDocs.length).toBe(0);
    uninstall();
  });

  it("invokes onReject when a dropped file is not markdown", async () => {
    const store = new DocStore();
    const onReject = vi.fn();
    const uninstall = installInputHandlers(store, {
      onReject,
      onLargeFile: async () => true,
    });

    window.dispatchEvent(fakeFileDrop([fileOf("image.png", "image/png")]));
    await new Promise((r) => setTimeout(r, 0));

    expect(onReject).toHaveBeenCalled();
    expect(store.openDocs.length).toBe(0);
    uninstall();
  });

  it("opens a dropped markdown file into the store", async () => {
    const store = new DocStore();
    const onReject = vi.fn();
    const uninstall = installInputHandlers(store, {
      onReject,
      onLargeFile: async () => true,
    });

    const md = new File(["# Dropped\n\nhi"], "dropped.md", { type: "text/markdown" });
    // jsdom does not implement Blob.text(); stub it so the read path is deterministic.
    Object.defineProperty(md, "text", { value: async () => "# Dropped\n\nhi" });
    window.dispatchEvent(fakeFileDrop([md]));
    // The read path is async (classify -> file.text -> openMarkdown -> store.add);
    // give it a couple of macrotask ticks to fully settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(store.openDocs.length).toBe(1);
    expect(store.active?.name).toBe("dropped.md");
    expect(store.active?.text ?? "").toContain("Dropped");
    expect(onReject).not.toHaveBeenCalled();
    uninstall();
  });
});
