/**
 * Document tabs (S3): one tab per open document, the only way documents switch in the
 * reading view. APG tabs with automatic activation: arrow keys, Home and End move and
 * select, Delete closes. The close buttons sit beside each tab (never inside a role=tab)
 * and are reachable by pointer; keyboard users close with Delete or Ctrl+W.
 */
export interface TabItem {
  id: string;
  label: string;
  dirty: boolean;
}

export interface Tabs {
  render(items: readonly TabItem[], activeId: string | null, disabled: boolean): void;
  focusActive(): void;
}

export function mountTabs(host: HTMLElement, actions: {
  activate(id: string): void;
  close(id: string): void;
}): Tabs {
  let items: readonly TabItem[] = [];
  let disabled = false;

  const tabOf = (id: string): HTMLElement | null =>
    host.querySelector<HTMLElement>(`[role="tab"][data-doc-id="${CSS.escape(id)}"]`);

  function render(next: readonly TabItem[], activeId: string | null, isDisabled: boolean): void {
    items = next;
    disabled = isDisabled;
    const hadFocus = host.contains(document.activeElement);
    host.replaceChildren(...next.map(item => {
      const wrap = document.createElement("div");
      wrap.className = "shell-tab";
      wrap.classList.toggle("is-active", item.id === activeId);
      wrap.classList.toggle("is-dirty", item.dirty);
      const tab = document.createElement("div");
      tab.setAttribute("role", "tab");
      tab.dataset.docId = item.id;
      tab.id = `shell-tab-${item.id}`;
      tab.setAttribute("aria-selected", String(item.id === activeId));
      tab.setAttribute("aria-controls", "reader-document");
      tab.tabIndex = item.id === activeId ? 0 : -1;
      if (disabled) tab.setAttribute("aria-disabled", "true");
      tab.title = item.dirty ? `${item.label} (unsaved changes)` : item.label;
      const label = document.createElement("span");
      label.className = "shell-tab-label";
      label.textContent = item.label;
      tab.append(label);
      if (item.dirty) {
        // The dot is decoration; the tab's name says it in words.
        const dot = document.createElement("span");
        dot.className = "shell-dirty";
        dot.setAttribute("aria-hidden", "true");
        dot.title = "Unsaved changes";
        tab.append(dot);
        const words = document.createElement("span");
        words.className = "shell-visually-hidden";
        words.textContent = ", unsaved changes";
        tab.append(words);
      }
      const close = document.createElement("button");
      close.type = "button";
      close.className = "shell-tab-close";
      close.tabIndex = -1;
      close.disabled = disabled;
      close.setAttribute("aria-label", `Close ${item.label}`);
      close.title = `Close ${item.label} (Ctrl+W)`;
      close.textContent = "×";
      close.addEventListener("click", event => { event.stopPropagation(); actions.close(item.id); });
      wrap.append(tab, close);
      return wrap;
    }));
    host.hidden = !next.length;
    const active = activeId ? tabOf(activeId) : null;
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (hadFocus) active?.focus();
  }

  host.addEventListener("click", event => {
    const tab = (event.target as Element | null)?.closest<HTMLElement>('[role="tab"]');
    if (tab && !disabled) actions.activate(tab.dataset.docId!);
  });
  host.addEventListener("auxclick", event => {
    // Middle click closes, as in browsers.
    const tab = (event.target as Element | null)?.closest<HTMLElement>('[role="tab"]');
    if (tab && event.button === 1 && !disabled) actions.close(tab.dataset.docId!);
  });
  host.addEventListener("keydown", event => {
    const tab = (event.target as Element | null)?.closest<HTMLElement>('[role="tab"]');
    if (!tab || disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = items.findIndex(item => item.id === tab.dataset.docId);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Delete") { event.preventDefault(); actions.close(tab.dataset.docId!); return; }
    if (next === -1) return;
    event.preventDefault();
    actions.activate(items[next]!.id);
    tabOf(items[next]!.id)?.focus();
  });

  return {
    render,
    focusActive: () => { host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(); },
  };
}
