/**
 * One registry for desktop actions. Keyboard shortcuts, the command palette and
 * menus read it, so an action is defined once with its title, keys and guard.
 *
 * Keys use `Mod` for Ctrl (Windows/Linux) or Cmd (macOS), then optional
 * `Shift` / `Alt`, then the key: `"Mod+N"`, `"Mod+Shift+S"`, `"Alt+ArrowLeft"`.
 * A key matches only with exactly the named modifiers.
 */
export interface Command {
  id: string;
  title: string;
  keys?: readonly string[];
  /** When false the command is listed but does not run. Defaults to enabled. */
  enabled?: () => boolean;
  run: () => void | Promise<void>;
}

const registry = new Map<string, Command>();

/** Register a command; returns its unregister function. Ids are unique. */
export function registerCommand(command: Command): () => void {
  if (registry.has(command.id)) throw new Error(`Command already registered: ${command.id}`);
  registry.set(command.id, command);
  return () => { if (registry.get(command.id) === command) registry.delete(command.id); };
}

export function listCommands(): Command[] {
  return [...registry.values()];
}

export function isEnabled(command: Command): boolean {
  return command.enabled?.() ?? true;
}

/** Run a command by id if it exists and is enabled; returns whether it ran. */
export function runCommand(id: string): boolean {
  const command = registry.get(id);
  if (!command || !isEnabled(command)) return false;
  void command.run();
  return true;
}

function matches(spec: string, event: KeyboardEvent): boolean {
  const parts = spec.split("+");
  const key = parts.pop()!.toLowerCase();
  const mod = parts.includes("Mod");
  // Exactly one of Ctrl/Cmd for Mod; neither without it.
  const hasMod = event.ctrlKey !== event.metaKey;
  if (mod ? !hasMod : event.ctrlKey || event.metaKey) return false;
  return event.shiftKey === parts.includes("Shift") && event.altKey === parts.includes("Alt")
    && event.key.toLowerCase() === key;
}

export function commandForEvent(event: KeyboardEvent): Command | undefined {
  for (const command of registry.values()) {
    if (command.keys?.some(spec => matches(spec, event))) return command;
  }
  return undefined;
}

/**
 * Dispatch registered shortcuts from `target` while `active()` holds. A matched
 * shortcut is always claimed (preventDefault), even when repeated or disabled,
 * so the browser default never runs in its place.
 */
export function installShortcuts(target: Window, active: () => boolean): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!active() || event.defaultPrevented || event.isComposing) return;
    const command = commandForEvent(event);
    if (!command) return;
    event.preventDefault();
    if (event.repeat || !isEnabled(command)) return;
    void command.run();
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
