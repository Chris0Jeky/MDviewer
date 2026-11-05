/** In-memory source search. The editor retains sole ownership of source edits. */
import { ATTRS, CLASSES, IDS, el } from "../app/dom";
import { findMatches, MAX_SEARCH_QUERY_CHARS, nextMatch, replaceMatches, replacementByteLength } from "./EditorSearchModel";
import type { SearchResults, SourceMatch } from "./EditorSearchModel";
import { mountEditorMatchCue } from "./EditorMatchCue";

export interface EditorSearchController {
  /** Rebind the current native textarea after a document identity boundary. */
  setInput(input: HTMLTextAreaElement): void;
  sourceChanged(documentChanged?: boolean): void;
  destroy(): void;
}

export interface EditorSearchOptions {
  /** Same guarded, undo-aware path as paste; false means refused or superseded. */
  replaceRange(start: number, end: number, text: string, signal?: AbortSignal): Promise<boolean>;
  /** Preflight bulk multiplication before materializing its result. */
  hardLimitBytes?: number;
}

const SEARCH_DELAY_MS = 90;

export function mountEditorSearch(
  pane: HTMLElement, head: HTMLElement, input: HTMLTextAreaElement,
  backdrop: HTMLElement, opts: EditorSearchOptions,
): EditorSearchController {
  let destroyed = false;
  let matchCase = false;
  let stale = true;
  let busy = false;
  let revision = 0;
  let indexedText = "";
  let results: SearchResults = { matches: [], limited: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingEdit: AbortController | undefined;
  let searchError = "";

  const command = (text: string, label = text): HTMLButtonElement => el("button", {
    type: "button", class: CLASSES.editorCommand, title: label, attrs: { "aria-label": label },
  }, text);
  const findButton = command("Find");
  findButton.title = "Find in Markdown (Ctrl/Cmd+F)";
  findButton.setAttribute("aria-keyshortcuts", "Control+f Meta+f");
  findButton.setAttribute("aria-controls", IDS.editorSearch);
  findButton.setAttribute("aria-expanded", "false");
  head.append(findButton);

  const query = el("input", { type: "search", class: CLASSES.editorSearchField,
    placeholder: "Find text", spellcheck: false,
    attrs: { "aria-label": "Find in Markdown", autocomplete: "off" } });
  const replacement = el("input", { type: "text", class: CLASSES.editorSearchField,
    placeholder: "Replace with", spellcheck: false,
    attrs: { "aria-label": "Replace with", autocomplete: "off" } });
  const previous = command("↑", "Previous match");
  const next = command("↓", "Next match");
  const caseButton = command("Aa", "Match case");
  caseButton.setAttribute("aria-pressed", "false");
  const close = command("×", "Close find");
  const replace = command("Replace", "Replace match");
  const replaceAll = command("Replace all");
  const replaceToggle = command("Replace…", "Show replace");
  replaceToggle.setAttribute("aria-controls", IDS.editorReplaceRow);
  replaceToggle.setAttribute("aria-expanded", "false");
  const status = el("span", { class: CLASSES.editorSearchStatus,
    attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" } }, "Type to find");
  const replaceRow = el("div", { id: IDS.editorReplaceRow, class: CLASSES.editorSearchRow, hidden: true },
    replacement, replace, replaceAll);
  const panel = el("section", { id: IDS.editorSearch, hidden: true,
    attrs: { role: "search", "aria-label": "Find and replace in Markdown" } },
    el("div", { class: CLASSES.editorSearchRow }, query, caseButton, previous, next, close),
    replaceRow, el("div", { class: CLASSES.editorSearchFooter }, status, replaceToggle));
  head.after(panel);
  const cue = mountEditorMatchCue(input, backdrop);

  function available(): boolean {
    return !destroyed && pane.isConnected && !pane.closest("[inert], [hidden]") &&
      !pane.closest(`[${ATTRS.viewMode}="preview"]`);
  }

  function selection(): SourceMatch {
    return { start: input.selectionStart, end: input.selectionEnd };
  }

  function currentIndex(): number {
    return results.matches.findIndex((match) => match.start === input.selectionStart && match.end === input.selectionEnd);
  }

  function sync(): void {
    const disabled = busy || stale || results.matches.length === 0;
    cue.show(!panel.hidden && !disabled ? results.matches[currentIndex()] : undefined);
    previous.disabled = next.disabled = disabled;
    replace.disabled = disabled || currentIndex() === -1;
    replaceAll.disabled = disabled || results.limited;
    query.disabled = replacement.disabled = caseButton.disabled = busy;
    findButton.disabled = busy;
    if (busy) status.textContent = "Waiting for confirmation…";
    else if (!query.value) status.textContent = "Type to find";
    else if (stale) status.textContent = "Searching…";
    else if (searchError) status.textContent = searchError;
    else if (results.limited) status.textContent = "10,000+ matches; refine search";
    else if (!results.matches.length) status.textContent = "No matches";
    else {
      const current = currentIndex();
      const total = `${results.matches.length} match${results.matches.length === 1 ? "" : "es"}`;
      status.textContent = current === -1 ? total : `${current + 1} of ${total}`;
    }
  }

  function select(index: number): void {
    const match = results.matches[index];
    if (!match) return;
    input.setSelectionRange(match.start, match.end);
    cue.show(match, true);
    sync();
  }

  function cancelTimer(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  function recompute(selectInitial = false): void {
    cancelTimer();
    if (destroyed || panel.hidden) return;
    indexedText = input.value;
    searchError = "";
    try {
      results = findMatches(indexedText, query.value, matchCase);
    } catch {
      results = { matches: [], limited: false };
      searchError = query.value.length > MAX_SEARCH_QUERY_CHARS
        ? "Search text is too long (maximum 2,000 characters)."
        : "Could not search. Try a shorter search text.";
    }
    stale = false;
    if (selectInitial && results.matches.length) {
      const current = currentIndex();
      select(current === -1 ? nextMatch(results.matches, { start: input.selectionStart, end: input.selectionStart }, 1) : current);
    } else sync();
  }

  function schedule(selectInitial: boolean): void {
    cancelTimer();
    stale = true;
    sync();
    const owner = selection();
    timer = setTimeout(() => {
      timer = undefined;
      // Counting may finish after the user leaves Find. A delayed search must
      // never steal a newer caret, or the next source keystroke replaces a match.
      const ownsSelection = document.activeElement === query && available() &&
        input.selectionStart === owner.start && input.selectionEnd === owner.end;
      recompute(selectInitial && ownsSelection);
    }, SEARCH_DELAY_MS);
  }

  function showReplace(show: boolean): void {
    replaceRow.hidden = !show;
    replaceToggle.textContent = show ? "Hide replace" : "Replace…";
    replaceToggle.setAttribute("aria-label", show ? "Hide replace" : "Show replace");
    replaceToggle.setAttribute("aria-expanded", String(show));
  }

  function open(replaceMode = false): void {
    if (!available() || busy) return;
    const selected = input.value.slice(input.selectionStart, input.selectionEnd);
    if (selected && selected.length <= MAX_SEARCH_QUERY_CHARS && !/[\r\n]/.test(selected)) query.value = selected;
    panel.hidden = false;
    findButton.setAttribute("aria-expanded", "true");
    if (replaceMode) showReplace(true);
    recompute(false);
    const target = replaceMode ? replacement : query;
    target.focus();
    target.select();
  }

  function closePanel(): void {
    revision++;
    pendingEdit?.abort();
    pendingEdit = undefined;
    busy = false;
    cancelTimer();
    panel.hidden = true;
    results = { matches: [], limited: false };
    indexedText = "";
    stale = true;
    findButton.setAttribute("aria-expanded", "false");
    sync();
    if (available()) input.focus({ preventScroll: true });
  }

  function navigate(direction: 1 | -1): void {
    if (!available() || panel.hidden || busy) return;
    if (stale || indexedText !== input.value) recompute(false);
    select(nextMatch(results.matches, selection(), direction));
  }

  async function applyReplacement(all: boolean): Promise<void> {
    if (!available() || panel.hidden || busy) return;
    if (stale || indexedText !== input.value) recompute(false);
    if (!results.matches.length || (all && results.limited)) return;
    const current = results.matches[currentIndex()];
    if (!all && !current) return;
    if (all && opts.hardLimitBytes && replacementByteLength(indexedText, results.matches, replacement.value) > opts.hardLimitBytes) {
      status.textContent = "Replacement exceeds the document size limit. Use shorter replacement text.";
      return;
    }
    const text = all ? replaceMatches(indexedText, results.matches, replacement.value) : replacement.value;
    const start = all ? 0 : current!.start;
    const end = all ? indexedText.length : current!.end;
    if (input.value.slice(start, end) === text) { if (!all) navigate(1); return; }
    const operation = ++revision;
    const focused = document.activeElement;
    const abort = new AbortController();
    pendingEdit = abort;
    busy = true;
    sync();
    let applied = false;
    let ownsFocus = true;
    const onLaterFocus = (): void => { ownsFocus = false; };
    const stopWatchingFocus = (): void => { document.removeEventListener("focusin", onLaterFocus); };
    try {
      const editing = opts.replaceRange(start, end, text, abort.signal);
      // A synchronous native edit focuses the textarea before returning. Observe
      // only later focus changes: a pending confirmation must not steal focus
      // back from a source/toolbar action when it settles.
      document.addEventListener("focusin", onLaterFocus);
      abort.signal.addEventListener("abort", stopWatchingFocus, { once: true });
      applied = await editing;
    } catch {
      // Hosts may reject confirmation promises; the source must stay usable.
      applied = false;
    } finally {
      stopWatchingFocus();
      abort.signal.removeEventListener("abort", stopWatchingFocus);
      if (!destroyed && operation === revision) {
        busy = false;
        pendingEdit = undefined;
        recompute(false);
        if (applied && !all) navigate(1);
        else if (!applied && !panel.hidden) status.textContent = "Replacement cancelled";
        // A successful delayed edit deliberately focuses the current textarea.
        // The shared edit guard has already rejected any earlier user focus move.
        const editorFocusedAfterCommit = applied && document.activeElement === input;
        if ((ownsFocus || editorFocusedAfterCommit) && focused instanceof HTMLElement &&
          panel.contains(focused) && available()) focused.focus({ preventScroll: true });
      }
    }
  }

  const onQuery = (): void => { revision++; schedule(true); };
  const onSelection = (): void => { if (!panel.hidden && !stale && !busy) sync(); };
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.altKey || !available()) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey !== event.metaKey && !event.shiftKey && (key === "f" || key === "h")) {
      event.preventDefault();
      if (!event.repeat) open(key === "h");
      return;
    }
    if (panel.hidden || event.ctrlKey || event.metaKey || !(event.target instanceof Node) || !pane.contains(event.target)) return;
    if (key === "escape" || key === "f3" || (key === "enter" && (event.target === query || event.target === replacement))) {
      event.preventDefault();
      if (event.repeat) return;
      if (key === "escape") closePanel();
      else if (key === "enter" && event.target === replacement && !event.shiftKey) void applyReplacement(false);
      else navigate(event.shiftKey ? -1 : 1);
    }
  };
  findButton.addEventListener("click", () => open());
  close.addEventListener("click", closePanel);
  previous.addEventListener("click", () => navigate(-1));
  next.addEventListener("click", () => navigate(1));
  replaceToggle.addEventListener("click", () => { showReplace(replaceRow.hidden === true); if (!replaceRow.hidden) replacement.focus(); });
  caseButton.addEventListener("click", () => { matchCase = !matchCase; caseButton.setAttribute("aria-pressed", String(matchCase)); recompute(true); });
  replace.addEventListener("click", () => { void applyReplacement(false); });
  replaceAll.addEventListener("click", () => { void applyReplacement(true); });
  query.addEventListener("input", onQuery);
  const bindInput = (target: HTMLTextAreaElement): void => {
    target.addEventListener("select", onSelection);
    target.addEventListener("keyup", onSelection);
    target.addEventListener("pointerup", onSelection);
  };
  const unbindInput = (target: HTMLTextAreaElement): void => {
    target.removeEventListener("select", onSelection);
    target.removeEventListener("keyup", onSelection);
    target.removeEventListener("pointerup", onSelection);
  };
  bindInput(input);
  window.addEventListener("keydown", onKey);
  sync();

  return {
    setInput(next): void {
      if (destroyed || next === input) return;
      unbindInput(input);
      input = next;
      cue.setInput(input);
      bindInput(input);
    },
    sourceChanged(documentChanged = false): void {
      if (destroyed) return;
      cue.clear();
      if (documentChanged) { revision++; pendingEdit?.abort(); pendingEdit = undefined; busy = false; }
      if (!panel.hidden) schedule(false);
    },
    destroy(): void {
      destroyed = true;
      revision++;
      cancelTimer();
      pendingEdit?.abort();
      results = { matches: [], limited: false };
      indexedText = "";
      cue.destroy();
      unbindInput(input);
      window.removeEventListener("keydown", onKey);
      panel.remove();
      findButton.remove();
    },
  };
}
