/**
 * Document store and the debounced render scheduler.
 *
 * The store holds the in-memory open documents (one active at a time). It is a tiny
 * event emitter — UI subscribes to "change" and re-reads. The scheduler coalesces
 * rapid render requests: settings tweaks are the hot path (120ms), content swaps 250ms.
 */

export interface Doc {
  id: string;
  name: string;
  text: string;
}

export type RenderReason = "content" | "settings";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `doc-${idCounter}`;
}

export class DocStore {
  openDocs: Doc[] = [];
  activeId: string | null = null;
  private listeners = new Set<() => void>();

  get active(): Doc | null {
    return this.openDocs.find((d) => d.id === this.activeId) ?? null;
  }

  add(name: string, text: string): Doc {
    const doc: Doc = { id: nextId(), name, text };
    this.openDocs.push(doc);
    this.activeId = doc.id;
    this.emit();
    return doc;
  }

  setActive(id: string): void {
    if (this.openDocs.some((d) => d.id === id)) {
      this.activeId = id;
      this.emit();
    }
  }

  remove(id: string): void {
    const idx = this.openDocs.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.openDocs.splice(idx, 1);
    if (this.activeId === id) {
      this.activeId = this.openDocs[Math.max(0, idx - 1)]?.id ?? null;
    }
    this.emit();
  }

  on(_ev: "change", cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
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
