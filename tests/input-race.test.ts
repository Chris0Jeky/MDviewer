import { afterEach, describe, expect, it, vi } from "vitest";
import { installInputHandlers, SIZE_SOFT_BYTES } from "../src/app/input";
import { IDS } from "../src/app/dom";
import { DocStore } from "../src/app/state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function file(name: string, text: Promise<string>): File {
  const result = new File(["x"], name, { type: "text/markdown" });
  Object.defineProperty(result, "text", { value: vi.fn(() => text) });
  return result;
}

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); });

function fixture(onLargeFile = async () => true) {
  const store = new DocStore();
  const input = document.createElement("input");
  input.type = "file";
  input.id = IDS.fileInput;
  document.body.append(input);
  const onReject = vi.fn();
  const uninstall = installInputHandlers(store, { onReject, onLargeFile });
  cleanups.push(() => { uninstall(); input.remove(); });
  function ingest(path: string, files: File[]) {
    if (path === "picker") {
      Object.defineProperty(input, "files", { configurable: true, value: files });
      input.dispatchEvent(new Event("change"));
    } else {
      const event = new Event("drop", { cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files } });
      window.dispatchEvent(event);
    }
  }
  return { store, ingest, uninstall, onReject };
}

// Drain completed ingestion promises without waiting for a render debounce.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function paste(text: string) {
  const event = new Event("paste", { cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  window.dispatchEvent(event);
}

describe("async ingestion focus", () => {
  it.each(["drop", "picker"])("keeps newer edited document active when an earlier %s finishes", async (path) => {
    const t = fixture();
    const old = deferred<string>();
    const newer = deferred<string>();
    t.ingest(path, [file("old.md", old.promise)]);
    t.ingest(path === "drop" ? "picker" : "drop", [file("new.md", newer.promise)]);
    newer.resolve("New document");
    await settle();
    const activeId = t.store.activeId!;
    t.store.updateText(activeId, "New document edited");
    old.resolve("Old document");
    await settle();
    expect(t.store.openDocs.map((doc) => doc.name)).toEqual(["new.md", "old.md"]);
    expect(t.store.activeId).toBe(activeId);
    expect(t.store.active?.text).toBe("New document edited");
  });

  it.each(["drop", "picker"])("selects the first accepted file once for a %s batch", async (path) => {
    const t = fixture(async () => false);
    const declined = file("declined.md", Promise.resolve("Declined"));
    Object.defineProperty(declined, "size", { value: SIZE_SOFT_BYTES + 1 });
    const onChange = vi.fn();
    t.store.on("change", onChange);
    t.ingest(path, [new File(["x"], "image.png"), declined,
      file("first.md", Promise.resolve("First")), file("last.md", Promise.resolve("Last"))]);
    await settle();
    expect(t.store.openDocs.map((doc) => doc.name)).toEqual(["first.md", "last.md"]);
    expect(t.store.active?.name).toBe("first.md");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(declined.text).not.toHaveBeenCalled();
    expect(t.onReject).toHaveBeenCalledWith(["image.png"], [], []);
  });

  it.each(["switch", "switch back", "edit", "close"])("preserves user context after a %s during a slow read", async (action) => {
    const t = fixture();
    const a = t.store.add("a.md", "A");
    const b = t.store.add("b.md", "B");
    const slow = deferred<string>();
    t.ingest("picker", [file("slow.md", slow.promise)]);
    if (action.startsWith("switch")) {
      t.store.setActive(a.id);
      if (action === "switch back") t.store.setActive(b.id);
    } else if (action === "edit") t.store.updateText(b.id, "Edited B");
    else t.store.remove(b.id);
    const expected = { ...t.store.active! };
    slow.resolve("Slow");
    await settle();
    expect(t.store.active).toEqual(expected);
    expect(t.store.openDocs.at(-1)?.name).toBe("slow.md");
  });

  it("does not let an older passive completion cancel the newer pending selection", async () => {
    const t = fixture();
    const current = t.store.add("current.md", "Current");
    const old = deferred<string>();
    const newer = deferred<string>();
    t.ingest("drop", [file("old.md", old.promise)]);
    t.ingest("picker", [file("new.md", newer.promise)]);
    old.resolve("Old");
    await settle();
    expect(t.store.activeId).toBe(current.id);
    newer.resolve("New");
    await settle();
    expect(t.store.active?.name).toBe("new.md");
    expect(t.store.openDocs).toHaveLength(3);
  });

  it("a later declined confirmation still prevents an older read from taking focus", async () => {
    const confirmation = deferred<boolean>();
    const t = fixture(() => confirmation.promise);
    const current = t.store.add("current.md", "Current");
    const old = deferred<string>();
    const declined = file("declined.md", Promise.resolve("Declined"));
    Object.defineProperty(declined, "size", { value: SIZE_SOFT_BYTES + 1 });
    t.ingest("drop", [file("old.md", old.promise)]);
    t.ingest("picker", [declined]);
    confirmation.resolve(false);
    await settle();
    old.resolve("Old");
    await settle();
    expect(t.store.activeId).toBe(current.id);
    expect(t.store.openDocs.map((doc) => doc.name)).toEqual(["current.md", "old.md"]);
    expect(declined.text).not.toHaveBeenCalled();
    expect(t.onReject).not.toHaveBeenCalled();
  });

  it("drops late mutations and notices after teardown and stops reading the batch", async () => {
    const onLargeFile = vi.fn(async () => true);
    const t = fixture(onLargeFile);
    const slow = deferred<string>();
    const next = file("next.md", Promise.resolve("Next"));
    Object.defineProperty(next, "size", { value: SIZE_SOFT_BYTES + 1 });
    const onChange = vi.fn();
    t.store.on("change", onChange);
    t.ingest("drop", [file("slow.md", slow.promise), next, new File(["x"], "image.png")]);
    t.uninstall();
    slow.resolve("Slow");
    await settle();
    expect(t.store.openDocs).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    expect(t.onReject).not.toHaveBeenCalled();
    expect(onLargeFile).not.toHaveBeenCalled();
    expect(next.text).not.toHaveBeenCalled();
  });

  it("does not read a file when its confirmation resolves after teardown", async () => {
    const confirmation = deferred<boolean>();
    const t = fixture(() => confirmation.promise);
    const large = file("large.md", Promise.resolve("Large"));
    Object.defineProperty(large, "size", { value: SIZE_SOFT_BYTES + 1 });
    t.ingest("picker", [large]);
    t.uninstall();
    confirmation.resolve(true);
    await settle();
    expect(t.store.openDocs).toEqual([]);
    expect(large.text).not.toHaveBeenCalled();
  });

  it("a newer paste keeps focus when an older file finishes", async () => {
    const t = fixture();
    const slow = deferred<string>();
    t.ingest("drop", [file("slow.md", slow.promise)]);
    paste("Pasted text");
    await settle();
    const activeId = t.store.activeId;
    slow.resolve("Slow");
    await settle();
    expect(t.store.openDocs).toHaveLength(2);
    expect(t.store.activeId).toBe(activeId);
    expect(t.store.active?.text).toBe("Pasted text");
  });

  it.each(["newer file", "teardown"])("a slow paste confirmation respects %s", async (action) => {
    const confirmation = deferred<boolean>();
    const t = fixture(() => confirmation.promise);
    paste("x".repeat(SIZE_SOFT_BYTES + 1));
    if (action === "teardown") t.uninstall();
    else t.ingest("picker", [file("new.md", Promise.resolve("New"))]);
    await settle();
    confirmation.resolve(true);
    await settle();
    if (action === "teardown") expect(t.store.openDocs).toEqual([]);
    else {
      expect(t.store.openDocs).toHaveLength(2);
      expect(t.store.active?.name).toBe("new.md");
    }
  });
});
