import {
  MARKS, MARK_LABELS, nextMark, nextOption, type ActionableDocument, type Control, type ControlAction, type Mark,
} from "../../render/actionable";

/**
 * Actionable controls in the reading view (A3). Built from the parsed source, never from
 * authored HTML: marks are checkboxes (a click steps the document's cycle; right click, the
 * context-menu key or Shift+F10 opens all six marks, keys 1-6), choices are radios (arrows move,
 * Space selects), fields edit in place (Enter commits, Escape cancels) and chips step their
 * options. Every write needs a trusted gesture.
 */
export type ControlHandler = (control: Control, action: ControlAction) => void;
let handler: ControlHandler | null = null;
export function setControlHandler(next: ControlHandler | null): void { handler = next; }

function act(event: Event, control: Control, action: ControlAction): void {
  if (!event.isTrusted) return; // Only a real click or key press may write.
  handler?.(control, action);
}

const MARK_CHECKED: Record<Mark, "true" | "false" | "mixed"> = { " ": "false", x: "true", "/": "mixed", "-": "false", "!": "false", "?": "false" };

function itemLabel(li: HTMLElement): string {
  const copy = li.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("ul, ol, button, .am-box, .am-radio, input").forEach(node => node.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || "Item";
}

/** A small menu of choices under `anchor`; digits pick, Escape returns focus. */
function openMenu(anchor: HTMLElement, title: string, items: Array<{ label: string; current: boolean; pick(event: Event): void }>): void {
  document.querySelector(".am-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "am-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", title);
  const close = (refocus = true): void => { menu.remove(); document.removeEventListener("pointerdown", outside, true); if (refocus) anchor.focus(); };
  const outside = (event: Event): void => { if (!menu.contains(event.target as Node)) close(false); };
  items.forEach((item, index) => {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "am-menu-item";
    entry.setAttribute("role", "menuitemradio");
    entry.setAttribute("aria-checked", String(item.current));
    entry.tabIndex = -1;
    const check = document.createElement("span");
    check.className = "am-menu-check";
    check.textContent = item.current ? "✓" : "";
    check.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = item.label;
    const key = document.createElement("kbd");
    key.textContent = String(index + 1);
    key.setAttribute("aria-hidden", "true");
    entry.append(check, text, key);
    entry.addEventListener("click", event => { close(); item.pick(event); });
    menu.append(entry);
  });
  menu.addEventListener("keydown", event => {
    const entries = [...menu.querySelectorAll<HTMLButtonElement>(".am-menu-item")];
    const at = entries.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => { event.preventDefault(); entries[(to + entries.length) % entries.length]?.focus(); };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(entries.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); close(); }
    else if (/^[1-9]$/.test(event.key) && entries[Number(event.key) - 1]) { event.preventDefault(); entries[Number(event.key) - 1]!.click(); }
  });
  const box = anchor.getBoundingClientRect();
  menu.style.left = `${Math.round(box.left + window.scrollX)}px`;
  menu.style.top = `${Math.round(box.bottom + window.scrollY + 4)}px`;
  document.body.append(menu);
  document.addEventListener("pointerdown", outside, true);
  (menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.querySelector<HTMLElement>(".am-menu-item"))?.focus();
}

function wantsMenu(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

export function decorateControls(root: HTMLElement, actionable: ActionableDocument): void {
  const byLine = new Map(actionable.controls.map(control => [control.line, control]));
  for (const li of root.querySelectorAll<HTMLElement>("li[data-src]")) {
    const control = byLine.get(Number(li.dataset.src!.split("-")[0]));
    if (!control || (control.kind !== "mark" && control.kind !== "choice")) continue;
    const glyph = [...li.querySelectorAll<HTMLElement>(".task-list-item-checkbox, .am-box, .am-radio")].find(node => node.closest("li") === li);
    if (!glyph) continue;
    const button = document.createElement("button");
    button.type = "button";
    const name = itemLabel(li);
    if (control.kind === "mark") {
      button.className = "am-mark";
      button.setAttribute("role", "checkbox");
      button.setAttribute("aria-checked", MARK_CHECKED[control.state]);
      button.setAttribute("aria-label", `${name} (${MARK_LABELS[control.state]})`);
      const next = nextMark(control.state, actionable.cycle);
      button.title = next ? `${MARK_LABELS[control.state]}: click for ${MARK_LABELS[next].toLowerCase()}; right-click for all marks`
        : `${MARK_LABELS[control.state]}: click or right-click to choose a mark`;
      const box = document.createElement("span");
      box.className = "am-box";
      box.dataset.mark = control.state;
      box.setAttribute("aria-hidden", "true");
      button.append(box);
      const menu = (): void => openMenu(button, `Mark ${name}`, MARKS.map(mark => ({
        label: MARK_LABELS[mark], current: mark === control.state, pick: event => act(event, control, { kind: "mark", to: mark }),
      })));
      button.addEventListener("click", event => {
        if (next) act(event, control, { kind: "mark", to: next });
        else if (event.isTrusted) menu();
      });
      button.addEventListener("contextmenu", event => { event.preventDefault(); if (event.isTrusted) menu(); });
      button.addEventListener("keydown", event => { if (wantsMenu(event)) { event.preventDefault(); if (event.isTrusted) menu(); } });
    } else {
      button.className = "am-choice";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(control.state === "x"));
      button.setAttribute("aria-label", name);
      button.dataset.group = String(control.group);
      button.title = control.state === "x" ? "Selected: click to clear" : "Click to select";
      const dot = document.createElement("span");
      dot.className = control.state === "x" ? "am-radio am-checked" : "am-radio";
      dot.setAttribute("aria-hidden", "true");
      button.append(dot);
      button.addEventListener("click", event => act(event, control, { kind: "choice" }));
      button.addEventListener("keydown", event => {
        if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
        event.preventDefault();
        const group = [...root.querySelectorAll<HTMLButtonElement>(`.am-choice[data-group="${control.group}"]`)];
        const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
        group[(group.indexOf(button) + step + group.length) % group.length]?.focus();
      });
    }
    glyph.replaceWith(button);
    li.classList.add("am-live");
  }
  // One tab stop per choice group: the selected item, or the first.
  const groups = new Map<string, HTMLButtonElement[]>();
  for (const radio of root.querySelectorAll<HTMLButtonElement>(".am-choice")) {
    groups.set(radio.dataset.group!, [...(groups.get(radio.dataset.group!) ?? []), radio]);
  }
  for (const radios of groups.values()) {
    const current = radios.find(radio => radio.getAttribute("aria-checked") === "true") ?? radios[0]!;
    for (const radio of radios) radio.tabIndex = radio === current ? 0 : -1;
    const list = radios[0]!.closest("ul, ol");
    if (list && radios.every(radio => radio.closest("ul, ol") === list)) {
      list.setAttribute("role", "radiogroup");
      list.setAttribute("aria-label", "Choose one");
    }
  }

  for (const field of root.querySelectorAll<HTMLElement>(".am-field[data-am-line]")) {
    const control = byLine.get(Number(field.dataset.amLine));
    const value = field.querySelector<HTMLElement>(".am-field-value");
    if (!control || control.kind !== "field" || !value) continue;
    value.tabIndex = 0;
    value.setAttribute("role", "button");
    value.setAttribute("aria-label", `Edit ${control.key}: ${control.value || "empty"}`);
    value.title = "Click or press Enter to edit";
    if (!control.value) value.classList.add("is-empty");
    const edit = (): void => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "am-input";
      input.value = control.value;
      input.setAttribute("aria-label", `${control.key} (Enter saves, Escape cancels)`);
      value.hidden = true;
      value.after(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (event: Event | null): void => {
        if (done) return;
        done = true;
        input.remove();
        value.hidden = false;
        if (event) act(event, control, { kind: "field", value: input.value });
        else value.focus();
      };
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); finish(event); }
        else if (event.key === "Escape") { event.preventDefault(); finish(null); }
      });
      input.addEventListener("blur", () => { if (!done) { done = true; input.remove(); value.hidden = false; } });
    };
    value.addEventListener("click", event => { if (event.isTrusted) edit(); });
    value.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && event.isTrusted) { event.preventDefault(); edit(); }
    });
  }

  for (const chip of root.querySelectorAll<HTMLElement>(".am-chip[data-src]")) {
    const control = byLine.get(Number(chip.dataset.src!.split("-")[0]));
    if (!control || control.kind !== "chip") continue;
    const next = nextOption(control.value, control.options);
    chip.tabIndex = 0;
    chip.setAttribute("role", "button");
    chip.setAttribute("aria-label", `${control.key}: ${control.value || "none"}. Click for ${next}; right-click for all options`);
    chip.classList.add("am-live");
    const menu = (): void => openMenu(chip, control.key, control.options.map(option => ({
      label: option, current: option === control.value, pick: event => act(event, control, { kind: "chip", value: option }),
    })));
    chip.addEventListener("click", event => act(event, control, { kind: "chip", value: next }));
    chip.addEventListener("contextmenu", event => { event.preventDefault(); if (event.isTrusted) menu(); });
    chip.addEventListener("keydown", event => {
      if (wantsMenu(event)) { event.preventDefault(); if (event.isTrusted) menu(); }
      else if ((event.key === "Enter" || event.key === " ") && event.isTrusted) { event.preventDefault(); handler?.(control, { kind: "chip", value: next }); }
    });
  }
}
