/**
 * Document store and the debounced render scheduler.
 *
 * The store holds the in-memory open documents (one active at a time). It is a tiny
 * event emitter — UI subscribes and re-reads. The scheduler coalesces rapid render
 * requests: settings tweaks are the hot path (120ms), content swaps 250ms.
 *
 * Two events, deliberately separate:
 *  - `"change"` — the document *set* or the active document changed (open, close,
 *    switch). Listeners rebuild document-identity UI (switcher, editor contents).
 *  - `"text"`   — the active document's text was edited in place. Fires once per
 *    keystroke, so only the render pipeline listens; identity UI must not churn.
 */

export interface Doc {
  id: string;
  name: string;
  text: string;
}

export type RenderReason = "content" | "settings";

/** Store event names. See the module comment for who should listen to which. */
export type DocEvent = "change" | "text";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `doc-${idCounter}`;
}

export class DocStore {
  openDocs: Doc[] = [];
  activeId: string | null = null;
  private listeners: Record<DocEvent, Set<() => void>> = {
    change: new Set(),
    text: new Set(),
  };

  get active(): Doc | null {
    return this.openDocs.find((d) => d.id === this.activeId) ?? null;
  }

  add(name: string, text: string): Doc {
    const doc: Doc = { id: nextId(), name, text };
    this.openDocs.push(doc);
    this.activeId = doc.id;
    this.emit("change");
    return doc;
  }

  setActive(id: string): void {
    if (this.openDocs.some((d) => d.id === id)) {
      this.activeId = id;
      this.emit("change");
    }
  }

  /**
   * Replace an open document's text in place — the editor's write path. Emits "text"
   * (not "change") because the document's identity is untouched: only the render
   * pipeline needs to react, and the editor itself must not be re-seeded mid-keystroke.
   * Returns false when the id is unknown or the text is already identical (no event).
   */
  updateText(id: string, text: string): boolean {
    const doc = this.openDocs.find((d) => d.id === id);
    if (!doc || doc.text === text) return false;
    doc.text = text;
    this.emit("text");
    return true;
  }

  remove(id: string): void {
    const idx = this.openDocs.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.openDocs.splice(idx, 1);
    if (this.activeId === id) {
      this.activeId = this.openDocs[Math.max(0, idx - 1)]?.id ?? null;
    }
    this.emit("change");
  }

  on(ev: DocEvent, cb: () => void): () => void {
    const set = this.listeners[ev];
    set.add(cb);
    return () => set.delete(cb);
  }

  private emit(ev: DocEvent): void {
    for (const cb of this.listeners[ev]) cb();
  }
}

const DEBOUNCE_MS: Record<RenderReason, number> = {
  content: 250,
  settings: 120,
};

/**
 * Returns a debounced trigger. Calls with the same reason coalesce to the latest;
 * a "content" reason is never starved by rapid "settings" changes — whichever fires
 * last wins, but the shortest applicable debounce is used.
 */
export function createRenderScheduler(
  run: (reason: RenderReason) => Promise<void>,
): (reason: RenderReason) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: RenderReason = "settings";
  return (reason: RenderReason) => {
    // "content" dominates: a queued content render must not be downgraded.
    if (reason === "content" || pending === "content") pending = "content";
    else pending = reason;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const reasonToRun = pending;
      pending = "settings";
      timer = undefined;
      void run(reasonToRun);
    }, DEBOUNCE_MS[reason]);
  };
}
