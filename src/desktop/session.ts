/** Bounded, memory-only document state for the standalone reader. */
export interface ReaderDocument {
  id: string;
  name: string;
  text: string;
  dirty: boolean;
}

export class ReaderSession {
  readonly documents: ReaderDocument[] = [];
  activeId: string | null = null;
  private sequence = 0;

  constructor(private readonly maxBytes = 25_000_000, private readonly maxDocuments = 32) {}

  get active(): ReaderDocument | undefined {
    return this.documents.find(doc => doc.id === this.activeId);
  }

  append(docs: readonly { name: string; text: string; dirty?: boolean }[], activate = true): string[] {
    const encoder = new TextEncoder();
    let used = this.documents.reduce((total, doc) => total + encoder.encode(doc.text).length, 0);
    const errors: string[] = [];
    let first: string | undefined;
    for (const doc of docs) {
      if (this.documents.length >= this.maxDocuments) {
        errors.push(`Close a document first — at most ${this.maxDocuments} documents can be open.`);
        break;
      }
      const bytes = encoder.encode(doc.text).length;
      if (used + bytes > this.maxBytes) {
        errors.push(`${doc.name}: the open documents would exceed the reader's memory limit. Close a document first.`);
        continue;
      }
      used += bytes;
      const id = `reader-${++this.sequence}`;
      this.documents.push({ id, name: doc.name, text: doc.text, dirty: doc.dirty ?? false });
      first ??= id;
    }
    if (first && (activate || !this.activeId)) this.activeId = first;
    return errors;
  }

  close(id: string): void {
    const index = this.documents.findIndex(doc => doc.id === id);
    if (index < 0) return;
    this.documents.splice(index, 1);
    if (this.activeId === id) this.activeId = this.documents[Math.max(0, index - 1)]?.id ?? null;
  }
}

export function decodeMarkdown(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
}

/** Coalesce notifications without losing one that arrives while an IPC read is pending. */
export function drainSerially(drain: () => Promise<void>): () => Promise<void> {
  let pending = false;
  let running: Promise<void> | null = null;
  return () => {
    pending = true;
    if (!running) {
      running = (async () => {
        try {
          while (pending) {
            pending = false;
            await drain();
          }
        } finally {
          running = null;
        }
      })();
    }
    return running;
  };
}
