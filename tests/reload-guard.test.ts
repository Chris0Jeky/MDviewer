import { describe, expect, it, vi } from "vitest";
import { installReloadGuard } from "../src/app/reloadGuard";

function beforeUnload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("update reload consent (#58)", () => {
  it("keeps normal navigation protected when explicit reload is cancelled", () => {
    const reload = vi.fn();
    const guard = installReloadGuard(() => true, { confirm: () => false, reload });
    try {
      expect(guard.tryReload()).toBe(false);
      expect(reload).not.toHaveBeenCalled();
      expect(beforeUnload().defaultPrevented).toBe(true);
    } finally { guard.destroy(); }
  });

  it("bypasses exactly the accepted reload, not later navigation", () => {
    const confirm = vi.fn(() => true);
    const guard = installReloadGuard(() => true, {
      confirm,
      reload: () => { expect(beforeUnload().defaultPrevented).toBe(false); },
    });
    try {
      expect(guard.tryReload()).toBe(true);
      expect(confirm).toHaveBeenCalledOnce();
      expect(beforeUnload().defaultPrevented).toBe(true);
    } finally { guard.destroy(); }
  });

  it("rechecks current work at reload time and does not nag for the pristine sample", () => {
    let hasWork = false;
    const confirm = vi.fn(() => false);
    const guard = installReloadGuard(() => hasWork, { confirm, reload: () => { beforeUnload(); } });
    try {
      expect(guard.tryReload()).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
      hasWork = true;
      expect(guard.tryReload()).toBe(false);
      expect(confirm).toHaveBeenCalledOnce();
    } finally { guard.destroy(); }
  });

  it("restores protection if navigation throws or never dispatches", () => {
    vi.useFakeTimers();
    const reload = vi.fn<() => void>(() => { throw new Error("blocked"); });
    const guard = installReloadGuard(() => true, { confirm: () => true, reload });
    try {
      expect(() => guard.tryReload()).toThrow("blocked");
      expect(beforeUnload().defaultPrevented).toBe(true);
      reload.mockImplementation(() => undefined);
      guard.tryReload();
      vi.advanceTimersByTime(1100);
      expect(beforeUnload().defaultPrevented).toBe(true);
    } finally { guard.destroy(); vi.useRealTimers(); }
  });
});
