/** Navigation protection and the single explicitly accepted service-worker reload. */
export interface ReloadGuard {
  tryReload(): boolean;
  destroy(): void;
}

interface ReloadActions {
  confirm(message: string): boolean;
  reload(): void;
}

export function installReloadGuard(
  hasWork: () => boolean,
  actions: ReloadActions = {
    confirm: (message) => window.confirm(message),
    reload: () => window.location.reload(),
  },
): ReloadGuard {
  let acceptedReload = false;
  let disposed = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  function reset(): void {
    acceptedReload = false;
    if (expiry !== undefined) clearTimeout(expiry);
    expiry = undefined;
  }
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (acceptedReload) { reset(); return; }
    if (!hasWork()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return {
    tryReload(): boolean {
      if (disposed) return false;
      // Check now, not when the worker was asked to activate: editing may continue
      // during that wait. No Markdown is ever persisted by this guard.
      if (hasWork() && !actions.confirm(
        "Reload MDviewer and discard all open documents? Your Markdown is only in memory. " +
        "Cancel to download your Markdown before reloading.",
      )) return false;
      reset();
      acceptedReload = true;
      // Usually consumed by beforeunload immediately. Bound the bypass if a host
      // blocks navigation without dispatching that event.
      expiry = setTimeout(reset, 1000);
      try { actions.reload(); } catch (error) { reset(); throw error; }
      return true;
    },
    destroy(): void {
      disposed = true;
      reset();
      window.removeEventListener("beforeunload", onBeforeUnload);
    },
  };
}
