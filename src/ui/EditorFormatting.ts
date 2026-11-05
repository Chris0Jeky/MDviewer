import { ATTRS, CLASSES, IDS, el } from "../app/dom";
import { markdownCommand } from "./MarkdownCommands";
import type { MarkdownCommand, MarkdownSelection } from "./MarkdownCommands";

interface FormattingOptions {
  canEdit(): boolean;
  replaceRange(start: number, end: number, text: string, signal?: AbortSignal,
    selectionAfter?: MarkdownSelection): Promise<boolean>;
}

export interface EditorFormattingController {
  setInput(input: HTMLTextAreaElement): void;
  sourceChanged(documentChanged?: boolean): void;
  destroy(): void;
}

const COMMANDS: ReadonlyArray<{ command: MarkdownCommand; label: string; name: string; keys?: string }> = [
  { command: "bold", label: "Bold", name: "Bold", keys: "Control+B Meta+B" },
  { command: "italic", label: "Italic", name: "Italic", keys: "Control+I Meta+I" },
  { command: "inline-code", label: "Code", name: "Inline code" },
  { command: "code-block", label: "Code block", name: "Code block" },
  { command: "heading-1", label: "H1", name: "Heading 1" },
  { command: "heading-2", label: "H2", name: "Heading 2" },
  { command: "heading-3", label: "H3", name: "Heading 3" },
  { command: "link", label: "Link", name: "Link", keys: "Control+K Meta+K" },
  { command: "unordered-list", label: "Bullets", name: "Bulleted list" },
  { command: "ordered-list", label: "Numbers", name: "Numbered list" },
  { command: "task-list", label: "Tasks", name: "Task list" },
];

/** Source-only disclosure; every mutation and final selection belongs to Editor. */
export function mountEditorFormatting(pane: HTMLElement, head: HTMLElement,
  initialInput: HTMLTextAreaElement, opts: FormattingOptions): EditorFormattingController {
  let input = initialInput;
  let destroyed = false;
  let revision = 0;
  let pending: AbortController | undefined;
  const toggle = el("button", {
    type: "button", class: CLASSES.editorCommand,
    attrs: { "aria-label": "Format Markdown", "aria-expanded": "false", "aria-controls": IDS.editorFormatting },
  }, "Format");
  const panel = el("div", {
    id: IDS.editorFormatting, hidden: true,
    attrs: { role: "group", "aria-label": "Markdown formatting" },
  });
  const status = el("span", {
    class: CLASSES.editorFormatStatus,
    attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
  });
  const buttons = COMMANDS.map(({ command, label, name, keys }) => {
    const button = el("button", {
      type: "button", class: CLASSES.editorCommand, title: name,
      attrs: { "aria-label": name, ...(keys ? { "aria-keyshortcuts": keys } : {}) },
    }, label);
    button.addEventListener("click", () => { void run(command); });
    return button;
  });
  const closeButton = el("button", {
    type: "button", class: CLASSES.editorCommand, attrs: { "aria-label": "Close formatting" },
  }, "×");
  panel.append(...buttons, closeButton, status);
  // Keep Find last so Shift+Tab from the source retains its established target.
  head.insertBefore(toggle, head.querySelector(`[aria-controls="${IDS.editorSearch}"]`));
  pane.insertBefore(panel, pane.querySelector(`.${CLASSES.editorScroll}`));

  const available = () => !destroyed && opts.canEdit() &&
    !pane.closest(`[${ATTRS.viewMode}="preview"]`);
  const cancel = () => {
    revision++;
    pending?.abort();
    pending = undefined;
    for (const button of buttons) button.disabled = false;
    status.textContent = "";
  };
  const close = () => {
    cancel();
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (available()) input.focus({ preventScroll: true });
  };

  async function run(command: MarkdownCommand): Promise<void> {
    if (!available() || pending) return;
    const change = markdownCommand(input.value, {
      start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection,
    }, command);
    if (!change) {
      status.textContent = command === "inline-code" ? "Select one line for inline code, or use Code block."
        : command === "link" ? "Select one line for a link." : "Select complete characters to format.";
      return;
    }
    const operation = ++revision;
    const abort = new AbortController();
    pending = abort;
    for (const button of buttons) button.disabled = true;
    const accepted = await opts.replaceRange(change.start, change.end, change.text, abort.signal, change.selection);
    if (destroyed || operation !== revision || abort.signal.aborted) return;
    pending = undefined;
    for (const button of buttons) button.disabled = false;
    status.textContent = accepted ? "" : "Formatting was not applied. Select the text and try again.";
  }

  const onToggle = (event: MouseEvent) => {
    if (!available()) return;
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    status.textContent = "";
    if (event.detail === 0) buttons[0]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || !available()) return;
    if (event.key === "Escape" && !panel.hidden &&
      (event.target === input || panel.contains(event.target as Node))) {
      event.preventDefault();
      close();
      return;
    }
    if (event.target !== input || event.altKey || event.shiftKey || event.ctrlKey === event.metaKey) return;
    const command = ({ b: "bold", i: "italic", k: "link" } as const)[event.key.toLowerCase() as "b" | "i" | "k"];
    if (!command) return;
    event.preventDefault();
    void run(command);
  };
  toggle.addEventListener("click", onToggle);
  closeButton.addEventListener("click", close);
  pane.addEventListener("keydown", onKeyDown);

  return {
    setInput(next): void { cancel(); input = next; },
    sourceChanged(documentChanged = false): void { if (documentChanged) cancel(); },
    destroy(): void {
      destroyed = true;
      cancel();
      pane.removeEventListener("keydown", onKeyDown);
      toggle.removeEventListener("click", onToggle);
      closeButton.removeEventListener("click", close);
      panel.remove();
      toggle.remove();
    },
  };
}
