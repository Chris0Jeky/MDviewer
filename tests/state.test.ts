import { describe, it, expect, vi } from "vitest";
import { DocStore, createRenderScheduler } from "../src/app/state";

describe("DocStore: open, switch, close", () => {
  it("add() makes the new document active and emits change", () => {
    const store = new DocStore();
    const onChange = vi.fn();
    store.on("change", onChange);

    const doc = store.add("a.md", "# A");
    expect(store.active).toEqual(doc);
    expect(store.openDocs).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("setActive() switches only to a known id", () => {
    const store = new DocStore();
    const a = store.add("a.md", "# A");
    const b = store.add("b.md", "# B");
    expect(store.active?.id).toBe(b.id);

    store.setActive(a.id);
    expect(store.active?.id).toBe(a.id);

    store.setActive("nope");
    expect(store.active?.id).toBe(a.id);
  });

  it("remove() falls back to a neighbouring document", () => {
    const store = new DocStore();
    const a = store.add("a.md", "# A");
    const b = store.add("b.md", "# B");
    store.remove(b.id);
    expect(store.active?.id).toBe(a.id);
    store.remove(a.id);
    expect(store.active).toBeNull();
  });
});

describe("DocStore: updateText — the editor write path", () => {
  it("replaces the text in place and emits 'text', never 'change'", () => {
    const store = new DocStore();
    const doc = store.add("a.md", "# A");
    const onChange = vi.fn();
    const onText = vi.fn();
    store.on("change", onChange);
    store.on("text", onText);

    expect(store.updateText(doc.id, "# A edited")).toBe(true);
    expect(store.active?.text).toBe("# A edited");
    expect(onText).toHaveBeenCalledTimes(1);
    // Identity UI (document switcher, editor seeding) must not churn per keystroke.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is a no-op for an unknown id or unchanged text", () => {
    const store = new DocStore();
    const doc = store.add("a.md", "# A");
    const onText = vi.fn();
    store.on("text", onText);

    expect(store.updateText("missing", "x")).toBe(false);
    expect(store.updateText(doc.id, "# A")).toBe(false);
    expect(onText).not.toHaveBeenCalled();
  });

  it("edits a background document without changing which one is active", () => {
    const store = new DocStore();
    const a = store.add("a.md", "# A");
    const b = store.add("b.md", "# B");
    store.updateText(a.id, "# A edited");
    expect(store.active?.id).toBe(b.id);
    expect(store.openDocs.find((d) => d.id === a.id)?.text).toBe("# A edited");
  });

  it("unsubscribing removes only that listener from its own event", () => {
    const store = new DocStore();
    const doc = store.add("a.md", "# A");
    const onText = vi.fn();
    const off = store.on("text", onText);
    off();
    store.updateText(doc.id, "changed");
    expect(onText).not.toHaveBeenCalled();
  });
});

describe("createRenderScheduler", () => {
  it("coalesces rapid calls and never downgrades a queued content render", async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(async () => {});
      const schedule = createRenderScheduler(run);

      schedule("content");
      schedule("settings");
      schedule("settings");
      await vi.advanceTimersByTimeAsync(300);

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith("content");
    } finally {
      vi.useRealTimers();
    }
  });
});
