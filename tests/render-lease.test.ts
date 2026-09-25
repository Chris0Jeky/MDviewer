import { describe, expect, it } from "vitest";
import { createRenderScheduler } from "../src/app/state";

function gate(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("render-host ownership during export (#62)", () => {
  it("flushes pending content, then defers teardown until export finishes", async () => {
    const events: string[] = [];
    const exporting = gate();
    const started = gate();
    const scheduler = createRenderScheduler(async (reason) => { events.push(reason); });
    scheduler.schedule("content");
    const result = scheduler.withRenderLock(async () => {
      events.push("export-start");
      started.release();
      await exporting.promise;
      events.push("export-end");
      return "saved";
    });
    await started.promise;
    scheduler.schedule("content");
    const afterClose = scheduler.flush();
    await Promise.resolve();
    expect(events).toEqual(["content", "export-start"]);
    exporting.release();
    expect(await result).toBe("saved");
    await afterClose;
    expect(events).toEqual(["content", "export-start", "export-end", "content"]);
  });

  it("does not let a later render cancel the one queued before the export fence", async () => {
    const slow = gate();
    const entered = gate();
    const events: string[] = [];
    const scheduler = createRenderScheduler(async (reason) => {
      events.push(reason);
      if (events.length === 1) { entered.release(); await slow.promise; }
    });
    scheduler.schedule("settings");
    const first = scheduler.flush();
    await entered.promise;
    scheduler.schedule("content");
    const exporting = scheduler.withRenderLock(async () => { events.push("export"); });
    scheduler.schedule("settings");
    const later = scheduler.flush();
    slow.release();
    await Promise.all([first, exporting, later]);
    expect(events).toEqual(["settings", "content", "export", "settings"]);
  });

  it("releases ownership after a failed export", async () => {
    let runs = 0;
    const scheduler = createRenderScheduler(async () => { runs++; });
    await expect(scheduler.withRenderLock(async () => { throw new Error("capture failed"); }))
      .rejects.toThrow("capture failed");
    scheduler.schedule("content");
    await scheduler.flush();
    expect(runs).toBe(1);
  });

  it("does not export when its pending preparation rejects, and recovers afterward", async () => {
    let fail = true;
    let exports = 0;
    const scheduler = createRenderScheduler(async () => { if (fail) throw new Error("render failed"); });
    scheduler.schedule("content");
    await expect(scheduler.withRenderLock(async () => { exports++; })).rejects.toThrow("render failed");
    expect(exports).toBe(0);
    fail = false;
    scheduler.schedule("content");
    await scheduler.withRenderLock(async () => { exports++; });
    expect(exports).toBe(1);
  });
});
