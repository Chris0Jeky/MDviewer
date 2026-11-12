import { isEnabled, listCommands, runCommand } from "../commands";
import { shortcutLabel } from "./menu";

/**
 * Command palette (S3, Ctrl+K). Loaded on first use, so it never delays the first document.
 * A modal <dialog> with a combobox and a listbox: open documents, recent files and every
 * enabled command, filtered as you type. Enter runs the highlighted entry; Escape closes and
 * returns focus.
 */
export interface PaletteSource {
  documents(): Array<{ id: string; label: string; detail: string; active: boolean }>;
  recent(): Promise<Array<{ id: string; label: string; detail: string }>>;
  activate(id: string): void;
  openRecent(id: string): void;
}

interface Entry { group: string; label: string; detail?: string; keys?: string; run(): void }

let dialog: HTMLDialogElement | null = null;

/** Subsequence match, scored so prefixes and word starts rank first. */
export function score(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 3;
  if (t.includes(` ${q}`) || t.includes(q)) return 2;
  let at = 0;
  for (const char of q) {
    at = t.indexOf(char, at);
    if (at === -1) return 0;
    at++;
  }
  return 1;
}

export async function openPalette(source: PaletteSource): Promise<void> {
  if (dialog?.open) return;
  const returnTo = document.activeElement as HTMLElement | null;
  dialog = document.createElement("dialog");
  dialog.className = "shell-palette";
  dialog.setAttribute("aria-label", "Command palette");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "shell-palette-input";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", "shell-palette-list");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-label", "Search commands and files");
  input.placeholder = "Search commands and open or recent files";
  input.spellcheck = false;
  input.autocomplete = "off";
  const list = document.createElement("div");
  list.id = "shell-palette-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Results");
  list.className = "shell-palette-list";
  // Announces how many results the query has (the list itself is not a live region).
  const count = document.createElement("p");
  count.className = "shell-visually-hidden";
  count.setAttribute("role", "status");
  const hint = document.createElement("p");
  hint.className = "shell-palette-hint";
  hint.textContent = "↑ ↓ move · Enter run · Esc close";
  dialog.append(input, list, count, hint);
  document.body.append(dialog);

  const commandEntries = (): Entry[] => listCommands()
    .filter(command => isEnabled(command) && command.id !== "palette.open")
    .map(command => ({ group: "Commands", label: command.title, keys: command.keys?.[0], run: () => runCommand(command.id) }));
  const documentEntries = (): Entry[] => source.documents().map(doc => ({
    group: "Open documents", label: doc.label, detail: doc.active ? `${doc.detail} · current` : doc.detail,
    run: () => source.activate(doc.id),
  }));
  let recentEntries: Entry[] = [];
  let results: Entry[] = [];
  let selected = 0;

  function draw(): void {
    const query = input.value.trim();
    results = [...documentEntries(), ...recentEntries, ...commandEntries()]
      .map(entry => ({ entry, score: score(query, `${entry.label} ${entry.detail ?? ""}`) }))
      .filter(item => item.score > 0)
      .sort((a, b) => (query ? b.score - a.score : 0))
      .map(item => item.entry);
    selected = Math.min(selected, Math.max(results.length - 1, 0));
    list.replaceChildren();
    let group = "";
    results.forEach((entry, index) => {
      if (entry.group !== group && !query) {
        group = entry.group;
        const heading = document.createElement("div");
        heading.className = "shell-palette-group";
        heading.setAttribute("role", "presentation");
        heading.textContent = group;
        list.append(heading);
      }
      const option = document.createElement("div");
      option.id = `shell-palette-option-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === selected));
      option.className = "shell-palette-option";
      const label = document.createElement("span");
      label.textContent = entry.label;
      option.append(label);
      if (entry.detail) {
        const detail = document.createElement("span");
        detail.className = "shell-palette-detail";
        detail.textContent = entry.detail;
        option.append(detail);
      }
      if (entry.keys) {
        const keys = document.createElement("kbd");
        keys.textContent = shortcutLabel(entry.keys);
        option.append(keys);
      }
      option.addEventListener("pointerdown", event => { event.preventDefault(); choose(index); });
      list.append(option);
    });
    count.textContent = results.length ? `${results.length} ${results.length === 1 ? "result" : "results"}` : "No matches";
    if (!results.length) {
      const none = document.createElement("div");
      none.className = "shell-palette-empty";
      none.textContent = "No matching command or file";
      list.append(none);
    }
    const current = list.querySelector<HTMLElement>(`#shell-palette-option-${selected}`);
    if (current) {
      input.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView?.({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  function close(): void {
    dialog?.close();
  }
  function choose(index: number): void {
    const entry = results[index];
    if (!entry) return;
    close();
    entry.run();
  }

  input.addEventListener("input", () => { selected = 0; draw(); });
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      draw();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(selected);
    }
  });
  dialog.addEventListener("close", () => {
    dialog?.remove();
    dialog = null;
    // A command may have rebuilt the element that had focus (a tab); fall back to the active tab.
    const target = returnTo?.isConnected ? returnTo
      : document.querySelector<HTMLElement>('#shell-tabs [role="tab"][aria-selected="true"]');
    if (target && !target.contains(document.activeElement) && document.activeElement === document.body) target.focus();
    else if (returnTo?.isConnected) returnTo.focus();
  });
  dialog.addEventListener("pointerdown", event => { if (event.target === dialog) close(); });

  draw();
  dialog.showModal();
  input.focus();
  try {
    recentEntries = (await source.recent()).map(item => ({
      group: "Recent files", label: item.label, detail: item.detail, run: () => source.openRecent(item.id),
    }));
    if (dialog) draw();
  } catch { /* No library: documents and commands are enough. */ }
}
