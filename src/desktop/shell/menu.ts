import { isEnabled, listCommands, runCommand, type Command } from "../commands";

/**
 * The More menu (S3): an APG menu button whose items are registered commands, so the
 * palette, shortcuts and this menu share one definition. Items are built once (stable ids
 * for automation) and their enabled and checked states are refreshed whenever it opens.
 */
export type MenuEntry =
  | { command: string; id?: string; role?: "menuitemradio" | "menuitemcheckbox"; checked?: () => boolean; disabled?: () => boolean }
  | "separator";

const KEY_LABELS: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→" };

/** "Mod+Shift+S" → "Ctrl+Shift+S" (Cmd on macOS). */
export function shortcutLabel(spec: string): string {
  const mac = /Mac/i.test(navigator.platform);
  return spec.split("+").map(part => part === "Mod" ? (mac ? "Cmd" : "Ctrl")
    : KEY_LABELS[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join("+");
}

export function mountMenu(button: HTMLButtonElement, menu: HTMLElement, entries: readonly MenuEntry[]): { close(): void } {
  const commands = (): Map<string, Command> => new Map(listCommands().map(command => [command.id, command]));
  const items: Array<{ element: HTMLButtonElement; entry: Exclude<MenuEntry, "separator"> }> = [];
  for (const entry of entries) {
    if (entry === "separator") {
      const rule = document.createElement("div");
      rule.setAttribute("role", "separator");
      rule.className = "shell-menu-separator";
      menu.append(rule);
      continue;
    }
    const element = document.createElement("button");
    element.type = "button";
    element.className = "shell-menu-item";
    element.setAttribute("role", entry.role ?? "menuitem");
    element.tabIndex = -1;
    element.dataset.command = entry.command;
    if (entry.id) element.id = entry.id;
    element.addEventListener("click", () => {
      if (element.getAttribute("aria-disabled") === "true") return;
      close(false);
      runCommand(entry.command);
    });
    items.push({ element, entry });
    menu.append(element);
  }

  function refresh(): void {
    const known = commands();
    for (const { element, entry } of items) {
      const command = known.get(entry.command);
      element.hidden = !command;
      if (!command) continue;
      element.replaceChildren();
      const check = document.createElement("span");
      check.className = "shell-menu-check";
      check.setAttribute("aria-hidden", "true");
      if (entry.checked) {
        const on = entry.checked();
        element.setAttribute("aria-checked", String(on));
        check.textContent = on ? "✓" : "";
      }
      const title = document.createElement("span");
      title.className = "shell-menu-title";
      title.textContent = command.title;
      element.append(check, title);
      const keys = command.keys?.[0];
      if (keys) {
        const hint = document.createElement("span");
        hint.className = "shell-menu-keys";
        hint.textContent = shortcutLabel(keys);
        element.append(hint);
        element.setAttribute("aria-keyshortcuts", keys.replace("Mod", "Control"));
      }
      element.setAttribute("aria-disabled", String(!isEnabled(command) || !!entry.disabled?.()));
    }
  }

  const visible = (): HTMLButtonElement[] => items.map(item => item.element).filter(element => !element.hidden);

  function open(focus: "first" | "last" = "first"): void {
    refresh();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const list = visible();
    (focus === "first" ? list[0] : list[list.length - 1])?.focus();
  }

  function close(returnFocus = true): void {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) button.focus();
  }

  refresh();
  button.addEventListener("click", () => menu.hidden ? open() : close());
  button.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open(event.key === "ArrowDown" ? "first" : "last");
    }
  });
  menu.addEventListener("keydown", event => {
    const list = visible();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => { event.preventDefault(); list[(to + list.length) % list.length]?.focus(); };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") close(false);
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      // Type-ahead: the next item whose title starts with the letter.
      const letter = event.key.toLowerCase();
      for (let step = 1; step <= list.length; step++) {
        const candidate = list[(at + step) % list.length]!;
        if (candidate.textContent?.replace(/^✓/, "").trim().toLowerCase().startsWith(letter)) { move(at + step); break; }
      }
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!menu.hidden && !menu.contains(event.target as Node) && !button.contains(event.target as Node)) close(false);
  });
  return { close: () => close(false) };
}
