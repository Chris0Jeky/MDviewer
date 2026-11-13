import type { Host, OpenBatch, PatchResult, ReadResult, SaveResult } from "../native";
import { applyPatches, type LinePatch } from "../../render/actionable";
import { MAX_FILE_BYTES, decodeText, detectEol, digestOf, documentExtension, encodeRaw, encodeText, type Encoding, type Eol } from "./codec";

/**
 * The browser host (web parity W1): the `Host` contract over the File System Access API.
 * A document is bound only to a handle the user picked, dropped or launched the app with.
 * Save re-reads the file and compares size, last-modified time and SHA-256 with what this
 * document last read or wrote before writing: it checks for outside changes before writing,
 * but a write by another program between that check and the commit is not excluded (the
 * native host holds the file open across that window; a browser cannot). Nothing here is
 * persisted: tokens and handles live in page memory until W5 adds the handle store.
 */

// The parts of the File System Access API this host uses (Chromium; not in lib.dom yet).
type Permission = "granted" | "denied" | "prompt";
interface Handle extends FileSystemFileHandle {
  queryPermission?(options: { mode: "read" | "readwrite" }): Promise<Permission>;
  requestPermission?(options: { mode: "read" | "readwrite" }): Promise<Permission>;
}
interface PickerType { description: string; accept: Record<string, string[]> }
interface PickerWindow {
  showOpenFilePicker?(options: { multiple?: boolean; types?: PickerType[]; excludeAcceptAllOption?: boolean }): Promise<Handle[]>;
  showSaveFilePicker?(options: { suggestedName?: string; types?: PickerType[] }): Promise<Handle>;
  launchQueue?: { setConsumer(consumer: (params: { files: readonly Handle[] }) => void): void };
}
const picker = (): PickerWindow => window as unknown as PickerWindow;

const MAX_BATCH_FILES = 32;
const SAVE_EXPORT_LIMIT = 128 * 1024 * 1024;
const DOCUMENT_TYPES: PickerType[] = [
  { description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } },
  { description: "Data and text", accept: { "text/plain": [".json", ".jsonc", ".jsonl", ".ndjson", ".txt", ".log", ".yaml", ".yml", ".toml", ".csv", ".tsv"] } },
];

interface Binding {
  handle: Handle;
  size: number;
  modified: number;
  digest: string;
  encoding: Encoding;
  eol: Eol;
  generation: number;
}
const bindings = new Map<string, Binding>();
const pending: Handle[] = [];
const pendingListeners = new Set<() => void>();
let saving = false;

function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";
const isMissing = (error: unknown): boolean => error instanceof DOMException && error.name === "NotFoundError";

async function permitted(handle: Handle, mode: "read" | "readwrite"): Promise<boolean> {
  if (!handle.queryPermission) return true; // Engines without the permission model grant picked handles.
  if (await handle.queryPermission({ mode }) === "granted") return true;
  return await handle.requestPermission?.({ mode }) === "granted";
}

interface Snapshot { size: number; modified: number; bytes: Uint8Array; digest: string }
async function snapshot(handle: Handle): Promise<Snapshot> {
  const file = await handle.getFile();
  if (file.size > MAX_FILE_BYTES) throw new Error("This selection exceeds the 25 MB limit. Open fewer or smaller files.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { size: file.size, modified: file.lastModified, bytes, digest: await digestOf(bytes) };
}

/** Read handles as one batch, under the native read's file-type, count and size rules. */
async function readHandles(handles: readonly Handle[]): Promise<OpenBatch> {
  const batch: OpenBatch = { documents: [], errors: [], canceled: false };
  let total = 0;
  for (const handle of handles.slice(0, MAX_BATCH_FILES)) {
    try {
      if (handle.kind !== "file") throw new Error("Choose a regular file, not a folder or device.");
      if (!documentExtension(handle.name)) {
        throw new Error("Only Markdown, JSON, JSON Lines, YAML, TOML, CSV, TSV and plain text (.txt, .log) files are supported.");
      }
      if (!await permitted(handle, "read")) throw new Error("Could not read this file. Check that you have access.");
      const read = await snapshot(handle);
      if (total + read.size > MAX_FILE_BYTES) throw new Error("This selection exceeds the 25 MB limit. Open fewer or smaller files.");
      total += read.size;
      const { text, encoding, eol } = decodeText(read.bytes);
      if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error("Decoded text exceeds the 25 MB limit. Open fewer or smaller files.");
      const token = newToken();
      bindings.set(token, { handle, size: read.size, modified: read.modified, digest: read.digest, encoding, eol, generation: 0 });
      batch.documents.push({ name: handle.name, text, bytes: read.size, token, path: handle.name, dir: "", encoding, eol });
    } catch (error) {
      batch.errors.push({ name: handle.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (handles.length > MAX_BATCH_FILES) {
    batch.errors.push({ name: "Extra files", message: `${handles.length - MAX_BATCH_FILES} more files were not opened. Open at most 32 files at once.` });
  }
  return batch;
}

/** Write `bytes` if the file still holds what `expected` describes; `null` expects no file yet. */
async function writeIfUnchanged(binding: Binding, expected: Pick<Binding, "size" | "modified" | "digest"> | null, bytes: Uint8Array):
  Promise<{ ok: true; snapshot: Snapshot } | { ok: false; result: SaveResult }> {
  if (!await permitted(binding.handle, "readwrite")) return { ok: false, result: { outcome: "failed", code: "permission-denied" } };
  let current: File | null = null;
  try { current = await binding.handle.getFile(); }
  catch (error) {
    if (!isMissing(error)) return { ok: false, result: { outcome: "conflict", reason: "locked" } };
    if (expected) return { ok: false, result: { outcome: "conflict", reason: "missing" } };
  }
  // Size and time first (cheap); the digest catches an equal-size edit with a restored time.
  if (current && (!expected || current.size !== expected.size || current.lastModified !== expected.modified
    || await digestOf(new Uint8Array(await current.arrayBuffer())) !== expected.digest)) {
    return { ok: false, result: { outcome: "conflict", reason: "changed" } };
  }
  try {
    // Chromium writes to a temporary file and swaps it in on close; an abort leaves the original.
    const writable = await binding.handle.createWritable({ keepExistingData: false });
    try { await writable.write(bytes as Uint8Array<ArrayBuffer>); await writable.close(); }
    catch (error) { await writable.abort().catch(() => undefined); throw error; }
  } catch (error) {
    return { ok: false, result: isMissing(error) ? { outcome: "conflict", reason: "missing" } : { outcome: "failed", code: "write-failed" } };
  }
  const written = await binding.handle.getFile();
  return { ok: true, snapshot: { size: written.size, modified: written.lastModified, bytes, digest: await digestOf(bytes) } };
}

function adopt(binding: Binding, written: Snapshot, eol: Eol): void {
  binding.size = written.size;
  binding.modified = written.modified;
  binding.digest = written.digest;
  binding.eol = eol === "mixed" ? "lf" : eol;
}

function savedResult(token: string, binding: Binding): SaveResult {
  const { name } = binding.handle;
  return { outcome: "saved", token, generation: binding.generation, name, path: name, dir: "", encoding: binding.encoding, eol: binding.eol };
}

async function exclusive<T>(busy: T, run: () => Promise<T>): Promise<T> {
  if (saving) return busy;
  saving = true;
  try { return await run(); } finally { saving = false; }
}

function encodeFor(binding: Pick<Binding, "encoding" | "eol">, text: string, acceptLf: boolean): { bytes: Uint8Array } | { refused: SaveResult } {
  const encoded = encodeText(text, binding.encoding, binding.eol, acceptLf);
  if ("bytes" in encoded) return encoded;
  return { refused: encoded.error === "mixed-line-endings" ? { outcome: "mixed-line-endings" } : { outcome: "failed", code: "too-large" } };
}

const unavailable = (what: string) => async (): Promise<never> => { throw new Error(`${what} is not available in this browser yet.`); };

export const browserHost: Host = {
  available: typeof picker().showOpenFilePicker === "function" && typeof picker().showSaveFilePicker === "function",

  async open() {
    let handles: Handle[];
    try { handles = await picker().showOpenFilePicker!({ multiple: true, types: DOCUMENT_TYPES }); }
    catch (error) { if (isAbort(error)) return { documents: [], errors: [], canceled: true }; throw error; }
    return readHandles(handles);
  },

  async takePending() {
    return readHandles(pending.splice(0));
  },

  openDropped(items) {
    type WithHandle = DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> };
    const files = Array.from(items).filter(item => item.kind === "file") as WithHandle[];
    if (!browserHost.available || !files.length || !files.every(item => typeof item.getAsFileSystemHandle === "function")) return null;
    // Every handle is requested now, inside the event; reading them can wait.
    const handles = Promise.all(files.map(item => item.getAsFileSystemHandle!()));
    return handles.then(list => readHandles(list.filter((handle): handle is Handle => handle !== null)));
  },

  async external(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  async save(blob, filename) {
    if (blob.size > SAVE_EXPORT_LIMIT) throw new Error("This export exceeds 128 MiB. Use Print / Save as PDF for a smaller file.");
    let handle: Handle;
    try { handle = await picker().showSaveFilePicker!({ suggestedName: filename }); }
    catch (error) { if (isAbort(error)) return { canceled: true }; throw error; }
    const writable = await handle.createWritable({ keepExistingData: false });
    try { await writable.write(blob); await writable.close(); }
    catch (error) { await writable.abort().catch(() => undefined); throw error; }
    return { canceled: false };
  },

  async patchDocument(token, patches: LinePatch[]): Promise<PatchResult> {
    const binding = bindings.get(token);
    if (!binding) return { outcome: "failed", code: "revoked" };
    for (let attempt = 0; attempt < 2; attempt++) {
      let read: Snapshot;
      try { read = await snapshot(binding.handle); }
      catch (error) { return { outcome: "failed", code: isMissing(error) ? "missing" : "unreadable" }; }
      let decoded: ReturnType<typeof decodeText>;
      try { decoded = decodeText(read.bytes); } catch { return { outcome: "failed", code: "encoding" }; }
      const lines = decoded.text.split(/\r\n|\r|\n/);
      const index = patches.findIndex(patch => /[\r\n]/.test(patch.replace) || lines[patch.line - 1] !== patch.expect);
      if (index >= 0) {
        if (/[\r\n]/.test(patches[index]!.replace)) return { outcome: "failed", code: "invalid" };
        return { outcome: "unplaced", index, text: decoded.text };
      }
      const text = applyPatches(decoded.text, patches);
      const bytes = encodeRaw(text, decoded.encoding);
      if (bytes.length > MAX_FILE_BYTES) return { outcome: "failed", code: "too-large" };
      const written = await writeIfUnchanged(binding, read, bytes);
      if (!written.ok) {
        if (written.result.outcome === "conflict" && written.result.reason === "changed" && attempt === 0) continue;
        return { outcome: "failed", code: patchFailure(written.result) };
      }
      if (bindings.get(token) !== binding) return { outcome: "failed", code: "revoked-after-write" };
      binding.encoding = decoded.encoding;
      adopt(binding, written.snapshot, detectEol(text));
      binding.generation += 1;
      return { outcome: "saved", generation: binding.generation, text };
    }
    return { outcome: "failed", code: "conflict" };
  },

  saveDocument(token, generation, text, acceptLf) {
    return exclusive<SaveResult>({ outcome: "failed", code: "busy" }, async () => {
      const binding = bindings.get(token);
      if (!binding) return { outcome: "failed", code: "revoked" };
      if (binding.generation !== generation) return { outcome: "failed", code: "stale" };
      const encoded = encodeFor(binding, text, acceptLf);
      if ("refused" in encoded) return encoded.refused;
      const { bytes } = encoded;
      const eol = binding.eol;
      const written = await writeIfUnchanged(binding, binding, bytes);
      if (!written.ok) return written.result;
      if (bindings.get(token) !== binding || binding.generation !== generation) return { outcome: "failed", code: "revoked-after-write" };
      adopt(binding, written.snapshot, eol);
      binding.generation += 1;
      return savedResult(token, binding);
    });
  },

  saveDocumentAs(token, name, text, acceptLf) {
    return exclusive<SaveResult>({ outcome: "failed", code: "busy" }, async () => {
      const own = token ? bindings.get(token) : undefined;
      if (token && !own) return { outcome: "failed", code: "revoked" };
      const style = own ?? { encoding: "utf-8" as const, eol: "lf" as const };
      const encoded = encodeFor(style, text, acceptLf);
      if ("refused" in encoded) return encoded.refused;
      const { bytes } = encoded;
      let handle: Handle;
      try { handle = await picker().showSaveFilePicker!({ suggestedName: name, types: DOCUMENT_TYPES }); }
      catch (error) { if (isAbort(error)) return { outcome: "canceled" }; throw error; }
      if (!documentExtension(handle.name)) return { outcome: "failed", code: "invalid-destination" };
      if (token && bindings.get(token) !== own) return { outcome: "failed", code: "revoked" };
      // This document's own file gets exactly Save's check; the picker's confirmation never bypasses it.
      const same = own ? await own.handle.isSameEntry(handle) : false;
      const target: Binding = same && own ? { ...own } : {
        handle, size: 0, modified: 0, digest: "", encoding: style.encoding, eol: style.eol, generation: 0,
      };
      let expected: Binding | null = target;
      if (!same) {
        // Another file: compare against what it held when it was chosen (nothing, if it is new).
        try {
          const chosen = await snapshot(handle);
          Object.assign(target, { size: chosen.size, modified: chosen.modified, digest: chosen.digest });
        } catch (error) {
          if (!isMissing(error)) return { outcome: "conflict", reason: "locked" };
          expected = null;
        }
      }
      const written = await writeIfUnchanged(target, expected, bytes);
      if (!written.ok) return written.result;
      if (token) bindings.delete(token);
      const next = newToken();
      const binding: Binding = { ...target, handle, encoding: style.encoding, generation: 0 };
      adopt(binding, written.snapshot, style.eol);
      bindings.set(next, binding);
      return savedResult(next, binding);
    });
  },

  async releaseDocument(token) {
    bindings.delete(token);
  },

  async readDocument(token, adoptChange, seen): Promise<ReadResult> {
    const binding = bindings.get(token);
    if (!binding) return { outcome: "failed", code: "revoked" };
    // A save, patch or other re-read can move the binding while this read is in flight; a read
    // that began before the move may hold older bytes and must not be adopted as newer (#256,
    // as `reload.rs` does). Retry it; after three tries report busy and change nothing.
    let read: Snapshot | null = null;
    for (let attempt = 0; attempt < 3 && !read; attempt++) {
      const before = binding.generation;
      let current: Snapshot;
      try { current = await snapshot(binding.handle); }
      catch (error) { return isMissing(error) ? { outcome: "missing" } : { outcome: "failed", code: "unreadable" }; }
      if (bindings.get(token) !== binding) return { outcome: "failed", code: "revoked" };
      if (binding.generation === before || current.digest === binding.digest) read = current;
    }
    if (!read) return { outcome: "failed", code: "busy" };
    if (read.digest === binding.digest) {
      binding.modified = read.modified; // A rewrite with the same bytes is not a change.
      if (binding.generation === seen) return { outcome: "unchanged" };
      const text = adoptChange ? safeDecode(read.bytes) : null;
      return { outcome: "changed", text, generation: binding.generation, encoding: binding.encoding, eol: binding.eol };
    }
    if (!adoptChange) return { outcome: "changed", text: null, generation: binding.generation, encoding: binding.encoding, eol: binding.eol };
    let decoded: ReturnType<typeof decodeText>;
    try { decoded = decodeText(read.bytes); } catch { return { outcome: "failed", code: "unreadable" }; }
    Object.assign(binding, { size: read.size, modified: read.modified, digest: read.digest, encoding: decoded.encoding, eol: decoded.eol });
    binding.generation += 1;
    return { outcome: "changed", text: decoded.text, generation: binding.generation, encoding: binding.encoding, eol: binding.eol };
  },

  library: {
    list: async () => ({ recent: [], pinned: [], projects: [] }),
    scan: unavailable("The library"),
    open: unavailable("The library"),
    pinDocument: async () => false,
    pinEntry: async () => false,
    unpin: async () => undefined,
    forget: async () => undefined,
    markSeen: async () => undefined,
    addProject: async () => null,
    clear: async () => undefined,
    readTemplate: unavailable("Templates"),
  },
  openRelative: unavailable("Opening linked files"),
  readAsset: unavailable("Local images"),
  session: {
    record: async () => undefined,
    restore: async () => ({ documents: [], errors: [], canceled: false }),
    setting: async () => ({ restore: false, persisted: false }),
  },
  onFilesChanged: async () => () => undefined,
  async onPending(callback) {
    pendingListeners.add(callback);
    return () => { pendingListeners.delete(callback); };
  },
  async onClose(_canClose, beforeClose = async () => {}) {
    // The browser owns closing; the page's beforeunload guard asks about unsaved text.
    const hide = (): void => { void beforeClose().catch(() => undefined); };
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  },
};

function patchFailure(result: SaveResult): string {
  if (result.outcome === "failed") return result.code;
  if (result.outcome === "conflict") return result.reason === "missing" ? "missing" : result.reason === "locked" ? "unreadable" : "conflict";
  return "conflict";
}

function safeDecode(bytes: Uint8Array): string | null {
  try { return decodeText(bytes).text; } catch { return null; }
}

// Files the installed app was launched with (PWA `file_handlers`).
picker().launchQueue?.setConsumer(params => {
  if (!params.files.length) return;
  pending.push(...params.files);
  for (const listener of pendingListeners) listener();
});
