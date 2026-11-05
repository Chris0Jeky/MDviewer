import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountEditor, type EditorController, type EditorOptions } from "../src/ui/Editor";

vi.mock("../src/render/highlight", () => ({
  CODE_THEME_PAIRS: { github: { light: "github-light", dark: "github-dark" } },
  getHighlighter: vi.fn(async () => ({
    codeToTokens: (text: string) => ({ tokens: [[{ content: text }]] }),
  })),
}));

function deferred() {
  let resolve!: (value: boolean) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function textTransfer(kind: "paste" | "drop", text: string): Event {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(event, kind === "paste" ? "clipboardData" : "dataTransfer", {
    value: { types: ["text/plain"], getData: (type: string) => type === "text/plain" ? text : "" },
  });
  return event;
}

let root: HTMLElement;
let editor: EditorController;
const onInput = vi.fn();

function mount(options: Partial<EditorOptions> = {}): void {
  editor?.destroy();
  editor = mountEditor(root, { codeTheme: "github", onInput, ...options });
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.append(root);
  onInput.mockClear();
  mount();
});

afterEach(() => {
  editor.destroy();
  vi.useRealTimers();
});

describe("Editor: delayed insert ownership", () => {
  it.each(["paste", "drop"] as const)("drops a late %s after switching documents", async (kind) => {
    const confirmation = deferred();
    mount({ largeInsertBytes: 100, confirmLargeInsert: () => confirmation.promise });
    editor.setDocument({ id: "a", name: "a.md", text: "before" });
    editor.input.setSelectionRange(6, 6);
    const event = textTransfer(kind, "x".repeat(101));
    editor.input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    editor.setDocument({ id: "b", name: "b.md", text: "other document" });
    confirmation.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.input.value).toBe("other document");
    expect(onInput).not.toHaveBeenCalled();
  });

  it("fences an equal-text document switch even when names also match", async () => {
    const confirmation = deferred();
    mount({ largeInsertBytes: 100, confirmLargeInsert: () => confirmation.promise });
    editor.setDocument({ id: "a", name: "same.md", text: "same" });
    editor.input.setSelectionRange(4, 4);
    editor.input.dispatchEvent(textTransfer("paste", "x".repeat(101)));
    editor.setDocument({ id: "b", name: "same.md", text: "same" });
    confirmation.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.input.value).toBe("same");
    expect(onInput).not.toHaveBeenCalled();
  });

  it("drops a late paste after the selection moves", async () => {
    const confirmation = deferred();
    mount({ largeInsertBytes: 100, confirmLargeInsert: () => confirmation.promise });
    editor.setDocument({ id: "a", name: "a.md", text: "before" });
    editor.input.setSelectionRange(6, 6);
    editor.input.dispatchEvent(textTransfer("paste", "x".repeat(101)));
    editor.input.setSelectionRange(0, 0);
    confirmation.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.input.value).toBe("before");
    expect(editor.input.selectionStart).toBe(0);
    expect(onInput).not.toHaveBeenCalled();
  });

  it.each(["destroy", "detach"] as const)("drops a late paste after %s", async (action) => {
    const confirmation = deferred();
    mount({ largeInsertBytes: 100, confirmLargeInsert: () => confirmation.promise });
    editor.setDocument({ id: "a", name: "a.md", text: "before" });
    editor.input.dispatchEvent(textTransfer("paste", "x".repeat(101)));
    if (action === "destroy") editor.destroy();
    else root.remove();
    confirmation.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(editor.input.value).toBe("before");
    expect(onInput).not.toHaveBeenCalled();
  });
});

describe("Editor: guarded replacements", () => {
  it("replaces the requested range and reports exactly one observable input", async () => {
    editor.setDocument({ id: "a", name: "a.md", text: "zero one two" });
    editor.input.setSelectionRange(0, 0);
    const observer = vi.fn();
    editor.input.addEventListener("input", observer);
    expect(await editor.replaceRange(5, 8, "ONE")).toBe(true);
    expect(editor.input.value).toBe("zero ONE two");
    expect(editor.input.selectionStart).toBe(8);
    expect(editor.input.selectionEnd).toBe(8);
    expect(onInput).toHaveBeenCalledExactlyOnceWith("zero ONE two");
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it("uses native insertText without duplicating its input event", async () => {
    editor.setDocument({ id: "a", name: "a.md", text: "abc" });
    const execCommand = vi.fn((_command: string, _showUI: boolean, text: string) => {
      expect(document.activeElement).toBe(editor.input);
      expect([editor.input.selectionStart, editor.input.selectionEnd]).toEqual([1, 2]);
      editor.input.setRangeText(text, 1, 2, "end");
      editor.input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    try {
      expect(await editor.replaceRange(1, 2, "X")).toBe(true);
      expect(execCommand).toHaveBeenCalledExactlyOnceWith("insertText", false, "X");
      expect(editor.input.value).toBe("aXc");
      expect(onInput).toHaveBeenCalledExactlyOnceWith("aXc");
    } finally {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it.each([[NaN, 0], [-1, 0], [2, 1], [0, 4], [0.5, 1]])(
    "refuses invalid range %s..%s without touching the source", async (start, end) => {
      editor.setDocument({ id: "a", name: "a.md", text: "abc" });
      expect(await editor.replaceRange(start, end, "X")).toBe(false);
      expect(editor.input.value).toBe("abc");
      expect(onInput).not.toHaveBeenCalled();
    },
  );

  it("does not create an edit for an identical replacement", async () => {
    editor.setDocument({ id: "a", name: "a.md", text: "abc" });
    editor.input.setSelectionRange(0, 0);
    expect(await editor.replaceRange(1, 2, "b")).toBe(false);
    expect(editor.input.selectionStart).toBe(0);
    expect(onInput).not.toHaveBeenCalled();
  });

  it.each(["value", "input-undo", "document-return", "selection-return", "composition"] as const)(
    "rejects delayed replacement after %s changes", async (change) => {
      const confirmation = deferred();
      mount({ largeInsertBytes: 100, confirmLargeInsert: () => confirmation.promise });
      const original = { id: "a", name: "a.md", text: "before" };
      editor.setDocument(original);
      editor.input.setSelectionRange(6, 6);
      const result = editor.replaceRange(0, 1, "x".repeat(101));
      if (change === "value" || change === "input-undo") {
        editor.input.value = "changed";
        if (change === "input-undo") {
          editor.input.dispatchEvent(new Event("input"));
          editor.input.value = original.text;
          editor.input.dispatchEvent(new Event("input"));
        }
      } else if (change === "document-return") {
        editor.setDocument({ id: "b", name: "b.md", text: "other" });
        editor.setDocument(original);
      } else if (change === "selection-return") {
        editor.input.setSelectionRange(0, 0);
        editor.input.dispatchEvent(new Event("select"));
        editor.input.setSelectionRange(6, 6);
        editor.input.dispatchEvent(new Event("select"));
      } else {
        editor.input.dispatchEvent(new CompositionEvent("compositionstart"));
        editor.input.dispatchEvent(new CompositionEvent("compositionend"));
      }
      const retained = editor.input.value;
      onInput.mockClear();
      confirmation.resolve(true);
      expect(await result).toBe(false);
      expect(editor.input.value).toBe(retained);
      expect(onInput).not.toHaveBeenCalled();
    },
  );

  it("accepts a delayed replacement after a passive update of the same document", async () => {
    const confirmation = deferred();
    mount({ largeInsertBytes: 100, confirmLargeInsert: () => confirmation.promise });
    editor.setDocument({ id: "a", name: "a.md", text: "abc" });
    editor.input.setSelectionRange(0, 0);
    const result = editor.replaceRange(1, 2, "x".repeat(101));
    editor.setDocument({ id: "a", name: "renamed.md", text: "abc" });
    expect(editor.input.selectionStart).toBe(0);
    confirmation.resolve(true);
    expect(await result).toBe(true);
    expect(editor.input.value).toBe("a" + "x".repeat(101) + "c");
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it("rechecks ownership after focusing the textarea", async () => {
    editor.setDocument({ id: "a", name: "a.md", text: "abc" });
    editor.input.addEventListener("focus", () => {
      editor.setDocument({ id: "b", name: "b.md", text: "other" });
    }, { once: true });
    expect(await editor.replaceRange(1, 2, "X")).toBe(false);
    expect(editor.input.value).toBe("other");
    expect(onInput).not.toHaveBeenCalled();
  });

  it.each(["before", "during"] as const)("honors cancellation %s confirmation", async (when) => {
    const confirmation = deferred();
    const confirmLargeInsert = vi.fn(() => confirmation.promise);
    mount({ largeInsertBytes: 100, confirmLargeInsert });
    editor.setDocument({ id: "a", name: "a.md", text: "abc" });
    const abort = new AbortController();
    if (when === "before") abort.abort();
    const result = editor.replaceRange(1, 2, "x".repeat(101), abort.signal);
    abort.abort();
    confirmation.resolve(true);
    expect(await result).toBe(false);
    expect(confirmLargeInsert).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
    expect(editor.input.value).toBe("abc");
    expect(onInput).not.toHaveBeenCalled();
  });

  it.each(["throw", "reject"] as const)("treats confirmer %s as refusal", async (failure) => {
    mount({ largeInsertBytes: 100, confirmLargeInsert: () => {
      if (failure === "throw") throw new Error("confirmation unavailable");
      return Promise.reject(new Error("confirmation unavailable"));
    } });
    editor.setDocument({ id: "a", name: "a.md", text: "abc" });
    expect(await editor.replaceRange(1, 2, "x".repeat(101))).toBe(false);
    expect(editor.input.value).toBe("abc");
    expect(onInput).not.toHaveBeenCalled();
  });

  it("enforces the UTF-8 hard limit even if the host returns true", async () => {
    const confirmLargeInsert = vi.fn(async () => true);
    mount({ hardLimitBytes: 7, confirmLargeInsert });
    editor.setDocument({ id: "a", name: "a.md", text: "1234" });
    expect(await editor.replaceRange(4, 4, "\u{1F600}")).toBe(false);
    expect(confirmLargeInsert).toHaveBeenCalledExactlyOnceWith(8);
    expect(editor.input.value).toBe("1234");
    expect(onInput).not.toHaveBeenCalled();
  });

  it("enforces the hard limit without a soft threshold or confirmer", async () => {
    mount({ hardLimitBytes: 4 });
    editor.setDocument({ id: "a", name: "a.md", text: "1234" });
    expect(await editor.replaceRange(4, 4, "5")).toBe(false);
    expect(editor.input.value).toBe("1234");
    expect(onInput).not.toHaveBeenCalled();
  });

  it("leaves IME composition alone for replacement and Tab", async () => {
    editor.setDocument({ id: "a", name: "a.md", text: "abc" });
    editor.input.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(await editor.replaceRange(1, 2, "X")).toBe(false);
    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    editor.input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.input.value).toBe("abc");
    expect(onInput).not.toHaveBeenCalled();
    editor.input.dispatchEvent(new CompositionEvent("compositionend"));
    expect(await editor.replaceRange(1, 2, "X")).toBe(true);
  });
});
