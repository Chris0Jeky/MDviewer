import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface OpenBatch {
  documents: Array<{
    name: string; text: string; bytes: number;
    // Present for host-opened files (companion push S0a). Display only: the
    // webview never sends a path back; it refers to a file by its token.
    token?: string | null; path?: string; dir?: string;
    encoding?: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be";
    eol?: "lf" | "crlf" | "cr" | "mixed" | "none";
  }>;
  errors: Array<{ name: string; message: string }>;
  canceled: boolean;
}

/** A native Save / Save As completion (src-tauri/src/commands/save.rs). */
export type SaveResult =
  | {
    outcome: "saved"; token: string | null; generation: number; name: string; path: string; dir: string;
    encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be"; eol: "lf" | "crlf" | "cr" | "mixed" | "none";
  }
  | { outcome: "canceled" }
  | { outcome: "conflict"; reason: "changed" | "missing" | "replaced" | "locked" }
  | { outcome: "mixed-line-endings" }
  | { outcome: "failed"; code: string };

/** A library entry (src-tauri/src/commands/library.rs); `path`/`dir` are display-only. */
export interface LibraryEntry { id: string; name: string; dir: string; path: string; at: number }
export interface LibraryView { recent: LibraryEntry[]; pinned: LibraryEntry[]; projects: LibraryEntry[] }
export interface ProjectFile {
  id: string; name: string; relative: string; path: string;
  /** Last modified, Unix ms. */ modified: number;
  /** CLAUDE.md, AGENTS.md, SKILL.md, .claude/agents/*.md, MEMORY.md, memory/*.md, HUMAN_TODO.md, ACTION_ITEMS.md, ORCHESTRATOR.md. */
  agent: boolean;
  /** Changed since it was last opened from the library or marked seen. */ unseen: boolean;
}
export interface ProjectScan { files: ProjectFile[]; truncated: boolean }

/** A live-reload re-read (src-tauri/src/commands/reload.rs). */
export type ReadResult =
  | { outcome: "unchanged" }
  | {
    outcome: "changed"; text: string | null; generation: number;
    encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be"; eol: "lf" | "crlf" | "cr" | "mixed" | "none";
  }
  | { outcome: "missing" }
  | { outcome: "failed"; code: string };

const SAVE_LIMIT = 25_000_000;
// An unpaired surrogate cannot be encoded faithfully; never write U+FFFD in its place.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function saveBody(text: string): Uint8Array {
  if (LONE_SURROGATE.test(text)) throw new Error("This document contains an invalid Unicode character and cannot be saved exactly.");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > SAVE_LIMIT) throw new Error("This document exceeds the 25 MB save limit.");
  return bytes;
}

export const native = {
  available: isTauri(),
  open: (): Promise<OpenBatch> => invoke("open_files"),
  takePending: (): Promise<OpenBatch> => invoke("take_pending_files"),
  external: (url: string): Promise<void> => invoke("open_external", { url }),
  save: async (blob: Blob, filename: string): Promise<{ canceled: boolean }> => {
    if (blob.size > 128 * 1024 * 1024) throw new Error("This export exceeds 128 MiB. Use Print / Save as PDF for a smaller file.");
    return invoke("save_export", new Uint8Array(await blob.arrayBuffer()), {
      headers: { "x-mdviewer-filename": encodeURIComponent(filename) },
    });
  },
  /** Save in place through the document's capability; never sends a path. */
  saveDocument: (token: string, generation: number, text: string, acceptLf: boolean): Promise<SaveResult> =>
    invoke("save_document", saveBody(text), { headers: {
      "x-mdviewer-token": token, "x-mdviewer-generation": String(generation), "x-mdviewer-accept-lf": acceptLf ? "1" : "0",
    } }),
  /** Ask for a destination in the native dialog, then save and rebind there. */
  saveDocumentAs: (token: string | null, name: string, text: string, acceptLf: boolean): Promise<SaveResult> =>
    invoke("save_document_as", saveBody(text), { headers: {
      "x-mdviewer-token": token ?? "", "x-mdviewer-filename": encodeURIComponent(name), "x-mdviewer-accept-lf": acceptLf ? "1" : "0",
    } }),
  releaseDocument: (token: string): Promise<void> => invoke("release_document", { token }),
  /** Re-read a bound file after a change notification; `adopt` moves the binding to the new bytes. */
  readDocument: (token: string, adopt: boolean, generation: number): Promise<ReadResult> =>
    invoke("read_document", { token, adopt, generation }),
  /** The library (S4). Entries are opaque ids; the webview never sends a path. */
  library: {
    list: (): Promise<LibraryView> => invoke("library_list"),
    scan: (id: string): Promise<ProjectScan> => invoke("library_scan", { id }),
    open: (id: string): Promise<OpenBatch> => invoke("library_open", { id }),
    pinDocument: (token: string): Promise<boolean> => invoke("library_pin", { token, id: null }),
    pinEntry: (id: string): Promise<boolean> => invoke("library_pin", { token: null, id }),
    unpin: (id: string): Promise<void> => invoke("library_unpin", { id }),
    forget: (id: string): Promise<void> => invoke("library_forget", { id }),
    markSeen: (id: string): Promise<void> => invoke("library_mark_seen", { id }),
    /** Opens the native folder picker; resolves to the new project's id or null on cancel. */
    addProject: (): Promise<string | null> => invoke("library_add_project"),
    clear: (): Promise<void> => invoke("library_clear"),
  },
  /** Open a relative Markdown link or @import from the bound document `token`. */
  openRelative: (token: string, href: string): Promise<OpenBatch> => invoke("open_relative", { token, href }),
  /** Bytes of a local image referenced by the bound document `token` (typed, 20 MB cap). */
  readAsset: (token: string, src: string): Promise<ArrayBuffer> => invoke("read_asset", { token, src }),
  /** The last session (S7): paths stay native; the webview sends tokens. */
  session: {
    record: (tokens: string[]): Promise<void> => invoke("session_record", { tokens }),
    restore: (): Promise<OpenBatch> => invoke("session_restore"),
    setting: (restore: boolean | null): Promise<{ restore: boolean }> => invoke("session_setting", { restore }),
  },
  /** Changed files arrive as capability tokens only, never paths or contents. */
  onFilesChanged: (callback: (tokens: string[]) => void): Promise<() => void> =>
    listen<string[]>("mdviewer:files-changed", event => callback(event.payload)),
  onPending: (callback: () => void): Promise<() => void> => listen("mdviewer:files-pending", callback),
  onClose: (canClose: () => boolean): Promise<() => void> => getCurrentWindow().onCloseRequested(async event => {
    // Prevent before awaiting: the host otherwise destroys the window immediately.
    event.preventDefault();
    if (canClose()) await getCurrentWindow().destroy();
  }),
};
