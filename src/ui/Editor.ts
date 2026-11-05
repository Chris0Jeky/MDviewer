/**
 * Editor — the Markdown source pane.
 *
 * A plain `<textarea>` carries all input (native undo/redo, IME, selection, spell
 * control, accessibility) while a non-interactive `<pre>` backdrop sitting exactly
 * underneath it paints Shiki's Markdown syntax colors. The textarea's own glyphs are
 * transparent, so the user appears to type directly into highlighted text.
 *
 * Three properties keep that illusion honest and are the reason for the CSS in
 * editor.css: both layers must share identical box metrics (font, size, line-height,
 * padding, wrapping, scrollbar gutter); the backdrop must follow the textarea's
 * scroll position; and — because the textarea's own glyphs are transparent whenever
 * the backdrop is on — the backdrop's text must equal the textarea's value at ALL
 * times, not merely once tokenizing settles. Every input therefore repaints the
 * backdrop synchronously in plain text; the debounced Shiki pass only recolors it.
 * Skipping that immediate paint makes freshly typed characters invisible and
 * freshly deleted ones linger until the user stops typing.
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
import { mountEditorSearch } from "./EditorSearch";
import { mountEditorFormatting } from "./EditorFormatting";
import type { MarkdownSelection } from "./MarkdownCommands";

export interface EditorController {
  /** The current textarea (`#editor-input`); reacquire after a document switch. */
  readonly input: HTMLTextAreaElement;
  /**
   * Seed the editor from outside (a file opened, a document switched). Re-highlights.
   * A same-document, same-text update preserves the caret and native undo history.
   * Hosts should supply stable ids; name is the compatibility fallback.
   */
  setDocument(doc: { id?: string; name: string; text: string } | null): void;
  /**
   * Replace a UTF-16 range through the paste admission and native undo path.
   * Returns false if refused, unchanged, aborted, detached, composing, or stale.
   * A delayed confirmation belongs to its original document, value, selection,
   * and focused element. An optional final selection is applied only to the
   * same editing host immediately after its accepted native command.
   */
  replaceRange(start: number, end: number, text: string, signal?: AbortSignal,
    selectionAfter?: MarkdownSelection): Promise<boolean>;
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
  /**
   * Byte size a paste or text drop may not cross without confirmation. An
   * insert is intercepted only when it grows the document from at or below
   * this to above it, or is itself larger than this; every other insert
   * (including small edits to a document already past the gate) proceeds
   * natively with no async hop, so the native undo entry is untouched.
   */
  largeInsertBytes?: number;
  /**
   * Byte size past which a paste, text drop, or explicit replacement is refused.
   * `confirmLargeInsert` is still called when supplied so the host can explain the
   * refusal. Unset means no hard limit. Ordinary typing remains native.
   */
  hardLimitBytes?: number;
  /**
   * Confirm an intercepted insert (see `largeInsertBytes`), given the
   * resulting document size. Resolve false to drop it, true to insert it (via
   * execCommand, so the native undo entry survives where the command exists).
   */
  confirmLargeInsert?(bytes: number): Promise<boolean>;
}

/**
 * Above this many characters the syntax backdrop is switched off and the textarea
 * paints its own plain text. Tokenizing a novel-sized document on every keystroke
 * would cost more main-thread time than the pagination it feeds.
 */
export const HIGHLIGHT_MAX_CHARS = 120_000;

/** Debounce for re-tokenizing. Shorter than the 250ms content render so colors lead. */
const HIGHLIGHT_DEBOUNCE_MS = 90;

/**
 * Word count used by the pane header; whitespace-separated runs, cheap and good enough.
 *
 * O(n) in the document and it allocates one string per word, so it is deliberately
 * NOT called from the input handler — see `scheduleStat`. On a multi-megabyte source
 * a per-keystroke call allocates millions of strings and freezes the pane, and it does
 * so even above HIGHLIGHT_MAX_CHARS where highlighting has already been given up for
 * exactly that reason.
 */
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
  /** Word counting is debounced separately from painting — see scheduleStat. */
  let statTimer: ReturnType<typeof setTimeout> | undefined;
  let wordCount = 0;
  let sizeChars = 0;
  let destroyed = false;
  let documentKey: string | null = null;
  // Also advances for edits that later undo back to the same text, so value equality
  // alone can never revive an old confirmation.
  let editRevision = 0;
  let composing = false;
  let reportingInput = false;

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
    { class: CLASSES.editorHead },
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

  const createInput = (): HTMLTextAreaElement => el("textarea", {
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
  let input = createInput();

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
   * Paint the source as one uncolored text node and turn the backdrop on.
   *
   * This runs synchronously on every edit so the visible glyphs are never stale: the
   * debounced tokenizer then replaces this with the same characters in color. A single
   * `textContent` write is orders of magnitude cheaper than tokenizing, which is what
   * makes it affordable per keystroke.
   */
  function paintPlain(text: string): void {
    highlightCode.replaceChildren(document.createTextNode(text));
    pane.setAttribute(ATTRS.highlightState, "on");
    onScroll();
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
    // Replacing the content resets the backdrop's scroll height, and the browser will
    // have clamped its scrollTop against whatever it held before (an empty backdrop on
    // first load, or the shorter previous text). Re-copy the textarea's position or the
    // colors sit at a different vertical offset from the caret.
    onScroll();
  }

  /**
   * Keep the backdrop showing exactly the current text, immediately.
   *
   * Above HIGHLIGHT_MAX_CHARS (and while empty) we hand painting back to the textarea
   * rather than writing a megabyte-sized text node per keystroke — the same threshold,
   * and the same reasoning, as the tokenizer.
   */
  function repaintNow(text: string): void {
    if (!text || text.length > HIGHLIGHT_MAX_CHARS) disableHighlight();
    else paintPlain(text);
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

  /** Queue a tokenize pass without touching what is currently painted. */
  function scheduleRecolor(text: string): void {
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightTimer = undefined;
      void highlightNow(text);
    }, HIGHLIGHT_DEBOUNCE_MS);
  }

  /**
   * Repaint the backdrop now, recolor it shortly. Both halves are required: the
   * immediate paint keeps the visible text correct, the debounce keeps tokenizing off
   * the keystroke path. Used wherever the *text* changed.
   */
  function scheduleHighlight(text: string): void {
    repaintNow(text);
    scheduleRecolor(text);
  }

  /** The document size — O(1), so it stays on the live keystroke path. */
  function syncSize(text: string): void {
    sizeChars = text.length;
    statEl.textContent = `${wordCount} word${wordCount === 1 ? "" : "s"} · ${formatSize(sizeChars)}`;
  }

  /**
   * The word count is O(n) and allocating, so it is recomputed on the same idle
   * debounce as the highlighting rather than per keystroke. The size beside it stays
   * live, so the header never looks frozen while the count catches up.
   */
  function scheduleStat(text: string): void {
    syncSize(text);
    if (statTimer) clearTimeout(statTimer);
    statTimer = setTimeout(() => {
      statTimer = undefined;
      wordCount = countWords(input.value);
      syncSize(input.value);
    }, HIGHLIGHT_DEBOUNCE_MS);
  }

  // ---- Events ----------------------------------------------------------------

  interface Insertion {
    target: HTMLTextAreaElement;
    events: number;
    trusted: boolean | null;
    interrupted: boolean;
  }
  let insertion: Insertion | undefined;

  const onInputEvent = (event: Event): void => {
    if (destroyed) return;
    if (insertion) {
      // A multiline native command can dispatch multiple input events.
      // Count the owned sequence; do not
      // mistake a host callback's re-entrant edit for part of that sequence.
      if (input !== insertion.target || event.target !== insertion.target || reportingInput ||
        (insertion.trusted !== null && insertion.trusted !== event.isTrusted)) insertion.interrupted = true;
      insertion.events++;
      insertion.trusted ??= event.isTrusted;
    }
    editRevision++;
    const text = input.value;
    scheduleStat(text);
    scheduleHighlight(text);
    search.sourceChanged();
    reportingInput = true;
    try {
      opts.onInput(text);
    } finally {
      reportingInput = false;
    }
  };

  // Declared (not assigned to a const) so the painters above can call it: they run
  // only from handlers and timers, but the hoist keeps that independent of ordering.
  function onScroll(): void {
    // The backdrop is overflow:hidden; scrolling it programmatically keeps the two
    // layers glued together without a second scrollbar.
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
  }

  /**
   * Tab inserts a real tab instead of leaving the field. Shift+Tab and Escape still
   * move focus out, so the pane never becomes a keyboard trap.
   *
   * `execCommand("insertText")` is deprecated but is the only insertion path browsers
   * record in a textarea's native undo stack. Rewriting `input.value` instead is a
   * programmatic write: it drops the entry, and in Chromium it discards the preceding
   * native history too, so Ctrl+Z after a Tab loses more than the tab. We fall back to
   * the manual splice where the command is unavailable or refused (jsdom, older
   * engines), accepting the weaker undo only when there is no alternative.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey ||
      event.isComposing || composing) {
      return;
    }
    event.preventDefault();
    void replaceRange(input.selectionStart, input.selectionEnd, "\t");
  };

  const selection = () => ({
    start: input.selectionStart,
    end: input.selectionEnd,
    direction: input.selectionDirection,
  });
  let lastSelection = selection();
  let selectionRevision = 0;
  const onSelect = (): void => {
    const next = selection();
    if (next.start !== lastSelection.start || next.end !== lastSelection.end ||
      next.direction !== lastSelection.direction) selectionRevision++;
    lastSelection = next;
  };
  const onCompositionStart = (): void => { composing = true; editRevision++; };
  const onCompositionEnd = (): void => { composing = false; };

  const canEdit = (): boolean => !destroyed && !composing && input.isConnected &&
    pane.contains(input) && !input.disabled && !input.readOnly && !input.closest("[inert]");

  const captureEdit = () => {
    // A queued select event from before the request must not invalidate it later.
    onSelect();
    return { value: input.value, documentKey, editRevision, selectionRevision,
      focused: document.activeElement, ...lastSelection };
  };
  type EditSnapshot = ReturnType<typeof captureEdit>;
  const ownsValue = (snapshot: EditSnapshot, signal?: AbortSignal): boolean =>
    canEdit() && !signal?.aborted && snapshot.documentKey === documentKey &&
    snapshot.editRevision === editRevision && snapshot.value === input.value;
  const isCurrent = (snapshot: EditSnapshot, signal?: AbortSignal): boolean =>
    ownsValue(snapshot, signal) && snapshot.selectionRevision === selectionRevision &&
    snapshot.start === input.selectionStart && snapshot.end === input.selectionEnd &&
    snapshot.direction === input.selectionDirection;

  const encoder = new TextEncoder();
  const admission = (value: string, start: number, end: number, text: string) => {
    const threshold = opts.largeInsertBytes ?? 0;
    const hardLimit = opts.hardLimitBytes ?? 0;
    if (threshold <= 0 && hardLimit <= 0) {
      return { needsConfirmation: false, exceedsHardLimit: false, nextBytes: 0 };
    }
    const currentBytes = encoder.encode(value).length;
    const textBytes = encoder.encode(text).length;
    const nextBytes = encoder.encode(value.slice(0, start) + text + value.slice(end)).length;
    const crossesGate = nextBytes > threshold && currentBytes <= threshold;
    const exceedsHardLimit = hardLimit > 0 && nextBytes > hardLimit;
    const needsConfirmation = exceedsHardLimit || (!!opts.confirmLargeInsert && threshold > 0 &&
      (crossesGate || textBytes > threshold));
    return { needsConfirmation, exceedsHardLimit, nextBytes };
  };

  /** Commit only after admission; a focus handler can also change the active document. */
  const insertTextPreservingUndo = (
    snapshot: EditSnapshot, start: number, end: number, text: string, signal?: AbortSignal,
    selectionAfter?: MarkdownSelection,
  ): boolean => {
    if (!isCurrent(snapshot, signal) || document.activeElement !== snapshot.focused) return false;
    input.focus();
    if (!isCurrent(snapshot, signal) || document.activeElement !== input) return false;
    input.setSelectionRange(start, end);
    const target = input;
    const previousInsertion = insertion;
    if (previousInsertion) previousInsertion.interrupted = true;
    const command: Insertion = { target, events: 0, trusted: null, interrupted: false };
    const expectedValue = `${snapshot.value.slice(0, start)}${text}${snapshot.value.slice(end)}`;
    const finish = (): void => {
      // Input handlers may synchronously switch documents or make another edit.
      // Only first-input adoption may advance ownership without replacing the host.
      const adoption = snapshot.documentKey === null && documentKey !== null ? 1 : 0;
      if (selectionAfter && !command.interrupted && command.events > 0 && input === target && canEdit() && !signal?.aborted &&
        input.value === expectedValue && editRevision === snapshot.editRevision + command.events + adoption &&
        document.activeElement === target && input.selectionStart === start + text.length &&
        input.selectionEnd === start + text.length) {
        input.setSelectionRange(selectionAfter.start, selectionAfter.end, selectionAfter.direction);
        onSelect();
      }
    };
    insertion = command;
    try {
      let inserted: boolean;
      try {
        inserted = document.execCommand("insertText", false, text);
      } catch {
        inserted = false;
      }
      if (inserted) { finish(); return true; }
      // A command that changed the source despite returning false must not be spliced
      // a second time. The same fence covers re-entrant event handlers.
      if (!ownsValue(snapshot, signal) || input.selectionStart !== start || input.selectionEnd !== end) {
        return false;
      }
      input.value = `${snapshot.value.slice(0, start)}${text}${snapshot.value.slice(end)}`;
      input.selectionStart = input.selectionEnd = start + text.length;
      // Native commands supply their own events; only the manual fallback needs one.
      input.dispatchEvent(new Event("input", { bubbles: true }));
      finish();
      return true;
    } finally {
      insertion = previousInsertion;
    }
  };

  const replaceCapturedRange = async (
    snapshot: EditSnapshot, start: number, end: number, text: string,
    gate: ReturnType<typeof admission>, signal?: AbortSignal,
    selectionAfter?: MarkdownSelection,
  ): Promise<boolean> => {
    if (!isCurrent(snapshot, signal)) return false;
    if (gate.needsConfirmation) {
      if (!opts.confirmLargeInsert) return false;
      try {
        if (!await opts.confirmLargeInsert(gate.nextBytes)) return false;
      } catch {
        return false;
      }
      if (gate.exceedsHardLimit) return false;
    }
    return insertTextPreservingUndo(snapshot, start, end, text, signal, selectionAfter);
  };

  const replaceRange = async (
    start: number, end: number, text: string, signal?: AbortSignal,
    selectionAfter?: MarkdownSelection,
  ): Promise<boolean> => {
    if (!canEdit() || signal?.aborted || !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end < start || end > input.value.length) return false;
    const snapshot = captureEdit();
    if (snapshot.value.slice(start, end) === text) return false;
    const nextLength = snapshot.value.length - (end - start) + text.length;
    if (selectionAfter && (!Number.isInteger(selectionAfter.start) || !Number.isInteger(selectionAfter.end) ||
      selectionAfter.start < 0 || selectionAfter.end < selectionAfter.start || selectionAfter.end > nextLength)) return false;
    return replaceCapturedRange(snapshot, start, end, text,
      admission(snapshot.value, start, end, text), signal, selectionAfter);
  };

  /**
   * Large-insert gate shared by paste and text drop. A megabytes insert would
   * otherwise start a minutes-long frozen render with no warning
   * (docs/PERF_BUDGET.md). Only inserts that cross the threshold, are
   * themselves over it, or would pass the hard limit are intercepted; small
   * edits to a document the user already accepted as large proceed natively.
   */
  const gateLargeInsert = (text: string, event: { preventDefault(): void }): void => {
    if (!text) return;
    const snapshot = captureEdit();
    const gate = admission(snapshot.value, snapshot.start, snapshot.end, text);
    if (!gate.needsConfirmation) return;
    event.preventDefault();
    void replaceCapturedRange(snapshot, snapshot.start, snapshot.end, text, gate);
  };

  const onPasteEvent = (event: ClipboardEvent): void => {
    gateLargeInsert(event.clipboardData?.getData("text/plain") ?? "", event);
  };

  const onDragOverEvent = (event: DragEvent): void => {
    // Text drags must cancel dragover or the drop event never fires (size is
    // unknowable until drop time — getData is forbidden during dragover — so
    // all text drags are admitted and gated at drop). File drags are left
    // alone for the window handler's overlay logic.
    const dt = event.dataTransfer;
    if (!dt || Array.from(dt.types).includes("Files")) return;
    event.preventDefault();
  };

  const onDropEvent = (event: DragEvent): void => {
    // Text drags carry no files, so the window drop handler ignores them; without
    // this the textarea would insert them natively with no size gate. File drags
    // are left alone for the window handler. Accepted drops insert at the caret
    // (preventDefault loses the drop point) rather than the drop position.
    const dt = event.dataTransfer;
    if (!dt || Array.from(dt.types).includes("Files")) return;
    gateLargeInsert(dt.getData("text/plain"), event);
  };

  const bindInput = (target: HTMLTextAreaElement): void => {
    target.addEventListener("input", onInputEvent);
    target.addEventListener("scroll", onScroll);
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("paste", onPasteEvent);
    target.addEventListener("dragover", onDragOverEvent);
    target.addEventListener("drop", onDropEvent);
    target.addEventListener("select", onSelect);
    target.addEventListener("compositionstart", onCompositionStart);
    target.addEventListener("compositionend", onCompositionEnd);
  };
  const unbindInput = (target: HTMLTextAreaElement): void => {
    target.removeEventListener("input", onInputEvent);
    target.removeEventListener("scroll", onScroll);
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("paste", onPasteEvent);
    target.removeEventListener("dragover", onDragOverEvent);
    target.removeEventListener("drop", onDropEvent);
    target.removeEventListener("select", onSelect);
    target.removeEventListener("compositionstart", onCompositionStart);
    target.removeEventListener("compositionend", onCompositionEnd);
  };
  bindInput(input);

  const search = mountEditorSearch(pane, head, input, highlight, {
    replaceRange, hardLimitBytes: opts.hardLimitBytes,
  });
  const formatting = mountEditorFormatting(pane, head, input, { replaceRange, canEdit });

  syncSize("");

  return {
    get input(): HTMLTextAreaElement { return input; },
    replaceRange,
    setDocument(doc): void {
      if (destroyed) return;
      const text = doc?.text ?? "";
      const nextKey = doc ? (doc.id === undefined ? `name:${doc.name}` : `id:${doc.id}`) : null;
      const switched = nextKey !== documentKey;
      const sameText = input.value === text;
      // App adopts the first typed text as Untitled during onInput. That establishes
      // ownership without erasing the very native undo entry that created it.
      const adoptingInput = documentKey === null && doc !== null && reportingInput && sameText;
      if (switched || !sameText) editRevision++;
      documentKey = nextKey;
      fileNameEl.textContent = doc?.name ?? "Untitled.md";
      if (sameText && (!switched || adoptingInput)) {
        if (switched) search.sourceChanged(true);
        return;
      }
      const previousSelection = selection();
      const restoreFocus = switched && document.activeElement === input;
      if (switched) {
        // Chromium can retain native undo even across different value assignments.
        // A fresh editing host gives this document its own native history and makes
        // stale DOM references inert. Initial typed-document adoption returns above.
        const previousInput = input;
        unbindInput(previousInput);
        input = createInput();
        bindInput(input);
        previousInput.replaceWith(input);
        composing = false;
      }
      input.value = text;
      if (sameText) input.setSelectionRange(
        previousSelection.start, previousSelection.end, previousSelection.direction,
      );
      input.scrollTop = 0;
      input.scrollLeft = 0;
      onScroll();
      // An externally-seeded document is a discrete event, not a keystroke: count it
      // straight away so the header is right before the user can look at it.
      wordCount = countWords(text);
      if (statTimer) {
        clearTimeout(statTimer);
        statTimer = undefined;
      }
      syncSize(text);
      scheduleHighlight(text);
      search.setInput(input);
      search.sourceChanged(true);
      formatting.setInput(input);
      if (restoreFocus) input.focus({ preventScroll: true });
    },
    setCodeTheme(next): void {
      if (next === codeTheme) return;
      codeTheme = next;
      // Only the colors change, so recolor in place — dropping to a plain repaint
      // first would flash the pane uncolored for no reason.
      scheduleRecolor(input.value);
    },
    focus(): void {
      input.focus();
    },
    destroy(): void {
      destroyed = true;
      search.destroy();
      formatting.destroy();
      if (highlightTimer) clearTimeout(highlightTimer);
      if (statTimer) clearTimeout(statTimer);
      unbindInput(input);
      pane.remove();
    },
  };
}
