import { afterEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../src/app/state";
import { mountDocumentRecovery } from "../src/ui/DocumentRecovery";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach((stop) => stop()); document.body.replaceChildren(); });
function setup() {
  const root = document.createElement("div"); document.body.append(root);
  const store = new DocStore(); const focus = vi.fn();
  const controller = mountDocumentRecovery(root, store, focus); cleanup.push(() => controller.destroy());
  const undo = root.querySelector<HTMLButtonElement>("button")!;
  const discard = root.querySelector<HTMLButtonElement>("[aria-label='Discard closed document']")!;
  const row = root.querySelector<HTMLElement>(".document-recovery")!;
  return { root, store, focus, controller, undo, discard, row };
}

describe("one-close recovery", () => {
  it("snapshots current exact source and restores once with a fresh identity", () => {
    const t = setup();
    const doc = t.store.add("café.md", "original");
    const edited = "# Edited λ\n\nExact whitespace.  \n";
    t.store.updateText(doc.id, edited);
    t.controller.closeActive();
    expect(t.store.openDocs).toHaveLength(0);
    expect(t.undo).toBe(document.activeElement);
    expect(t.row.hidden).toBe(false);
    doc.text = "stale external reference";
    t.undo.click(); t.undo.click();
    expect(t.store.openDocs).toHaveLength(1);
    expect(t.store.active).toMatchObject({ name: "café.md", text: edited });
    expect(t.store.active!.id).not.toBe(doc.id);
    expect(t.row.hidden).toBe(true);
    expect(t.focus).toHaveBeenCalledTimes(1);
    expect(t.row.querySelector("strong")?.textContent ?? "").toBe("");
  });

  it("does not overwrite edits made to a remaining document", () => {
    const t = setup();
    const first = t.store.add("same.md", "first");
    t.store.add("same.md", "second");
    t.controller.closeActive();
    t.store.updateText(first.id, "first, edited later");
    t.undo.click();
    expect(t.store.openDocs.map((doc) => doc.text)).toEqual(["first, edited later", "second"]);
    expect(t.store.active!.text).toBe("second");
  });

  it("only retains the latest real close; no-active close does not clear it", () => {
    const t = setup();
    t.store.add("first.md", "first"); t.controller.closeActive();
    t.store.add("second.md", "second"); t.controller.closeActive();
    t.controller.closeActive(); t.undo.click();
    expect(t.store.openDocs.map((doc) => doc.name)).toEqual(["second.md"]);
  });

  it("explicit discard clears the snapshot and filename without changing open docs", () => {
    const t = setup();
    t.store.add("discard.md", "discard me"); t.controller.closeActive();
    const name = t.root.querySelector<HTMLElement>(".document-recovery-name")!;
    t.store.add("keep.md", "keep me");
    t.discard.click(); t.undo.click();
    expect(t.store.openDocs.map((doc) => doc.name)).toEqual(["keep.md"]);
    expect(t.row.hidden).toBe(true);
    expect(name.textContent).toBe(""); expect(name.hasAttribute("title")).toBe(false);
    expect(t.focus).toHaveBeenCalledTimes(1);
  });

  it("renders hostile-looking names as text, not markup", () => {
    const t = setup(); const name = '<img src=x onerror=alert(1)>.md';
    t.store.add(name, "draft"); t.controller.closeActive();
    expect(t.root.querySelector("img")).toBeNull();
    expect(t.root.querySelector("strong")!.textContent).toBe(name);
    expect(t.root.querySelector("strong")!.title).toBe(name);
  });

  it("teardown clears recovery and leaves held control references inert", () => {
    const t = setup();
    t.store.add("closed.md", "draft"); t.controller.closeActive();
    const name = t.root.querySelector<HTMLElement>("strong")!;
    t.controller.destroy(); t.controller.destroy();
    const live = t.store.add("live.md", "keep");
    t.controller.closeActive(); t.undo.click(); t.discard.click();
    expect(t.store.openDocs).toEqual([live]); expect(t.root.children).toHaveLength(0);
    expect(name.textContent).toBe(""); expect(name.hasAttribute("title")).toBe(false);
    expect(t.focus).not.toHaveBeenCalled();
  });

  it("ignores actions from a detached toolbar", () => {
    const t = setup();
    t.store.add("recover.md", "draft"); t.controller.closeActive();
    t.root.remove(); t.undo.click(); t.discard.click();
    expect(t.store.openDocs).toHaveLength(0); expect(t.focus).not.toHaveBeenCalled();
    document.body.append(t.root); t.undo.click();
    expect(t.store.active!.name).toBe("recover.md");
  });
});
