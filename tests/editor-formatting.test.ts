import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountEditor } from "../src/ui/Editor";
import type { EditorController, EditorOptions } from "../src/ui/Editor";

vi.mock("../src/render/highlight", () => ({
  CODE_THEME_PAIRS: { github: { light: "github-light", dark: "github-dark" } },
  getHighlighter: vi.fn(async () => ({ codeToTokens: (text: string) => ({ tokens: [[{ content: text }]] }) })),
}));

let editor: EditorController;
let root: HTMLElement;
const onInput = vi.fn();
function mount(options: Partial<EditorOptions> = {}): void {
  editor?.destroy();
  editor = mountEditor(root, { codeTheme: "github", onInput, ...options });
  editor.setDocument({ id: "a", name: "a.md", text: "word" });
  editor.input.focus();
  editor.input.setSelectionRange(0, 4, "backward");
}
function button(name: string): HTMLButtonElement {
  const result = root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!result) throw new Error(`Missing ${name}`);
  return result;
}
function shortcut(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...init });
  editor.input.dispatchEvent(event);
  return event;
}
async function settle(): Promise<void> { await vi.advanceTimersByTimeAsync(0); }

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  root = document.createElement("div");
  root.setAttribute("data-view-mode", "split");
  document.body.append(root);
  onInput.mockClear();
  mount();
});
afterEach(() => { editor.destroy(); vi.useRealTimers(); });

describe("editor formatting ownership and controls", () => {
  it("opens a labelled keyboard group and returns to the source on Escape", () => {
    expect(button("Format Markdown").getAttribute("aria-expanded")).toBe("false");
    button("Format Markdown").click();
    expect(root.querySelector<HTMLElement>("#editor-formatting")?.hidden).toBe(false);
    expect(document.activeElement).toBe(button("Bold"));
    button("Bold").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(button("Format Markdown").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(editor.input);
    expect([editor.input.selectionStart, editor.input.selectionEnd]).toEqual([0, 4]);
  });

  it("applies one observable edit and restores a backward content selection", async () => {
    button("Format Markdown").click();
    button("Bold").click();
    await settle();
    expect(onInput).toHaveBeenCalledExactlyOnceWith("**word**");
    expect(editor.input.value).toBe("**word**");
    expect([editor.input.selectionStart, editor.input.selectionEnd, editor.input.selectionDirection]).toEqual([2, 6, "backward"]);
    expect(document.activeElement).toBe(editor.input);
    button("Bold").click();
    await settle();
    expect(editor.input.value).toBe("word");
  });

  it.each([["b", "**word**"], ["i", "*word*"], ["k", "[word](url)"]])(
    "supports the source-only Ctrl/Meta+%s shortcut", async (key, expected) => {
      expect(shortcut(key ?? "", { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(editor.input.value).toBe(expected);
    });

  it.each(["preview", "readonly", "disabled", "inert", "detached", "composition"])(
    "does not edit a %s source", async (state) => {
      if (state === "preview") root.setAttribute("data-view-mode", "preview");
      if (state === "readonly") editor.input.readOnly = true;
      if (state === "disabled") editor.input.disabled = true;
      if (state === "inert") root.setAttribute("inert", "");
      if (state === "detached") root.remove();
      if (state === "composition") editor.input.dispatchEvent(new CompositionEvent("compositionstart"));
      button("Bold").click();
      await settle();
      expect(editor.input.value).toBe("word");
      expect(onInput).not.toHaveBeenCalled();
    });

  it("leaves composing shortcuts and shortcuts outside the source alone", () => {
    expect(shortcut("b", { isComposing: true }).defaultPrevented).toBe(false);
    editor.input.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(shortcut("b").defaultPrevented).toBe(false);
    editor.input.dispatchEvent(new CompositionEvent("compositionend"));
    const event = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true });
    button("Format Markdown").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.input.value).toBe("word");
  });

  it("reports unsupported multiline link/code without mutating source or selection", async () => {
    editor.setDocument({ id: "a", name: "a.md", text: "one\ntwo" });
    editor.input.setSelectionRange(0, 7, "backward");
    button("Link").click();
    await settle();
    expect(root.querySelector(".editor-format-status")?.textContent).toBe("Select one line for a link.");
    expect(editor.input.value).toBe("one\ntwo");
    expect([editor.input.selectionStart, editor.input.selectionEnd, editor.input.selectionDirection]).toEqual([0, 7, "backward"]);
    expect(onInput).not.toHaveBeenCalled();
  });

  it.each([["i", "\\*word*", 2, 6], ["b", "**one** and **two**", 0, 19],
    ["k", "[label](url \"title\")", 1, 6]] as const)(
    "discloses an accurate refusal for ambiguous %s without changing source or selection", async (key, source, start, end) => {
      editor.setDocument({ id: "a", name: "a.md", text: source });
      editor.input.focus();
      editor.input.setSelectionRange(start, end, "backward");
      shortcut(key);
      await settle();
      expect(editor.input.value).toBe(source);
      expect([editor.input.selectionStart, editor.input.selectionEnd, editor.input.selectionDirection]).toEqual([start, end, "backward"]);
      expect(root.querySelector(".editor-format-status")?.textContent).toContain("cannot be formatted safely");
      expect(root.querySelector(".editor-format-status")?.textContent).not.toContain("one line");
      expect(button("Format Markdown").getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(editor.input);
      expect(onInput).not.toHaveBeenCalled();
    });

  it("restores the final multiline selection when one native command emits multiple input events", async () => {
    editor.setDocument({ id: "a", name: "a.md", text: "first\nsecond" });
    editor.input.focus();
    editor.input.setSelectionRange(0, 12, "backward");
    const execCommand = vi.fn((_command: string, _showUI: boolean, text: string) => {
      const target = editor.input;
      for (const value of [text.split("\n")[0] ?? "", text]) {
        target.value = value;
        target.setSelectionRange(value.length, value.length);
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      }
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    try {
      button("Task list").click();
      await settle();
      expect(editor.input.value).toBe("- [ ] first\n- [ ] second");
      expect([editor.input.selectionStart, editor.input.selectionEnd, editor.input.selectionDirection]).toEqual([0, 24, "backward"]);
      expect(execCommand).toHaveBeenCalledOnce();
      expect(onInput).toHaveBeenCalledTimes(2); // Only the actual native events, no synthetic duplicate.
    } finally {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it("does not mistake a re-entrant host input for another event of the native command", async () => {
    let reentered = false;
    mount({ onInput: () => {
      if (reentered) return;
      reentered = true;
      editor.input.dispatchEvent(new Event("input", { bubbles: true }));
    } });
    button("Bold").click();
    await settle();
    expect(editor.input.value).toBe("**word**");
    expect([editor.input.selectionStart, editor.input.selectionEnd]).toEqual([8, 8]);
  });

  it.each(["switch", "selection", "edit", "focus", "close", "destroy"])(
    "rejects late confirmation after %s without restoring stale selection", async (action) => {
      let resolve!: (accepted: boolean) => void;
      const confirmation = new Promise<boolean>((done) => { resolve = done; });
      mount({ largeInsertBytes: 5, confirmLargeInsert: () => confirmation });
      button("Format Markdown").click();
      button("Bold").focus();
      button("Bold").click();
      if (action === "switch") editor.setDocument({ id: "b", name: "a.md", text: "word" });
      if (action === "selection") editor.input.setSelectionRange(1, 1);
      if (action === "edit") {
        editor.input.value = "new";
        editor.input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (action === "focus") button("Format Markdown").focus();
      if (action === "close") button("Close formatting").click();
      if (action === "destroy") editor.destroy();
      resolve(true);
      await settle();
      expect(editor.input.value).toBe(action === "edit" ? "new" : "word");
      expect(onInput).not.toHaveBeenCalledWith("**word**");
      if (action === "selection") expect(editor.input.selectionStart).toBe(1);
    });

  it("counts UTF-8 source bytes and refuses a formatting command above the hard limit", async () => {
    const confirmLargeInsert = vi.fn(async () => true);
    mount({ hardLimitBytes: 8, confirmLargeInsert });
    editor.setDocument({ id: "a", name: "a.md", text: "😀é" });
    editor.input.setSelectionRange(0, 3);
    button("Bold").click();
    await settle();
    expect(confirmLargeInsert).toHaveBeenCalledExactlyOnceWith(10);
    expect(editor.input.value).toBe("😀é");
    expect(onInput).not.toHaveBeenCalled();
  });

  it("keeps first-command adoption and its placeholder selection on the same input", async () => {
    mount({ onInput: text => editor.setDocument({ id: "typed", name: "Untitled.md", text }) });
    editor.setDocument(null);
    const initial = editor.input;
    shortcut("b");
    await settle();
    expect(editor.input).toBe(initial);
    expect(editor.input.value).toBe("**text**");
    expect([editor.input.selectionStart, editor.input.selectionEnd]).toEqual([2, 6]);
  });

  it("does not apply a final selection to a document switched during the input callback", async () => {
    mount({ onInput: () => {
      editor.setDocument({ id: "b", name: "b.md", text: "replacement" });
      editor.input.setSelectionRange(3, 3);
    } });
    button("Bold").click();
    await settle();
    expect(editor.input.value).toBe("replacement");
    expect([editor.input.selectionStart, editor.input.selectionEnd]).toEqual([3, 3]);
  });

  it("preserves a re-entrant input observer's newer selection", async () => {
    editor.input.addEventListener("input", () => editor.input.setSelectionRange(1, 1));
    button("Bold").click();
    await settle();
    expect(editor.input.value).toBe("**word**");
    expect([editor.input.selectionStart, editor.input.selectionEnd]).toEqual([1, 1]);
  });
});
