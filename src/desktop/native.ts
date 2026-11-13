import { tauriHost } from "./hosts/tauri";

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

/** One actionable-Markdown line patch (docs/design/ACTIONABLE_MARKDOWN.md, "Write-back"); `line` is 1-based. */
export interface LinePatch { line: number; id?: string | null; expect: string; replace: string }
/** A2 result. `unplaced`: nothing written; `index` is the 0-based position of the unplaced patch in the change. */
export type PatchResult =
  | { outcome: "saved"; generation: number; text: string }
  | { outcome: "unplaced"; index: number; text: string }
  | { outcome: "failed"; code: string };

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

/**
 * The host contract (web parity W0). Everything the shell asks of the platform goes through one
 * `Host`; nothing else calls `invoke`. Documents are referred to by opaque tokens and library
 * entries by opaque ids: the webview never sends a path. `available` is false where no host
 * backs the shell (a plain browser today), and callers fall back to a file input and Save Copy.
 */
export interface Host {
  readonly available: boolean;
  open(): Promise<OpenBatch>;
  takePending(): Promise<OpenBatch>;
  /**
   * Open dropped files bound to their files, or null when this host cannot (the shell then reads
   * them as unbound copies). `copies` hands back files that have no file behind them, to be
   * read as copies. Call synchronously inside the drop event: the items expire after it.
   */
  openDropped?(items: DataTransferItemList): Promise<OpenBatch | { copies: File[] }> | null;
  external(url: string): Promise<void>;
  /** Save an export (PDF, Markdown copy, data) to a destination the user picks; without it, exports download. */
  save?(blob: Blob, filename: string): Promise<{ canceled: boolean }>;
  /** Apply line patches to the bound document `token` as one conflict-checked change. */
  patchDocument(token: string, patches: LinePatch[]): Promise<PatchResult>;
  /** Save in place through the document's capability; never sends a path. */
  saveDocument(token: string, generation: number, text: string, acceptLf: boolean): Promise<SaveResult>;
  /** Ask for a destination, then save and rebind there. */
  saveDocumentAs(token: string | null, name: string, text: string, acceptLf: boolean): Promise<SaveResult>;
  releaseDocument(token: string): Promise<void>;
  /** Re-read a bound file after a change notification; `adopt` moves the binding to the new bytes. */
  readDocument(token: string, adopt: boolean, generation: number): Promise<ReadResult>;
  /** The library (S4). Entries are opaque ids. */
  library: {
    list(): Promise<LibraryView>;
    scan(id: string): Promise<ProjectScan>;
    open(id: string): Promise<OpenBatch>;
    pinDocument(token: string): Promise<boolean>;
    pinEntry(id: string): Promise<boolean>;
    unpin(id: string): Promise<void>;
    forget(id: string): Promise<void>;
    markSeen(id: string): Promise<void>;
    /** Opens a folder picker; resolves to the new project's id or null on cancel. */
    addProject(): Promise<string | null>;
    clear(): Promise<void>;
    /** A template's text (A4): read-only; no binding, Recent entry, seen mark or library write. */
    readTemplate(id: string): Promise<{ name: string; text: string }>;
  };
  /** Open a relative Markdown link or @import from the bound document `token`. */
  openRelative(token: string, href: string): Promise<OpenBatch>;
  /** Bytes of a local image referenced by the bound document `token` (typed, 20 MB cap). */
  readAsset(token: string, src: string): Promise<ArrayBuffer>;
  /** The last session (S7): the webview sends tokens. */
  session: {
    record(tokens: string[]): Promise<void>;
    restore(): Promise<OpenBatch>;
    setting(restore: boolean | null): Promise<{ restore: boolean; persisted: boolean }>;
  };
  /** Changed files arrive as capability tokens only, never paths or contents. */
  onFilesChanged(callback: (tokens: string[]) => void): Promise<() => void>;
  onPending(callback: () => void): Promise<() => void>;
  onClose(canClose: () => boolean, beforeClose?: () => Promise<void>): Promise<() => void>;
}

/**
 * Windows runs `tauriHost`. Only a web-shell build (`VITE_MDV_BROWSER_HOST=1`) loads the browser
 * host, and only outside Tauri; in the Windows build the condition folds to false and the browser
 * host is not bundled. Where the browser host has no File System Access API its `available` is
 * false and the shell keeps its file-input and download fallbacks.
 */
export const native: Host = !tauriHost.available && import.meta.env.VITE_MDV_BROWSER_HOST === "1"
  ? (await import("./hosts/browser")).browserHost
  : tauriHost;
