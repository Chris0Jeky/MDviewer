/**
 * The one ownership map for open desktop documents across Read, Edit and PDF.
 *
 * Reading mode owns its documents through `reader` (a bounded ReaderSession).
 * While the PDF workspace is mounted its `DocStore` owns the text, and
 * `baselines` maps each DocStore id to the logical document it came from: its
 * stable key, native binding and the clean source it was opened or saved with.
 * Every transition between the two goes through this module, so there is no
 * basename lookup and no second owner (docs/design/FILE_LIFECYCLE.md).
 */
import type { App } from "../app/App";
import type { Doc } from "../app/state";
import type { OpenBatch } from "./native";
import { ReaderSession, nextDocumentKey, type ReaderDocument } from "./session";

export type FileEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be";
export type LineEnding = "lf" | "crlf" | "cr" | "mixed" | "none";
/** `changed` and `missing` are reported by the file watcher (slice S1c). */
export type DiskState = "synced" | "changed" | "missing";

/** Display-only file facts for a document the host opened. The webview never supplies a path. */
export interface Binding {
  token: string;
  path: string;
  dir: string;
  encoding: FileEncoding;
  eol: LineEnding;
  disk: DiskState;
}

/** The clean source a workspace document is compared with, plus its identity. */
export interface WorkspaceBaseline {
  name: string;
  text: string;
  dirty: boolean;
  key?: string;
  binding?: Binding;
}

export interface DocumentListing {
  docs: Array<{ id: string; name: string; text: string; dirty: boolean; key?: string }>;
  active: { id: string; name: string } | null | undefined;
}

type IncomingDocument = OpenBatch["documents"][number];

export function bindingOf(doc: IncomingDocument): Binding | undefined {
  if (!doc.token || !doc.path) return undefined;
  return {
    token: doc.token, path: doc.path, dir: doc.dir ?? "",
    encoding: doc.encoding ?? "utf-8", eol: doc.eol ?? "lf", disk: "synced",
  };
}

export class DesktopDocuments {
  reader = new ReaderSession();
  baselines = new Map<string, WorkspaceBaseline>();
  workspace: App | null = null;

  /** True when a workspace document has no clean baseline or differs from it. */
  workspaceDirty(doc: Doc): boolean {
    const original = this.baselines.get(doc.id);
    return !original || original.dirty || original.text !== doc.text || original.name !== doc.name;
  }

  list(): DocumentListing {
    const app = this.workspace;
    if (!app) return { docs: this.reader.documents, active: this.reader.active };
    return {
      docs: app.store.openDocs.map(doc => ({ ...doc, dirty: this.workspaceDirty(doc), key: this.baselines.get(doc.id)?.key })),
      active: app.store.active,
    };
  }

  hasUnsavedWork(): boolean {
    const app = this.workspace;
    if (!app) return this.reader.documents.some(doc => doc.dirty);
    return app.store.openDocs.some(doc => this.workspaceDirty(doc));
  }

  /** A bounded copy of the workspace set, for admission checks against current edited bytes. */
  private boundedWorkspace(app: App): ReaderSession {
    const bounded = new ReaderSession();
    // Seed the gate without dropping existing edits that have grown since opening.
    bounded.documents.push(...app.store.openDocs.map(doc => ({ ...doc, key: "", dirty: false })));
    return bounded;
  }

  /** Would these documents fit the workspace's bounds? Returns the admission errors. */
  admitToWorkspace(docs: readonly Pick<Doc, "name" | "text">[]): string[] {
    if (!this.workspace) return [];
    return this.boundedWorkspace(this.workspace).append(docs);
  }

  /** Add an opened batch to whichever mode owns documents now; returns admission errors. */
  addBatch(documents: OpenBatch["documents"], owns: boolean): string[] {
    const incoming = documents.map(doc => ({ name: doc.name, text: doc.text, binding: bindingOf(doc) }));
    const app = this.workspace;
    if (!app) return this.reader.append(incoming, owns);
    const bounded = this.boundedWorkspace(app);
    const count = bounded.documents.length;
    const errors = bounded.append(incoming);
    const accepted = bounded.documents.slice(count);
    const added = app.store.addBatch(accepted, owns || app.store.activeId === null);
    for (const [index, doc] of added.entries()) {
      const { key, binding } = accepted[index]!;
      this.baselines.set(doc.id, { ...doc, key, binding, dirty: false });
    }
    return errors;
  }

  /** A new, unbound workspace document with an explicit clean baseline. */
  addNewToWorkspace(app: App, doc: Pick<Doc, "name" | "text">): Doc {
    const added = app.store.add(doc.name, doc.text);
    this.baselines.set(added.id, { ...doc, key: nextDocumentKey(), dirty: false });
    return added;
  }

  /** Move the reader's documents, positions and selection into a freshly mounted workspace. */
  adoptReaderInto(app: App): void {
    const session = this.reader;
    const selected = session.documents.findIndex(doc => doc.id === session.activeId);
    const added = app.store.addBatch(session.documents);
    for (const [index, doc] of added.entries()) {
      const position = session.positions.get(session.documents[index]!.id);
      if (position) app.store.positions.set(doc.id, position);
    }
    // addBatch initially activates the first document. Restore it before changing
    // selection so beforechange cannot replace its transferred coordinates with 0.
    app.restoreDocumentPosition();
    this.baselines = new Map(added.map((doc, index) => [doc.id, session.documents[index]!]));
    if (added[selected]) app.store.setActive(added[selected]!.id);
    this.workspace = app;
  }

  /** The App, selection and baselines now own every transferred source; release the reader's copy. */
  releaseReader(): void {
    this.reader.documents.length = 0;
    this.reader.activeId = null;
    this.reader.positions.clear();
  }

  /** Drop baselines for documents the workspace closed. */
  pruneBaselines(): void {
    const app = this.workspace;
    if (!app) return;
    const openIds = new Set(app.store.openDocs.map(doc => doc.id));
    for (const id of this.baselines.keys()) if (!openIds.has(id)) this.baselines.delete(id);
  }

  /** Build the reader session that would own the workspace's documents; throws on admission failure. */
  readerSnapshot(app: App): ReaderSession {
    const next = new ReaderSession();
    const errors = next.append(app.store.openDocs.map(doc => {
      const baseline = this.baselines.get(doc.id);
      return { name: doc.name, text: doc.text, dirty: this.workspaceDirty(doc), key: baseline?.key, binding: baseline?.binding };
    }));
    if (errors.length) throw new Error(errors.join(" "));
    for (const [index, doc] of app.store.openDocs.entries()) {
      const position = app.store.positions.get(doc.id);
      if (position) next.positions.set(next.documents[index]!.id, position);
    }
    const index = app.store.openDocs.findIndex(doc => doc.id === app.store.activeId);
    next.activeId = next.documents[index]?.id ?? next.activeId;
    return next;
  }

  /** The workspace was torn down: the snapshot becomes the only owner. */
  returnToReader(next: ReaderSession): void {
    this.baselines.clear();
    this.workspace = null;
    this.reader = next;
  }
}

export type { ReaderDocument };
