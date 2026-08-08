/**
 * Editor — the Markdown source pane.
 *
 * A plain `<textarea>` carries all input (native undo/redo, IME, selection, spell
 * control, accessibility) while a non-interactive `<pre>` backdrop sitting exactly
 * underneath it paints Shiki's Markdown syntax colors. The textarea's own glyphs are
 * transparent, so the user appears to type directly into highlighted text.
 *
 * Two properties keep that illusion honest and are the reason for the CSS in
 * editor.css: both layers must share identical box metrics (font, size, line-height,
 * padding, wrapping), and the backdrop must follow the textarea's scroll position.
 *
 * Safety: the backdrop is built from Shiki's *token* API and inserted with
 * `textContent` + `CSSStyleDeclaration.setProperty` — never `innerHTML`. Document
 * text therefore cannot be parsed as markup on this path at all, which is a stronger
 * guarantee than sanitizing generated HTML, and it costs no DOMPurify pass per
 * keystroke.
 *
 * Local-first: nothing here persists or transmits document text.
 */

import { ATTRS, CLASSES, IDS, el } from "../app/dom";
import type { CodeThemeId } from "../app/settings";
import { CODE_THEME_PAIRS, getHighlighter } from "../render/highlight";

export interface EditorController {
  /** The editable textarea (`#editor-input`). */
  input: HTMLTextAreaElement;
  /**
   * Seed the editor from outside (a file opened, a document switched). Re-highlights.
   * A no-op when the text already matches, so it can never disturb a live caret.
   */
  setDocument(doc: { name: string; text: string } | null): void;
  /** Re-highlight with a different Shiki theme family (the toolbar's code theme). */
  setCodeTheme(theme: CodeThemeId): void;
  /** Move keyboard focus into the source text. */
  focus(): void;
  destroy(): void;
}

export interface EditorOptions {
  /** Fires on every edit with the full current text. */
  onInput(text: string): void;
  /** Initial Shiki theme family; kept in sync via `setCodeTheme`. */
  codeTheme: CodeThemeId;
  /** Placeholder shown while the editor is empty. */
  placeholder?: string;
}

/**
 * Above this many characters the syntax backdrop is switched off and the textarea
 * paints its own plain text. Tokenizing a novel-sized document on every keystroke
 * would cost more main-thread time than the pagination it feeds.
 */
export const HIGHLIGHT_MAX_CHARS = 120_000;

/** Debounce for re-tokenizing. Shorter than the 250ms content render so colors lead. */
const HIGHLIGHT_DEBOUNCE_MS = 90;

/** Word count used by the pane header; whitespace-separated runs, cheap and good enough. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** "12.3 KB" / "834 B" for the header stat line. */
export function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} char${chars === 1 ? "" : "s"}`;
  return `${(chars / 1024).toFixed(1)} KB`;
}

/**
 * Mount the editor pane into `root`.
 *
 * The returned controller is imperative on purpose: App owns the document state and
 * pushes into the editor, while the editor pushes edits back out through `onInput`.
 * There is no shared mutable state between them.
 */
export function mountEditor(root: HTMLElement, opts: EditorOptions): EditorController {
  let codeTheme = opts.codeTheme;
  /** Monotonic token so a slow tokenize can never repaint over newer text. */
  let highlightToken = 0;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  const pane = el("section", {
    id: IDS.editorPane,
    class: "editor-pane",
    attrs: {
      "aria-label": "Markdown source",
      // Starts "off": an empty editor must not pay the Shiki/WASM startup cost.
      [ATTRS.highlightState]: "off",
    },
  });

  // ---- Header: file name + live size stat ----
  const fileNameEl = el("span", { class: "editor-name" }, "Untitled.md");
  const statEl = el("span", { class: "editor-stat" }, "0 words");
  const head = el(
    "div",
    { class: CLASSES.editorHead, attrs: { "aria-hidden": "true" } },
    fileNameEl,
    statEl,
  );

  // ---- Layers: highlight backdrop under a transparent-text textarea ----
  const highlight = el("pre", {
    id: IDS.editorHighlight,
    class: "editor-highlight",
    attrs: { "aria-hidden": "true" },
  });
  const highlightCode = el("code", { class: "editor-highlight-code" });
  highlight.append(highlightCode);

  const input = el("textarea", {
    id: IDS.editorInput,
    class: "editor-input",
    spellcheck: false,
    placeholder: opts.placeholder ?? "Type or paste Markdown here…",
    attrs: {
      "aria-label": "Markdown source",
      autocomplete: "off",
      autocapitalize: "off",
      autocorrect: "off",
      wrap: "soft",
    },
  });

  const scroll = el("div", { class: CLASSES.editorScroll }, highlight, input);
  pane.append(head, scroll);
  root.append(pane);

  // ---- Backdrop painting -----------------------------------------------------

  /** Show the textarea's own text and blank the backdrop (large docs, or pre-Shiki). */
  function disableHighlight(): void {
    pane.setAttribute(ATTRS.highlightState, "off");
    highlightCode.replaceChildren();
  }

  /**
   * Build one `<span class="editor-line">` per source line containing per-token spans.
   * Trailing "\n" is materialized as a final empty line so the backdrop's scroll height
   * matches a textarea whose text ends in a newline.
   */
  function paintTokens(lines: Array<Array<{ content: string; htmlStyle?: Record<string, string> }>>): void {
    const frag = document.createDocumentFragment();
    lines.forEach((tokens, index) => {
      const line = el("span", { class: CLASSES.editorLine });
      for (const token of tokens) {
        const span = document.createElement("span");
        span.textContent = token.content;
        if (token.htmlStyle) {
          for (const [prop, value] of Object.entries(token.htmlStyle)) {
            span.style.setProperty(prop, value);
          }
        }
        line.append(span);
      }
      frag.append(line);
      if (index < lines.length - 1) frag.append(document.createTextNode("\n"));
    });
    highlightCode.replaceChildren(frag);
    pane.setAttribute(ATTRS.highlightState, "on");
  }

  async function highlightNow(text: string): Promise<void> {
    const token = ++highlightToken;
    if (!text || text.length > HIGHLIGHT_MAX_CHARS) {
      disableHighlight();
      return;
    }
    try {
      const hl = await getHighlighter();
      if (destroyed || token !== highlightToken) return;
      const pair = CODE_THEME_PAIRS[codeTheme];
      const result = hl.codeToTokens(text, {
        lang: "markdown",
        themes: { light: pair.light, dark: pair.dark },
        defaultColor: "light",
        cssVariablePrefix: "--shiki-",
      });
      if (destroyed || token !== highlightToken) return;
      paintTokens(result.tokens);
    } catch {
      // Highlighting is decoration. A grammar/engine failure must never cost the
      // user their text, so fall back to the plain textarea rendering.
      if (!destroyed && token === highlightToken) disableHighlight();
    }
  }

  function scheduleHighlight(text: string): void {
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightTimer = undefined;
      void highlightNow(text);
    }, HIGHLIGHT_DEBOUNCE_MS);
  }

  function syncStat(text: string): void {
    const words = countWords(text);
    statEl.textContent = `${words} word${words === 1 ? "" : "s"} · ${formatSize(text.length)}`;
  }

  // ---- Events ----------------------------------------------------------------

  const onInputEvent = (): void => {
    const text = input.value;
    syncStat(text);
    scheduleHighlight(text);
    opts.onInput(text);
  };

  const onScroll = (): void => {
    // The backdrop is overflow:hidden; scrolling it programmatically keeps the two
    // layers glued together without a second scrollbar.
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
  };

  /**
   * Tab inserts a real tab instead of leaving the field. Shift+Tab and Escape still
   * move focus out, so the pane never becomes a keyboard trap.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = input;
    input.value = `${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`;
    input.selectionStart = input.selectionEnd = selectionStart + 1;
    onInputEvent();
  };

  input.addEventListener("input", onInputEvent);
  input.addEventListener("scroll", onScroll);
  input.addEventListener("keydown", onKeyDown);

  syncStat("");

  return {
    input,
    setDocument(doc): void {
      const text = doc?.text ?? "";
      fileNameEl.textContent = doc?.name ?? "Untitled.md";
      if (input.value === text) return;
      input.value = text;
      input.scrollTop = 0;
      onScroll();
      syncStat(text);
      scheduleHighlight(text);
    },
    setCodeTheme(next): void {
      if (next === codeTheme) return;
      codeTheme = next;
      scheduleHighlight(input.value);
    },
    focus(): void {
      input.focus();
    },
    destroy(): void {
      destroyed = true;
      if (highlightTimer) clearTimeout(highlightTimer);
      input.removeEventListener("input", onInputEvent);
      input.removeEventListener("scroll", onScroll);
      input.removeEventListener("keydown", onKeyDown);
      pane.remove();
    },
  };
}
