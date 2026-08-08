import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import { ATTRS, IDS } from "../src/app/dom";

/**
 * The editor asks `getHighlighter()` for a Shiki core instance and paints its
 * tokens. Shiki's real engine loads Oniguruma WASM, which is neither available nor
 * meaningful under jsdom, so the module is stubbed with a tokenizer whose shape
 * matches `HighlighterCore.codeToTokens` (one token per line, carrying htmlStyle).
 * That keeps this test about the editor's own contract: metrics-identical layers,
 * safe text insertion, debounce/race handling, and the highlight-off fallback.
 */
const codeToTokens = vi.fn((code: string) => ({
  tokens: code.split("\n").map((line) => [
    { content: line, htmlStyle: { color: "#005cc5", "--shiki-dark": "#79b8ff" } },
  ]),
}));

vi.mock("../src/render/highlight", async () => {
  const actual = await vi.importActual<typeof import("../src/render/highlight")>(
    "../src/render/highlight",
  );
  return {
    ...actual,
    getHighlighter: vi.fn(async () => ({ codeToTokens })),
  };
});

const { mountEditor, countWords, formatSize, HIGHLIGHT_MAX_CHARS } = await import(
  "../src/ui/Editor"
);

let root: HTMLElement;
let editor: ReturnType<typeof mountEditor>;
let onInput: Mock<(text: string) => void>;

function pane(): HTMLElement {
  const el = document.getElementById(IDS.editorPane);
  if (!el) throw new Error("editor pane not mounted");
  return el;
}

/** Let the 90ms highlight debounce fire and its awaited highlighter resolve. */
async function settleHighlight(): Promise<void> {
  await vi.advanceTimersByTimeAsync(120);
  await vi.advanceTimersByTimeAsync(0);
}

/** Simulate real typing: set the value then fire the native input event. */
function type(text: string): void {
  editor.input.value = text;
  editor.input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  codeToTokens.mockClear();
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.append(root);
  onInput = vi.fn<(text: string) => void>();
  editor = mountEditor(root, { codeTheme: "github", onInput });
});

afterEach(() => {
  editor.destroy();
  vi.useRealTimers();
});

describe("Editor: structure", () => {
  it("mounts a labelled pane with the textarea and the backdrop layers", () => {
    expect(pane().getAttribute("aria-label")).toBe("Markdown source");
    expect(editor.input.id).toBe(IDS.editorInput);
    expect(editor.input.tagName).toBe("TEXTAREA");
    expect(document.getElementById(IDS.editorHighlight)).not.toBeNull();
    // The backdrop is decoration only — never announced, never focusable.
    expect(document.getElementById(IDS.editorHighlight)?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("starts with highlighting off so an empty app never loads the Shiki engine", async () => {
    expect(pane().getAttribute(ATTRS.highlightState)).toBe("off");
    await settleHighlight();
    expect(codeToTokens).not.toHaveBeenCalled();
  });
});

describe("Editor: editing", () => {
  it("reports every edit to onInput with the full text", () => {
    type("# Title");
    expect(onInput).toHaveBeenCalledWith("# Title");
    type("# Title\n\nBody");
    expect(onInput).toHaveBeenLastCalledWith("# Title\n\nBody");
  });

  it("paints the syntax backdrop after the debounce", async () => {
    type("# Title\n\n- item");
    await settleHighlight();

    expect(pane().getAttribute(ATTRS.highlightState)).toBe("on");
    const backdrop = document.getElementById(IDS.editorHighlight)!;
    // The backdrop must carry exactly the source text so the transparent glyphs
    // above it line up character for character.
    expect(backdrop.textContent).toBe("# Title\n\n- item");
    expect(backdrop.querySelectorAll("span[style]").length).toBeGreaterThan(0);
  });

  it("inserts token text as text nodes, never as markup", async () => {
    type("<img src=x onerror=alert(1)>");
    await settleHighlight();
    const backdrop = document.getElementById(IDS.editorHighlight)!;
    expect(backdrop.querySelector("img")).toBeNull();
    expect(backdrop.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("coalesces bursts of keystrokes into a single tokenize pass", async () => {
    type("a");
    type("ab");
    type("abc");
    await settleHighlight();
    expect(codeToTokens).toHaveBeenCalledTimes(1);
    expect(codeToTokens).toHaveBeenLastCalledWith("abc", expect.anything());
  });

  it("keeps the size stat live and settles the word count on the debounce", async () => {
    type("one two three");
    // The size is O(1), so it must be right immediately.
    expect(pane().textContent).toContain("13 chars");
    await settleHighlight();
    expect(pane().textContent).toContain("3 words");
  });

  /**
   * countWords is O(n) and allocates one string per word. Running it per keystroke
   * freezes the pane on a large document — and would do so even above
   * HIGHLIGHT_MAX_CHARS, where highlighting has already been dropped for cost.
   */
  it("does not recount words on every keystroke", async () => {
    type("a");
    type("a b");
    type("a b c");
    type("a b c d");
    await settleHighlight();
    expect(pane().textContent).toContain("4 words");
  });

  /**
   * With the backdrop on, the textarea's own glyphs are transparent, so the backdrop
   * is the only visible copy of the source. If it only caught up after the debounce,
   * continuous typing would leave newly typed characters invisible and deleted ones
   * still painted until the user paused.
   */
  it("shows typed text immediately, before the tokenizer runs", () => {
    type("# Draft");
    const backdrop = document.getElementById(IDS.editorHighlight)!;
    expect(pane().getAttribute(ATTRS.highlightState)).toBe("on");
    expect(backdrop.textContent).toBe("# Draft");
    expect(codeToTokens).not.toHaveBeenCalled();
  });

  it("keeps the backdrop equal to the textarea through a burst of edits", () => {
    const backdrop = document.getElementById(IDS.editorHighlight)!;
    for (const text of ["#", "# H", "# He", "# Hell", "# Hello", "# Hell", "# He"]) {
      type(text);
      expect(backdrop.textContent).toBe(editor.input.value);
    }
    expect(codeToTokens).not.toHaveBeenCalled();
  });

  /**
   * Replacing the backdrop's content resets its scroll height, and the browser will
   * already have clamped its scrollTop against the *previous*, shorter content (an
   * empty backdrop on first load). Without re-copying the textarea's position the
   * colors end up at a different vertical offset from the caret.
   *
   * jsdom has no layout, so both scroll properties are stubbed and the assertion is
   * on the contract: after any repaint, the backdrop is told the textarea's position.
   */
  it("re-syncs the backdrop's scroll position after every repaint", async () => {
    const backdrop = document.getElementById(IDS.editorHighlight)!;
    let written = -1;
    Object.defineProperty(editor.input, "scrollTop", { value: 240, configurable: true });
    Object.defineProperty(backdrop, "scrollTop", {
      configurable: true,
      get: () => written,
      set: (v: number) => {
        written = v;
      },
    });

    // The immediate plain paint.
    type("line\n".repeat(200));
    expect(written).toBe(240);

    // And again once the tokenized DOM replaces it.
    written = -1;
    await settleHighlight();
    expect(codeToTokens).toHaveBeenCalled();
    expect(written).toBe(240);
  });

  it("the immediate paint is plain text — never markup", () => {
    type("<script>alert(1)</script>");
    const backdrop = document.getElementById(IDS.editorHighlight)!;
    expect(backdrop.querySelector("script")).toBeNull();
    expect(backdrop.textContent).toBe("<script>alert(1)</script>");
  });

  it("Tab inserts a tab character instead of leaving the field", () => {
    type("ab");
    editor.input.selectionStart = editor.input.selectionEnd = 2;
    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    editor.input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.input.value).toBe("ab\t");
    expect(onInput).toHaveBeenLastCalledWith("ab\t");
  });

  /**
   * execCommand("insertText") is the only insertion path browsers record in a
   * textarea's native undo stack. jsdom does not implement it, so this asserts the
   * documented fallback: the manual splice still runs and still reports the edit.
   */
  it("Tab prefers the undo-aware insertion path and falls back when unavailable", () => {
    const execCommand = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = execCommand;
    try {
      type("ab");
      editor.input.selectionStart = editor.input.selectionEnd = 2;
      editor.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
      expect(execCommand).toHaveBeenCalledWith("insertText", false, "\t");
      // The command reported success, so the manual splice must NOT also run —
      // a real browser dispatches its own input event for it.
      expect(editor.input.value).toBe("ab");
    } finally {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    // Fallback path: no execCommand at all (the jsdom default).
    editor.input.selectionStart = editor.input.selectionEnd = 2;
    editor.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    expect(editor.input.value).toBe("ab\t");
    expect(onInput).toHaveBeenLastCalledWith("ab\t");
  });

  it("Shift+Tab is left alone so the pane is not a keyboard trap", () => {
    type("ab");
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });
    editor.input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.input.value).toBe("ab");
  });
});

describe("Editor: oversized documents", () => {
  it("switches highlighting off past HIGHLIGHT_MAX_CHARS but keeps the text", async () => {
    const huge = "x".repeat(HIGHLIGHT_MAX_CHARS + 1);
    type(huge);
    await settleHighlight();

    expect(pane().getAttribute(ATTRS.highlightState)).toBe("off");
    expect(codeToTokens).not.toHaveBeenCalled();
    expect(editor.input.value).toBe(huge);
    expect(onInput).toHaveBeenLastCalledWith(huge);
  });
});

describe("Editor: setDocument", () => {
  it("seeds the pane from an opened document", async () => {
    editor.setDocument({ name: "paper.md", text: "# Paper" });
    expect(editor.input.value).toBe("# Paper");
    expect(pane().textContent).toContain("paper.md");
    await settleHighlight();
    expect(pane().getAttribute(ATTRS.highlightState)).toBe("on");
  });

  it("does not disturb the caret when the text already matches", () => {
    type("# Same");
    editor.input.selectionStart = editor.input.selectionEnd = 3;
    editor.setDocument({ name: "same.md", text: "# Same" });
    expect(editor.input.selectionStart).toBe(3);
    // The name still updates — only the text write is skipped.
    expect(pane().textContent).toContain("same.md");
  });

  it("clearing the document empties the editor and turns highlighting off", async () => {
    editor.setDocument({ name: "a.md", text: "# A" });
    await settleHighlight();
    editor.setDocument(null);
    await settleHighlight();
    expect(editor.input.value).toBe("");
    expect(pane().getAttribute(ATTRS.highlightState)).toBe("off");
  });
});

describe("Editor: code theme", () => {
  it("re-tokenizes with the new theme pair", async () => {
    type("# Title");
    await settleHighlight();
    codeToTokens.mockClear();

    editor.setCodeTheme("nord");
    await settleHighlight();
    expect(codeToTokens).toHaveBeenCalledWith(
      "# Title",
      expect.objectContaining({ themes: { light: "nord", dark: "nord" } }),
    );
  });

  it("ignores a no-op theme change", async () => {
    type("# Title");
    await settleHighlight();
    codeToTokens.mockClear();
    editor.setCodeTheme("github");
    await settleHighlight();
    expect(codeToTokens).not.toHaveBeenCalled();
  });
});

describe("Editor: teardown", () => {
  it("destroy() removes the pane and stops reporting edits", () => {
    const input = editor.input;
    editor.destroy();
    expect(document.getElementById(IDS.editorPane)).toBeNull();
    onInput.mockClear();
    input.value = "after";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onInput).not.toHaveBeenCalled();
  });
});

describe("Editor: header helpers", () => {
  it("countWords counts whitespace-separated runs", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n  ")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords("one  two\nthree\tfour")).toBe(4);
  });

  it("formatSize reports characters below 1 KB and kilobytes above", () => {
    expect(formatSize(0)).toBe("0 chars");
    expect(formatSize(1)).toBe("1 char");
    expect(formatSize(1023)).toBe("1023 chars");
    expect(formatSize(2048)).toBe("2.0 KB");
  });
});
