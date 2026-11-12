/** Bounded, memory-only document state for the standalone reader. */
import { SessionPositions } from "../app/positions";
import type { Binding } from "./documents";

export interface ReaderDocument {
  id: string;
  /** Stable logical-document key, carried across Read, Edit and PDF (documents.ts). */
  key: string;
  name: string;
  text: string;
  dirty: boolean;
  binding?: Binding;
}

let keySequence = 0;
/** A stable logical-document key; never a filename, path or UI id. */
export function nextDocumentKey(): string {
  return `k${++keySequence}`;
}

/** Names are local to the open set; compare case-insensitively for Windows. */
export function nextUntitledName(docs: readonly { name: string }[]): string {
  const names = new Set(docs.map(doc => doc.name.toLowerCase()));
  let name = "Untitled.md";
  for (let number = 2; names.has(name.toLowerCase()); number += 1) name = `Untitled ${number}.md`;
  return name;
}

export class ReaderSession {
  readonly documents: ReaderDocument[] = [];
  readonly positions = new SessionPositions();
  activeId: string | null = null;
  private sequence = 0;

  constructor(private readonly maxBytes = 25_000_000, private readonly maxDocuments = 32) {}

  get active(): ReaderDocument | undefined {
    return this.documents.find(doc => doc.id === this.activeId);
  }

  append(docs: readonly { name: string; text: string; dirty?: boolean; key?: string; binding?: Binding }[], activate = true): string[] {
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
      this.documents.push({
        id, key: doc.key ?? nextDocumentKey(), name: doc.name, text: doc.text, dirty: doc.dirty ?? false,
        ...(doc.binding ? { binding: doc.binding } : {}),
      });
      first ??= id;
    }
    if (first && (activate || !this.activeId)) this.activeId = first;
    return errors;
  }

  close(id: string): void {
    const index = this.documents.findIndex(doc => doc.id === id);
    if (index < 0) return;
    this.positions.take(id);
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
