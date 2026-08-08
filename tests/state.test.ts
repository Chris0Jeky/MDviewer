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
      const scheduler = createRenderScheduler(run);

      scheduler.schedule("content");
      scheduler.schedule("settings");
      scheduler.schedule("settings");
      await vi.advanceTimersByTimeAsync(300);

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith("content");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The pagination host and Paged.js's handler/page counter are global, so a render
   * that outlives its debounce window must not have the next one start underneath it.
   */
  it("never runs two renders concurrently", async () => {
    vi.useFakeTimers();
    try {
      let active = 0;
      let maxActive = 0;
      const release: Array<() => void> = [];
      const run = vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active -= 1;
      });
      const scheduler = createRenderScheduler(run);

      // First render starts and stays in flight (a slow pagination).
      scheduler.schedule("content");
      await vi.advanceTimersByTimeAsync(300);
      expect(run).toHaveBeenCalledTimes(1);
      expect(active).toBe(1);

      // The user keeps typing; a second render comes due while the first is running.
      scheduler.schedule("content");
      await vi.advanceTimersByTimeAsync(300);
      expect(run).toHaveBeenCalledTimes(1); // queued behind, not started

      release[0]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(run).toHaveBeenCalledTimes(2);

      release[1]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(maxActive).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a queued render that a newer one has already superseded", async () => {
    vi.useFakeTimers();
    try {
      const release: Array<() => void> = [];
      const run = vi.fn(async () => {
        await new Promise<void>((resolve) => release.push(resolve));
      });
      const scheduler = createRenderScheduler(run);

      scheduler.schedule("content");
      await vi.advanceTimersByTimeAsync(300);
      expect(run).toHaveBeenCalledTimes(1);

      // Two more renders come due while the first is still in flight. They paginate
      // the same latest text, so only the newest needs to run.
      scheduler.schedule("content");
      await vi.advanceTimersByTimeAsync(300);
      scheduler.schedule("content");
      await vi.advanceTimersByTimeAsync(300);

      release[0]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(run).toHaveBeenCalledTimes(2);

      release[1]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flush() runs a debounced render immediately and resolves after it settles", async () => {
    let settled = false;
    const run = vi.fn(async () => {
      await Promise.resolve();
      settled = true;
    });
    const scheduler = createRenderScheduler(run);

    scheduler.schedule("content");
    expect(scheduler.isPending).toBe(true);

    // No timer advance: flush must not wait out the 250ms debounce.
    await scheduler.flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("content");
    expect(settled).toBe(true);
    expect(scheduler.isPending).toBe(false);
  });

  it("flush() awaits an in-flight render even with nothing debounced", async () => {
    let release!: () => void;
    let finished = false;
    const run = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      finished = true;
    });
    const scheduler = createRenderScheduler(run);

    await scheduler.flush().then(() => {
      // nothing pending yet — resolves immediately
    });
    expect(run).not.toHaveBeenCalled();

    scheduler.schedule("content");
    const flushed = scheduler.flush();
    // Runs are chained, so the run starts a microtask after flush() is called.
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);

    // A second flush with no timer pending must still wait for the running render.
    const second = scheduler.flush();
    release();
    await Promise.all([flushed, second]);
    expect(finished).toBe(true);
  });

  it("keeps running later renders after one throws, and surfaces the rejection", async () => {
    const run = vi
      .fn<(reason: "content" | "settings") => Promise<void>>()
      .mockRejectedValueOnce(new Error("pagination exploded"))
      .mockResolvedValue(undefined);
    const scheduler = createRenderScheduler(run);

    scheduler.schedule("content");
    await expect(scheduler.flush()).rejects.toThrow("pagination exploded");

    // The chain is not poisoned: the next render still happens.
    scheduler.schedule("content");
    await scheduler.flush();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
