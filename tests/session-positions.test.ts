import { describe, expect, it, vi } from "vitest";
import { clampEditorPosition, SessionPositions, type EditorPosition } from "../src/app/positions";
import { DocStore } from "../src/app/state";
import { ReaderSession } from "../src/desktop/session";

const editor: EditorPosition = { start: 3, end: 8, direction: "backward", scrollTop: 240, scrollLeft: 10 };

describe("bounded session positions", () => {
  it("uses identity, copies coordinates, and evicts the least recently visited entry", () => {
    const positions = new SessionPositions(2);
    positions.set("a", { editor });
    positions.set("b", { reader: { scrollTop: 100, scrollLeft: 0 } });
    const copy = positions.get("a")!;
    copy.editor!.start = 999;
    positions.set("c", { preview: { page: 3, offset: 0.5 } });
    expect(positions.size).toBe(2);
    expect(positions.get("b")).toBeUndefined();
    expect(positions.get("a")!.editor).toEqual(editor);
    positions.set("a", { reader: { scrollTop: 50, scrollLeft: 0 } });
    expect(positions.get("a")).toEqual({ editor, reader: { scrollTop: 50, scrollLeft: 0 } });
    expect(positions.take("a")!.editor).toEqual(editor);
    expect(positions.get("a")).toBeUndefined();
    positions.clear(); expect(positions.size).toBe(0);
  });

  it("clamps UTF-16 ranges after a document shrinks, without changing source", () => {
    const source = "λ😀";
    expect(clampEditorPosition(editor, source.length)).toEqual({ ...editor, start: 3, end: 3 });
    expect(clampEditorPosition({ ...editor, start: -1, end: Infinity, scrollTop: NaN, scrollLeft: -3 }, 20))
      .toEqual({ ...editor, start: 0, end: 0, scrollTop: 0, scrollLeft: 0 });
  });

  it("captures before mutations, separates equal-content same-name docs, and drops closed IDs", () => {
    const store = new DocStore();
    const first = store.add("same.md", "same λ😀");
    const before = vi.fn(() => {
      if (store.activeId) store.positions.set(store.activeId, { editor });
    });
    store.on("beforechange", before);
    const second = store.add("same.md", first.text);
    expect(store.positions.get(first.id)?.editor).toEqual(editor);
    expect(store.positions.get(second.id)).toBeUndefined();
    const change = vi.fn(); store.on("change", change);
    store.setActive(second.id);
    expect(change).not.toHaveBeenCalled();
    const position = store.remove(second.id);
    expect(position?.editor).toEqual(editor);
    expect(store.positions.get(second.id)).toBeUndefined();
    const restored = store.add(second.name, second.text, position);
    expect(restored.id).not.toBe(second.id);
    expect(store.positions.get(restored.id)?.editor).toEqual(editor);
  });

  it("never grows the position cache beyond its cap across large open sets", () => {
    const store = new DocStore();
    for (let index = 0; index < 100; index++) {
      const doc = store.add("same.md", "same");
      store.positions.set(doc.id, { editor });
    }
    expect(store.positions.size).toBe(64);
    for (const doc of [...store.openDocs]) store.remove(doc.id);
    expect(store.positions.size).toBe(0);
  });

  it("reader close removes only that identity's position", () => {
    const reader = new ReaderSession();
    reader.append([{ name: "same.md", text: "one" }, { name: "same.md", text: "two" }]);
    for (const doc of reader.documents) reader.positions.set(doc.id, { editor });
    reader.close(reader.documents[0]!.id);
    expect(reader.positions.size).toBe(1);
    expect(reader.positions.get(reader.documents[0]!.id)?.editor).toEqual(editor);
  });
});
