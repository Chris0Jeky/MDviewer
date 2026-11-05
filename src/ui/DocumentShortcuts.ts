/** Keyboard access to the existing local document actions, never a second save path. */
export function mountDocumentShortcuts(root: HTMLElement): () => void {
  const open = root.querySelectorAll<HTMLButtonElement>('.workspace-actions > button[data-document-command="open"]');
  const save = root.querySelectorAll<HTMLButtonElement>('.workspace-session > button[data-document-command="save"]');
  const create = root.querySelectorAll<HTMLButtonElement>('.workspace-actions > button[data-document-command="new"]');
  const privacy = root.querySelector<HTMLElement>(".workspace-session > .workspace-privacy");
  const target = root.ownerDocument.defaultView;
  if (open.length !== 1 || save.length !== 1 || create.length > 1 || !privacy || !target) {
    throw new Error("MDviewer: local document shortcut controls failed to mount.");
  }
  const actions = new Map<string, HTMLButtonElement>([["o", open[0]!], ["s", save[0]!]]);
  if (create[0]) actions.set("n", create[0]);
  const previous = [...actions.values()].map((button) => ({
    button, title: button.getAttribute("title"), keys: button.getAttribute("aria-keyshortcuts"),
  }));
  for (const [key, button] of actions) {
    button.setAttribute("aria-keyshortcuts", `Control+${key} Meta+${key}`);
    const hint = `Ctrl/Cmd+${key.toUpperCase()}`;
    button.title = button.title ? `${button.title} (${hint})` : hint;
  }
  const hint = root.ownerDocument.createElement("span");
  hint.className = "workspace-shortcuts";
  hint.style.display = "block";
  hint.textContent = `${create.length ? "Ctrl/Cmd+N for new · " : ""}Ctrl/Cmd+O to open · Ctrl/Cmd+S to save Markdown.`;
  privacy.append(hint);

  function onKeyDown(event: KeyboardEvent): void {
    if (!root.isConnected || event.defaultPrevented || event.isComposing ||
      event.altKey || event.shiftKey || event.ctrlKey === event.metaKey) return;
    const button = actions.get(event.key.toLowerCase());
    if (!button) return;
    // App teardown can remove Toolbar while leaving its root connected.
    if (!button.isConnected || !root.contains(button)) return;
    // Even with no document or a held key, never fall through to saving app HTML.
    event.preventDefault();
    if (!event.repeat && !button.disabled) button.click();
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
