import { describe, it, expect, vi } from "vitest";
import { parseActionable, type Control } from "../src/render/actionable";
import { createWriteback, type Notice, type WritebackDeps } from "../src/desktop/reader/writeback";
import type { PatchResult } from "../src/desktop/native";
import type { ReaderDocument } from "../src/desktop/session";

function setup(text: string, options: { available?: boolean; bound?: boolean; dirty?: boolean; results?: PatchResult[] } = {}) {
  const doc: ReaderDocument = { id: "d1", key: "k1", name: "card.md", text, dirty: options.dirty ?? false,
    ...(options.bound === false ? {} : { binding: { token: "t".repeat(32), path: "C:/card.md", dir: "C:/", encoding: "utf-8", eol: "lf", disk: "synced", generation: 0 } }) } as ReaderDocument;
  const results = [...(options.results ?? [])];
  const notices: Array<Notice | null> = [];
  const deps: WritebackDeps = {
    active: () => doc,
    native: { available: options.available ?? true, patchDocument: vi.fn(async () => results.shift()!) },
    adopt: vi.fn((target, next, generation) => { target.text = next; target.binding!.generation = generation; target.dirty = false; return true; }),
    setText: vi.fn((target, next) => { target.text = next; target.dirty = true; }),
    rerender: vi.fn(),
    notice: notice => { notices.push(notice); },
    report: vi.fn(),
  };
  return { doc, deps, notices, writeback: createWriteback(deps) };
}
const control = (text: string, line: number): Control => parseActionable(text).controls.find(item => item.line === line)!;

describe("actionable write-back", () => {
  it("applies in memory when there is no host, an unbound file or unsaved edits", async () => {
    for (const options of [{ available: false }, { bound: false }, { dirty: true }]) {
      const text = "- [ ] Task\n";
      const { doc, deps, writeback } = setup(text, options);
      await writeback.change(control(text, 1), { kind: "mark", to: "x" });
      expect(doc.text).toBe("- [x] Task\n");
      expect(deps.native.patchDocument).not.toHaveBeenCalled();
      expect(deps.setText).toHaveBeenCalledOnce();
    }
  });

  it("saves a clean bound document at once, adopts the host's generation and offers Undo", async () => {
    const text = "- [ ] Task <!-- id: t -->\n";
    const after = "- [x] Task <!-- id: t -->\n";
    const { doc, deps, notices, writeback } = setup(text, { results: [
      { outcome: "saved", generation: 3, text: after }, { outcome: "saved", generation: 4, text },
    ] });
    await writeback.change(control(text, 1), { kind: "mark", to: "x" });
    expect(deps.native.patchDocument).toHaveBeenCalledWith("t".repeat(32), [{ line: 1, id: "t", expect: "- [ ] Task <!-- id: t -->", replace: "- [x] Task <!-- id: t -->" }]);
    expect(doc.text).toBe(after);
    expect(doc.binding!.generation).toBe(3);
    expect(notices.at(-1)).toMatchObject({ text: "Marked done", action: { label: "Undo" } });
    notices.at(-1)!.action!.run();
    await vi.waitFor(() => expect(doc.binding!.generation).toBe(4));
    expect(deps.native.patchDocument).toHaveBeenLastCalledWith("t".repeat(32), [{ line: 1, id: "t", expect: "- [x] Task <!-- id: t -->", replace: "- [ ] Task <!-- id: t -->" }]);
    expect(doc.text).toBe(text);
  });

  it("re-derives once by id when another program edited the label: the new label survives", async () => {
    const text = "- [ ] Draft <!-- id: d -->\n";
    const outside = "Intro\n\n- [ ] Draft the notes <!-- id: d -->\n";
    const { deps, writeback } = setup(text, { results: [
      { outcome: "unplaced", index: 0, text: outside },
      { outcome: "saved", generation: 2, text: "Intro\n\n- [x] Draft the notes <!-- id: d -->\n" },
    ] });
    await writeback.change(control(text, 1), { kind: "mark", to: "x" });
    expect(deps.native.patchDocument).toHaveBeenLastCalledWith("t".repeat(32),
      [{ line: 3, id: "d", expect: "- [ ] Draft the notes <!-- id: d -->", replace: "- [x] Draft the notes <!-- id: d -->" }]);
    expect(deps.report).not.toHaveBeenCalled();
  });

  it("refuses when the span itself changed outside, and writes nothing", async () => {
    const text = "- [ ] Draft <!-- id: d -->\n";
    const { deps, writeback } = setup(text, { results: [{ outcome: "unplaced", index: 0, text: "- [/] Draft <!-- id: d -->\n" }] });
    await writeback.change(control(text, 1), { kind: "mark", to: "x" });
    expect(deps.native.patchDocument).toHaveBeenCalledOnce();
    expect(deps.report).toHaveBeenCalledWith(expect.stringMatching(/Could not save “Draft”: it changed in another program\. Nothing was written\./));
  });

  it("says when another program overwrote a saved change, and applies it again on request", async () => {
    const text = "- [ ] Task <!-- id: t -->\n";
    const { doc, notices, deps, writeback } = setup(text, { results: [
      { outcome: "saved", generation: 1, text: "- [x] Task <!-- id: t -->\n" },
      { outcome: "saved", generation: 3, text: "- [x] Task <!-- id: t -->\n" },
    ] });
    await writeback.change(control(text, 1), { kind: "mark", to: "x" });
    doc.text = text; // a generator rewrote the old value; live reload adopted it
    writeback.checkOverwritten(doc);
    expect(notices.at(-1)).toMatchObject({ text: "Another program overwrote this change.", action: { label: "Apply again" } });
    notices.at(-1)!.action!.run();
    await vi.waitFor(() => expect(doc.binding!.generation).toBe(3));
    expect(deps.native.patchDocument).toHaveBeenCalledTimes(2);
  });

  it("reports nothing after the notice was dismissed", async () => {
    const text = "- [ ] Task\n";
    const { doc, notices, writeback } = setup(text, { results: [{ outcome: "saved", generation: 1, text: "- [x] Task\n" }] });
    await writeback.change(control(text, 1), { kind: "mark", to: "x" });
    writeback.forget();
    doc.text = text;
    const count = notices.length;
    writeback.checkOverwritten(doc);
    expect(notices).toHaveLength(count);
  });
});
