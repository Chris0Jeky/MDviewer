/** Keyboard access to the existing local document actions, never a second save path. */
export function mountDocumentShortcuts(root: HTMLElement): () => void {
  const open = root.querySelectorAll<HTMLButtonElement>(".workspace-actions > button.workspace-action");
  const save = root.querySelectorAll<HTMLButtonElement>(".workspace-session > button.workspace-action");
  const privacy = root.querySelector<HTMLElement>(".workspace-session > .workspace-privacy");
  const target = root.ownerDocument.defaultView;
  if (open.length !== 1 || save.length !== 1 || !privacy || !target) {
    throw new Error("MDviewer: local document shortcut controls failed to mount.");
  }
  const actions = { o: open[0]!, s: save[0]! };
  const previous = Object.values(actions).map((button) => ({
    button, title: button.getAttribute("title"), keys: button.getAttribute("aria-keyshortcuts"),
  }));
  for (const [key, button] of Object.entries(actions)) {
    button.setAttribute("aria-keyshortcuts", `Control+${key} Meta+${key}`);
    const hint = `Ctrl/Cmd+${key.toUpperCase()}`;
    button.title = button.title ? `${button.title} (${hint})` : hint;
  }
  const hint = root.ownerDocument.createElement("span");
  hint.className = "workspace-shortcuts";
  hint.style.display = "block";
  hint.textContent = "Ctrl/Cmd+O to open · Ctrl/Cmd+S to save Markdown.";
  privacy.append(hint);

  function onKeyDown(event: KeyboardEvent): void {
    if (!root.isConnected || event.defaultPrevented || event.isComposing ||
      event.altKey || event.shiftKey || event.ctrlKey === event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key !== "o" && key !== "s") return;
    // Even with no document or a held key, never fall through to saving app HTML.
    event.preventDefault();
    const button = actions[key];
    if (!event.repeat && button.isConnected && !button.disabled) button.click();
  }
  target.addEventListener("keydown", onKeyDown);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    target.removeEventListener("keydown", onKeyDown);
    hint.remove();
    for (const { button, title, keys } of previous) {
      if (title === null) button.removeAttribute("title");
      else button.setAttribute("title", title);
      if (keys === null) button.removeAttribute("aria-keyshortcuts");
      else button.setAttribute("aria-keyshortcuts", keys);
    }
  };
}
