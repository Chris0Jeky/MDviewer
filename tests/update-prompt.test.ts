import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUpdatePrompt } from "../src/ui/UpdatePrompt";

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((f) => f()); document.body.replaceChildren(); vi.useRealTimers(); });

function setup(requestReload = vi.fn(() => false), applyUpdate = vi.fn(async () => {})) {
  const activation = new EventTarget();
  const prompt = mountUpdatePrompt({ requestReload, applyUpdate, activationTarget: activation });
  cleanups.push(() => prompt.destroy());
  const reload = document.querySelector<HTMLButtonElement>(".pwa-toast__action--primary")!;
  const dismiss = document.querySelector<HTMLButtonElement>(".pwa-toast__action:not(.pwa-toast__action--primary)")!;
  return { prompt, reload, dismiss, activation, requestReload, applyUpdate };
}

describe("recoverable update prompt (#58)", () => {
  it("allows retry after cancellation without awaiting a second controllerchange", async () => {
    const t = setup();
    t.reload.click();
    await Promise.resolve();
    t.activation.dispatchEvent(new Event("controllerchange"));
    expect(t.requestReload).toHaveBeenCalledOnce();
    expect(t.reload.disabled).toBe(false);
    expect(t.dismiss.disabled).toBe(false);
    t.reload.click();
    expect(t.requestReload).toHaveBeenCalledTimes(2);
    expect(t.applyUpdate).toHaveBeenCalledOnce();
  });

  it("deduplicates the plugin callback and native controllerchange", async () => {
    const t = setup(vi.fn(() => true));
    t.reload.click();
    await Promise.resolve();
    t.prompt.notifyReady();
    t.activation.dispatchEvent(new Event("controllerchange"));
    expect(t.requestReload).toHaveBeenCalledOnce();
  });

  it("does not reload after dismissal or an expired activation attempt", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.reload.click();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.reload.disabled).toBe(false);
    t.prompt.notifyReady();
    expect(t.requestReload).not.toHaveBeenCalled();
    t.dismiss.click();
    t.activation.dispatchEvent(new Event("controllerchange"));
    t.prompt.notifyReady();
    expect(t.requestReload).not.toHaveBeenCalled();
    expect(document.querySelector(".pwa-toast")).toBeNull();
  });

  it("recovers from update rejection and synchronous reload failure", async () => {
    vi.useFakeTimers();
    const t = setup(vi.fn(() => { throw new Error("blocked"); }), vi.fn(async () => { throw new Error("offline"); }));
    t.reload.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.reload.disabled).toBe(false);
    expect(document.querySelector(".pwa-toast__message")?.textContent).toMatch(/could not update/i);
    t.prompt.notifyReady();
    t.reload.click();
    expect(t.reload.disabled).toBe(false);
    expect(document.querySelector(".pwa-toast__message")?.textContent).toMatch(/could not reload/i);
  });

  it("requires a fresh user action for an update activated in another tab", () => {
    const t = setup();
    t.prompt.notifyReady();
    expect(t.requestReload).not.toHaveBeenCalled();
    t.reload.click();
    expect(t.requestReload).toHaveBeenCalledOnce();
    expect(t.applyUpdate).not.toHaveBeenCalled();
  });
});
