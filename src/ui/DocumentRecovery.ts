import { el } from "../app/dom";
import type { Doc, DocStore } from "../app/state";

export interface DocumentRecoveryController {
  closeActive(): void;
  destroy(): void;
}

/** One explicit close can be undone during this toolbar's in-memory lifetime. */
export function mountDocumentRecovery(
  root: HTMLElement,
  store: DocStore,
  returnFocus: () => void,
): DocumentRecoveryController {
  let closed: Pick<Doc, "name" | "text"> | null = null;
  let destroyed = false;
  const filename = el("strong", { class: "document-recovery-name" });
  const status = el("span", { class: "document-recovery-status", attrs: { role: "status", "aria-atomic": "true" } });
  const undo = el("button", { type: "button", class: "document-recovery-action" }, "Undo close");
  const discard = el("button", { type: "button", class: "document-recovery-action",
    attrs: { "aria-label": "Discard closed document" } }, "Discard");
  const row = el("div", { class: "document-recovery" }, status, undo, discard,
    el("span", { class: "document-recovery-hint" }, "Only the latest close can be undone. Reloading or closing this tab clears recovery."));
  row.hidden = true;
  root.append(row);

  function clear(): void {
    closed = null;
    filename.textContent = "";
    filename.removeAttribute("title");
    status.replaceChildren();
    row.hidden = true;
  }

  function restore(): void {
    if (destroyed || !root.isConnected || !closed) return;
    const snapshot = closed;
    // Consume once before store events can re-enter. A new identity cannot
    // overwrite another document that was opened or edited after this close.
    clear();
    store.add(snapshot.name, snapshot.text);
    returnFocus();
  }

  function dismiss(): void {
    if (destroyed || !root.isConnected) return;
    clear();
    returnFocus();
  }

  undo.addEventListener("click", restore);
  discard.addEventListener("click", dismiss);

  return {
    closeActive(): void {
      if (destroyed || !root.isConnected) return;
      const doc = store.active;
      if (!doc) return;
      closed = { name: doc.name, text: doc.text };
      store.remove(doc.id);
      filename.textContent = doc.name;
      filename.title = doc.name;
      status.replaceChildren("Closed ", filename, ".");
      row.hidden = false;
      undo.focus();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      clear();
      undo.removeEventListener("click", restore);
      discard.removeEventListener("click", dismiss);
      row.remove();
    },
  };
}
