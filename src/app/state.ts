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

/**
 * Is there work in the store a reload would actually destroy?
 *
 * MDviewer never persists document text (local-first, by design), so a reload loses
 * everything open. Prompting unconditionally would nag on the one case where the
 * prompt is pure noise: the bundled sample, opened and never touched. So a document
 * counts as protectable only when it has content AND is not byte-identical to the
 * pristine sample — which also means editing the sample re-arms the guard.
 *
 * Pure and store-independent so it is unit-testable without a DOM.
 */
export function hasProtectableWork(docs: readonly Doc[], pristineSample: string): boolean {
  return docs.some((doc) => doc.text.trim().length > 0 && doc.text !== pristineSample);
}

const DEBOUNCE_MS: Record<RenderReason, number> = {
  content: 250,
  settings: 120,
};

export interface RenderScheduler {
  /** Request a render; coalesces with any other request inside the debounce window. */
  schedule(reason: RenderReason): void;
  /**
   * Run any debounced request immediately instead of waiting out its timer, and
   * resolve once the resulting run settles. Resolves immediately when nothing is
   * pending. Callers that must observe the current text on screen — the exports —
   * use this so they cannot ship the previous document's pages.
   */
  flush(): Promise<void>;
  /** True while a request is waiting out its debounce. */
  readonly isPending: boolean;
}

/**
 * Returns a debounced, **serialized** render trigger. Calls with the same reason
 * coalesce to the latest; a "content" reason is never starved by rapid "settings"
 * changes — whichever fires last wins, but the shortest applicable debounce is used.
 *
 * Serialization matters as much as the debounce. `run` paginates, and pagination
 * tears down and rewrites one shared host through Paged.js's global handler and page
 * counter. A render that outlives its debounce window — easy once a document is large
 * and the user keeps typing — would otherwise have a second run clear the host and
 * re-register the handler underneath it, interleaving two layouts into the same pages.
 * So each run is chained behind the previous one, and a run that a newer request has
 * already superseded while it waited is dropped rather than executed.
 */
export function createRenderScheduler(
  run: (reason: RenderReason) => Promise<void>,
): RenderScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: RenderReason = "settings";
  /** Tail of the run chain; every fire appends to it, so runs never overlap. */
  let chain: Promise<void> = Promise.resolve();
  /** Identifies the most recently queued run, so older queued runs can bow out. */
  let queued = 0;

  function fire(): Promise<void> {
    const reasonToRun = pending;
    pending = "settings";
    const id = ++queued;
    const thisRun = chain.then(async () => {
      // A newer request was queued while this one waited for the lock — its render
      // subsumes this one, so running it would only paginate the same text twice.
      if (id !== queued) return;
      await run(reasonToRun);
    });
    // The chain must stay resolvable: if one run rejects, the renders queued behind it
    // still have to happen. The rejection is not swallowed — it is handed to whoever
    // called this run (see below), and `run` itself reports render failures.
    chain = thisRun.catch(() => undefined);
    return thisRun;
  }

  /** Surface an escaped rejection to the global handler rather than dropping it. */
  function report(err: unknown): void {
    queueMicrotask(() => {
      throw err;
    });
  }

  return {
    schedule(reason: RenderReason): void {
      // "content" dominates: a queued content render must not be downgraded.
      if (reason === "content" || pending === "content") pending = "content";
      else pending = reason;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fire().catch(report);
      }, DEBOUNCE_MS[reason]);
    },
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        await fire();
        return;
      }
      // Nothing debounced, but a run may still be in flight — await the chain so the
      // host is settled either way.
      await chain;
    },
    get isPending(): boolean {
      return timer !== undefined;
    },
  };
}
