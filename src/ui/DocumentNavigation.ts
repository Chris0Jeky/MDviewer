/** Disambiguate equal names without exposing paths or using names as identity. */
export function documentLabels(docs: readonly { id: string; name: string }[]): Map<string, string> {
  const counts = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const doc of docs) counts.set(doc.name, (counts.get(doc.name) ?? 0) + 1);
  return new Map(docs.map(doc => {
    const ordinal = (seen.get(doc.name) ?? 0) + 1;
    seen.set(doc.name, ordinal);
    const count = counts.get(doc.name)!;
    return [doc.id, count > 1 ? `${doc.name} (${ordinal} of ${count})` : doc.name];
  }));
}

/** Reuse the native document picker as the only selection/activation path. */
export function mountDocumentNavigation(
  root: HTMLElement,
  select: HTMLSelectElement,
  previous: HTMLButtonElement,
  next: HTMLButtonElement,
  hintRoot: HTMLElement,
): { sync(): void; destroy(): void } {
  const target = root.ownerDocument.defaultView;
  // Option-generated characters are ordinary typing on Apple platforms. Leave
  // these custom chords unbound there; the picker and buttons remain tabbable.
  const shortcuts = !/Mac|iPhone|iPad|iPod/i.test(target?.navigator.platform ?? "");
  const hint = shortcuts ? root.ownerDocument.createElement("span") : null;
  if (hint) {
    hint.className = "workspace-navigation-shortcuts";
    hint.textContent = "Alt+Shift+P/N/D: previous/next/choose document";
    hintRoot.append(hint);
    select.setAttribute("aria-keyshortcuts", "Alt+Shift+D");
    previous.setAttribute("aria-keyshortcuts", "Alt+Shift+P");
    next.setAttribute("aria-keyshortcuts", "Alt+Shift+N");
  }
  select.title = `Choose a document${shortcuts ? " (Alt+Shift+D)" : ""}; use the arrow keys to select`;
  previous.title = `Previous document${shortcuts ? " (Alt+Shift+P)" : ""}`;
  next.title = `Next document${shortcuts ? " (Alt+Shift+N)" : ""}`;

  const available = (): boolean => root.isConnected && !root.closest("[hidden], [inert]") && !select.disabled;
  function move(delta: number): void {
    if (!available() || select.options.length < 2) return;
    select.selectedIndex = (select.selectedIndex + delta + select.options.length) % select.options.length;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const backward = (): void => move(-1);
  const forward = (): void => move(1);
  function onKeyDown(event: KeyboardEvent): void {
    if (!shortcuts || !available() || event.defaultPrevented || event.isComposing ||
      !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "p" || key === "n") {
      if (select.options.length < 2) return;
      event.preventDefault();
      if (!event.repeat) move(key === "p" ? -1 : 1);
    } else if (key === "d" && select.options.length) {
      event.preventDefault();
      if (!event.repeat) select.focus();
    }
  }
  previous.addEventListener("click", backward);
  next.addEventListener("click", forward);
  target?.addEventListener("keydown", onKeyDown);
  return {
    sync(): void {
      previous.disabled = next.disabled = select.disabled || select.options.length < 2;
    },
    destroy(): void {
      previous.removeEventListener("click", backward);
      next.removeEventListener("click", forward);
      target?.removeEventListener("keydown", onKeyDown);
      hint?.remove();
    },
  };
}
