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
import type { OpenBatch, ReadResult, SaveResult } from "./native";
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
  /** The native binding generation this document last saw; fences stale saves. */
  generation: number;
}

/** The active document as captured when Save is invoked. */
export interface SaveTarget {
  owner: "reader" | "workspace";
  id: string;
  name: string;
  text: string;
  dirty: boolean;
  binding?: Binding;
}

/** How a native save completion was applied. */
export type SaveCompletion = "saved" | "saved-newer-edits" | "stale";

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
    encoding: doc.encoding ?? "utf-8", eol: doc.eol ?? "lf", disk: "synced", generation: 0,
  };
}

export class DesktopDocuments {
  reader = new ReaderSession();
  baselines = new Map<string, WorkspaceBaseline>();
  workspace: App | null = null;
  /** Called with a closed document's token so the host can revoke it. */
  onRelease: (token: string) => void = () => {};

  /** The active document, captured for Save. */
  saveTarget(): SaveTarget | null {
    const app = this.workspace;
    if (app) {
      const doc = app.store.active;
      if (!doc) return null;
      const binding = this.baselines.get(doc.id)?.binding;
      return { owner: "workspace", id: doc.id, name: doc.name, text: doc.text, dirty: this.workspaceDirty(doc), ...(binding ? { binding } : {}) };
    }
    const doc = this.reader.active;
    if (!doc) return null;
    return { owner: "reader", id: doc.id, name: doc.name, text: doc.text, dirty: doc.dirty, ...(doc.binding ? { binding: doc.binding } : {}) };
  }

  /**
   * Apply a successful native save of `captured` to the document that requested
   * it (FILE_LIFECYCLE completion table). A document that closed or moved to the
   * other mode meanwhile is stale: nothing changes and no binding is revived.
   */
  completeSave(target: SaveTarget, captured: string, result: Extract<SaveResult, { outcome: "saved" }>): SaveCompletion {
    const binding: Binding | undefined = result.token ? {
      token: result.token, path: result.path, dir: result.dir, encoding: result.encoding, eol: result.eol,
      disk: "synced", generation: result.generation,
    } : undefined;
    const app = this.workspace;
    if (target.owner === "workspace") {
      const baseline = this.baselines.get(target.id);
      const doc = app?.store.openDocs.find(open => open.id === target.id);
      if (!app || !doc || !baseline) return this.discard(result.token);
      this.baselines.set(doc.id, {
        name: result.name, text: captured, dirty: false, ...(baseline.key ? { key: baseline.key } : {}), ...(binding ? { binding } : {}),
      });
      app.store.rename(doc.id, result.name);
      return doc.text === captured ? "saved" : "saved-newer-edits";
    }
    const doc = app ? undefined : this.reader.documents.find(open => open.id === target.id);
    if (!doc) return this.discard(result.token);
    doc.name = result.name;
    doc.dirty = doc.text !== captured;
    if (binding) doc.binding = binding; else delete doc.binding;
    return doc.dirty ? "saved-newer-edits" : "saved";
  }

  /** A completion nobody can adopt: release any capability the host just created. */
  private discard(token: string | null): SaveCompletion {
    if (token) this.onRelease(token);
    return "stale";
  }

  /** The open document bound to `token`, in whichever mode owns it now. */
  byToken(token: string): SaveTarget | null {
    const app = this.workspace;
    if (app) {
      for (const doc of app.store.openDocs) {
        const binding = this.baselines.get(doc.id)?.binding;
        if (binding?.token === token) {
          return { owner: "workspace", id: doc.id, name: doc.name, text: doc.text, dirty: this.workspaceDirty(doc), binding };
        }
      }
      return null;
    }
    const doc = this.reader.documents.find(open => open.binding?.token === token);
    return doc ? { owner: "reader", id: doc.id, name: doc.name, text: doc.text, dirty: doc.dirty, ...(doc.binding ? { binding: doc.binding } : {}) } : null;
  }

  /** Record what the watcher found on disk for `token` (shown by the shell). */
  markDisk(token: string, disk: DiskState): void {
    const target = this.byToken(token);
    if (target?.binding) target.binding.disk = disk;
  }

  /**
   * Install text the host re-read and adopted: the open text and its saved
   * baseline both become the file's new content. Callers only do this for a
   * clean document or after an explicit Reload.
   */
  applyReload(target: SaveTarget, result: Extract<ReadResult, { outcome: "changed" }> & { text: string }): boolean {
    // Never let an older re-read (overtaken by a newer one) install older text.
    const current = target.owner === "workspace" ? this.baselines.get(target.id)?.binding : this.reader.documents.find(open => open.id === target.id)?.binding;
    if (current && result.generation < current.generation) return false;
    const update = (binding: Binding): void => {
      Object.assign(binding, { generation: result.generation, encoding: result.encoding, eol: result.eol, disk: "synced" });
    };
    const app = this.workspace;
    if (target.owner === "workspace") {
      const baseline = this.baselines.get(target.id);
      if (!app || !baseline?.binding || !app.store.openDocs.some(doc => doc.id === target.id)) return false;
      update(baseline.binding);
      this.baselines.set(target.id, { ...baseline, text: result.text, dirty: false });
      // Re-seed the editor too: updateText would leave the textarea on the old text.
      app.store.replaceText(target.id, result.text);
      return true;
    }
    const doc = app ? undefined : this.reader.documents.find(open => open.id === target.id);
    if (!doc?.binding) return false;
    update(doc.binding);
    doc.text = result.text;
    doc.dirty = false;
    return true;
  }

  /** Close a reader document and release its native capability. */
  closeReaderDocument(id: string): void {
    const token = this.reader.documents.find(doc => doc.id === id)?.binding?.token;
    this.reader.close(id);
    if (token) this.onRelease(token);
  }

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
    const target = app ? this.boundedWorkspace(app) : this.reader;
    const count = target.documents.length;
    const errors = target.append(incoming, owns);
    const accepted = target.documents.slice(count);
    // The host registered every opened file; release the ones admission refused.
    const admitted = new Set(accepted.map(doc => doc.binding?.token));
    for (const doc of incoming) {
      if (doc.binding && !admitted.has(doc.binding.token)) this.onRelease(doc.binding.token);
    }
    if (!app) return errors;
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

  /**
   * Drop baselines for documents the workspace closed. `release` is false while
   * a mode transition empties the store: those documents move, they are not closed.
   */
  pruneBaselines(release = true): void {
    const app = this.workspace;
    if (!app) return;
    const openIds = new Set(app.store.openDocs.map(doc => doc.id));
    for (const [id, baseline] of this.baselines) {
      if (openIds.has(id)) continue;
      this.baselines.delete(id);
      // Undo Close restores an unbound document; it cannot revive this capability.
      if (release && baseline.binding) this.onRelease(baseline.binding.token);
    }
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
