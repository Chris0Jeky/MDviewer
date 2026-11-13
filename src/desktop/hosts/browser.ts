import type { Host, OpenBatch, PatchResult, ReadResult, SaveResult } from "../native";
import { applyPatches, type LinePatch } from "../../render/actionable";
import { MAX_FILE_BYTES, decodeText, detectEol, digestOf, documentExtension, encodeRaw, encodeText, type Encoding, type Eol } from "./codec";

/**
 * The browser host (web parity W1): the `Host` contract over the File System Access API.
 * A document is bound only to a handle the user picked, dropped or launched the app with.
 * Save re-reads the file and compares its bytes (size, then SHA-256) with what this document
 * last read or wrote before writing: it checks for outside changes before writing,
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
  showSaveFilePicker?(options: { suggestedName?: string; types?: PickerType[]; excludeAcceptAllOption?: boolean }): Promise<Handle>;
  launchQueue?: { setConsumer(consumer: (params: { files: readonly Handle[] }) => void): void };
}
const picker = (): PickerWindow => window as unknown as PickerWindow;

const MAX_BATCH_FILES = 32;
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
      batch.errors.push({ name: handle?.name ?? "Dropped file", message: error instanceof Error ? error.message : String(error) });
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
    // With nothing expected (Save As, past the picker) there is nothing to compare: try the write.
    if (expected && !isMissing(error)) return { ok: false, result: { outcome: "conflict", reason: "locked" } };
    if (expected) return { ok: false, result: { outcome: "conflict", reason: "missing" } };
  }
  // The bytes decide, as natively: size first (cheap), then the digest, which catches an
  // equal-size edit with a restored time. A touched file with the same bytes is not a change.
  if (current && expected && (current.size !== expected.size
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
  // The bytes are on disk; the time is only a hint for following the file, so a failed stat is not a failed save.
  const modified = await binding.handle.getFile().then(file => file.lastModified, () => 0);
  return { ok: true, snapshot: { size: bytes.length, modified, bytes, digest: await digestOf(bytes) } };
}

/** Move the binding to the bytes just written; `eol` is what those bytes now use. */
function adopt(binding: Binding, written: Snapshot, eol: Eol): void {
  binding.size = written.size;
  binding.modified = written.modified;
  binding.digest = written.digest;
  binding.eol = eol;
}
/** An untitled or Markdown name saves as Markdown; a data or text name stays in that family. */
function familyOf(name: string): "markdown" | "data" {
  const extension = documentExtension(name);
  return extension === null || extension === "md" || extension === "markdown" ? "markdown" : "data";
}

/** A Save writes a mixed source as LF (after consent); every other style is kept. */
const savedEol = (eol: Eol): Eol => eol === "mixed" ? "lf" : eol;

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
    // Every handle (and the plain file, for an item without one) is taken now, inside the event.
    const plain = files.map(item => item.getAsFile());
    const handles = Promise.all(files.map(item => item.getAsFileSystemHandle!().catch(() => null)));
    return handles.then(async list => {
      if (list.every(handle => handle?.kind === "file" || handle?.kind === "directory")) return readHandles(list as Handle[]);
      // Some item has no file behind it (from an archive or another app): open everything as a
      // copy rather than silently dropping it. The shell's own reader applies the usual rules.
      return { copies: plain.filter((file): file is File => file !== null) };
    });
  },

  async external(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  // No `save`: exports (PDF, Save a copy) stay ordinary browser downloads, as on the web today,
  // so an export can never be written over a bound document.

  async patchDocument(token, patches: LinePatch[]): Promise<PatchResult> {
    const binding = bindings.get(token);
    if (!binding) return { outcome: "failed", code: "revoked" };
    // The native shape rules (`linepatch.rs`): 1 to 256 patches, distinct lines, no NUL.
    if (!patches.length || patches.length > 256
      || patches.some(patch => !Number.isInteger(patch.line) || patch.line < 1 || /[\0\r\n]/.test(patch.expect) || /\0/.test(patch.replace))) {
      return { outcome: "failed", code: "invalid" };
    }
    const repeated = patches.findIndex((patch, index) => patches.findIndex(other => other.line === patch.line) !== index);
    for (let attempt = 0; attempt < 2; attempt++) {
      let read: Snapshot;
      try { read = await snapshot(binding.handle); }
      catch (error) { return { outcome: "failed", code: isMissing(error) ? "missing" : "unreadable" }; }
      let decoded: ReturnType<typeof decodeText>;
      try { decoded = decodeText(read.bytes); } catch { return { outcome: "failed", code: "encoding" }; }
      const lines = decoded.text.split(/\r\n|\r|\n/);
      const misplaced = patches.findIndex(patch => /[\r\n]/.test(patch.replace) || lines[patch.line - 1] !== patch.expect);
      const index = misplaced >= 0 && (repeated < 0 || misplaced < repeated) ? misplaced : repeated;
      if (index >= 0) {
        if (/[\r\n]/.test(patches[index]!.replace)) return { outcome: "failed", code: "invalid" };
        return { outcome: "unplaced", index, text: decoded.text };
      }
      const text = applyPatches(decoded.text, patches);
      let bytes: Uint8Array;
      try { bytes = encodeRaw(text, decoded.encoding); } catch { return { outcome: "failed", code: "encoding" }; } // a lone surrogate
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
      adopt(binding, written.snapshot, savedEol(eol));
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
      // Like `export_destination`, the picker offers only the document's kind of extension.
      let handle: Handle;
      try {
        handle = await picker().showSaveFilePicker!({
          suggestedName: name, types: [DOCUMENT_TYPES[familyOf(name) === "markdown" ? 0 : 1]!], excludeAcceptAllOption: true,
        });
      } catch (error) { if (isAbort(error)) return { outcome: "canceled" }; throw error; }
      // The picker is the commit point. Chromium may already have created or emptied the chosen
      // file when it returns, so refusing now could leave an empty file where the user confirmed
      // a replacement: every refusal happens before the picker, and from here the text is written.
      // (Natively, Save As onto the document's own changed file is refused; here it replaces it.)
      const binding: Binding = { handle, size: 0, modified: 0, digest: "", encoding: style.encoding, eol: style.eol, generation: 0 };
      const written = await writeIfUnchanged(binding, null, bytes);
      if (!written.ok) return written.result;
      adopt(binding, written.snapshot, savedEol(style.eol));
      // The document closed while the picker was open: the text is on disk, nothing is bound.
      if (token && bindings.get(token) !== own) return { outcome: "failed", code: "revoked-after-write" };
      if (token) bindings.delete(token);
      const next = newToken();
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
