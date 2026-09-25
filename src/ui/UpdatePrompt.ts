/** Recoverable update handoff. Worker activation and document reload are distinct steps. */
export interface UpdatePromptController {
  notifyReady(): void;
  destroy(): void;
}

export interface UpdatePromptOptions {
  applyUpdate(): void | Promise<void>;
  /** Owns the explicit data-loss confirmation and returns false when reload is postponed. */
  requestReload(): boolean;
  /** Native fallback also covers the first registration's update in the same session. */
  activationTarget?: EventTarget;
  onDismiss?(): void;
}

export function mountUpdatePrompt(options: UpdatePromptOptions): UpdatePromptController {
  const toast = document.createElement("div");
  toast.className = "pwa-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  const message = document.createElement("p");
  message.className = "pwa-toast__message";
  message.textContent = "A new version of MDviewer is available.";
  const actions = document.createElement("div");
  actions.className = "pwa-toast__actions";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "pwa-toast__action";
  dismiss.textContent = "Dismiss";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "pwa-toast__action pwa-toast__action--primary";
  reload.textContent = "Reload";
  actions.append(dismiss, reload);
  toast.append(message, actions);
  document.body.append(toast);

  let ready = false;
  let requested = false;
  let disposed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function recover(text: string): void {
    clearTimer();
    requested = false;
    reload.disabled = false;
    message.textContent = text;
  }
  function requestReload(): void {
    if (disposed) return;
    try {
      if (!options.requestReload()) {
        recover("Reload postponed. Your documents are still open.");
        return;
      }
      reload.disabled = true;
      message.textContent = "Reloading MDviewer…";
      clearTimer();
      timer = setTimeout(() => recover("Reload did not complete. Save your Markdown and try again."), 5000);
    } catch {
      recover("Could not reload. Your documents are still open; you can try again.");
    }
  }
  function notifyReady(): void {
    if (disposed || ready) return;
    ready = true;
    attempt++;
    clearTimer();
    reload.disabled = false;
    message.textContent = "Update ready. Reload when you are ready.";
    const shouldReload = requested;
    requested = false;
    if (shouldReload) requestReload();
  }
  const onReload = (): void => {
    if (disposed || reload.disabled) return;
    if (ready) { requestReload(); return; }
    requested = true;
    reload.disabled = true;
    message.textContent = "Updating MDviewer…";
    const current = ++attempt;
    clearTimer();
    timer = setTimeout(() => {
      attempt++;
      recover("The update is taking longer than expected. You can try again.");
    }, 15_000);
    Promise.resolve().then(() => {
      if (!disposed && current === attempt) return options.applyUpdate();
      return undefined;
    }).catch(() => {
      if (!disposed && current === attempt) {
        recover("Could not update. Your documents are still open; you can try again.");
      }
    });
  };
  function destroy(): void {
    disposed = true;
    requested = false;
    attempt++;
    clearTimer();
    options.activationTarget?.removeEventListener("controllerchange", notifyReady);
    reload.removeEventListener("click", onReload);
    dismiss.removeEventListener("click", onDismiss);
    toast.remove();
  }
  function onDismiss(): void { destroy(); options.onDismiss?.(); }
  reload.addEventListener("click", onReload);
  dismiss.addEventListener("click", onDismiss);
  options.activationTarget?.addEventListener("controllerchange", notifyReady);
  return { notifyReady, destroy };
}
