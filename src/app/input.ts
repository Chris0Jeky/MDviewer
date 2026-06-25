/**
 * Document ingestion: drag-and-drop, clipboard paste, and the hidden file picker.
 *
 * This module owns the *acquisition* side only — validation (extension + MIME),
 * size guarding, and producing `Doc`s in the `DocStore`. The actual render pipeline
 * is driven by `App` via the store's "change" event; we never paginate here.
 *
 * Everything is local-first: files are read with `FileReader`/`File.text()` in the
 * browser. Nothing is uploaded and no document bytes are persisted.
 */

import type { Doc, DocStore } from "./state";
import { IDS } from "./dom";

/** Extensions we accept. Lower-case, dot-prefixed. */
export const MD_EXTENSIONS: readonly string[] = [".md", ".markdown"];

/**
 * Soft cap: above this we ask the user to confirm before paginating, because a very
 * large document can freeze the main thread during Paged.js layout (Section 11).
 */
export const SIZE_SOFT_BYTES = 2_000_000;

/** Hard cap: above this we refuse outright — pagination would be unusable. */
export const SIZE_HARD_BYTES = 25_000_000;

export interface OpenResult {
  opened: Doc[];
  skipped: string[];
}

/** MIME types a browser may attach to a markdown file (varies by OS/browser). */
const MD_MIME_TYPES = new Set([
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "application/markdown",
]);

/** Lower-cased extension including the leading dot, or "" if none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * A file is markdown if its extension is one we accept. MIME is advisory only — many
 * platforms report `text/plain` or an empty type for `.md`, so a recognised extension
 * always wins. An explicitly *non-text* MIME (e.g. image/pdf) with a markdown extension
 * is still treated as markdown, because the extension is the user's stated intent and
 * the content is read as text regardless.
 */
export function isMarkdownFile(name: string, mime: string): boolean {
  const ext = extensionOf(name);
  if (MD_EXTENSIONS.includes(ext)) return true;
  const m = mime.toLowerCase();
  // No usable extension: trust a positively-markdown/plain MIME (text/plain covers
  // the common "extensionless note" case). Otherwise require an explicit markdown MIME.
  if (!ext) return MD_MIME_TYPES.has(m);
  // Has some other extension but a markdown MIME → accept.
  return m === "text/markdown" || m === "text/x-markdown";
}

/** Partition a batch into acceptable markdown files and rejected file names. */
export function classifyFiles(files: File[]): { accept: File[]; reject: string[] } {
  const accept: File[] = [];
  const reject: string[] = [];
  for (const file of files) {
    if (isMarkdownFile(file.name, file.type)) accept.push(file);
    else reject.push(file.name);
  }
  return { accept, reject };
}

/** Strip a path/extension down to a friendly display name. */
function displayName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base || "Untitled.md";
}

/**
 * Build a `Doc` from raw text. Pure and async to keep a single ingestion shape across
 * paste (sync text) and file reads (async). Does not touch the store.
 */
export async function openMarkdown(text: string, filename: string): Promise<Doc> {
  // Normalise line endings so downstream measurement/markdown parsing is stable.
  const normalized = text.replace(/\r\n?/g, "\n");
  return Promise.resolve({
    id: "", // assigned by DocStore.add
    name: displayName(filename),
    text: normalized,
  });
}

/** True if the user is currently typing into a real text field (so paste shouldn't hijack). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/** True if a DataTransfer carries files (vs. text/links). */
function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes("Files")) return true;
  return dt.items ? Array.from(dt.items).some((i) => i.kind === "file") : false;
}

interface ReadBatch {
  opened: Doc[];
  rejected: string[];
}

/**
 * Read accepted files into `Doc`s, enforcing the size gate. Files over the hard cap are
 * skipped; files over the soft cap require the `onLargeFile` confirmation. The first file
 * that passes the gate becomes active (handled by the store).
 */
async function readFiles(
  files: File[],
  onLargeFile: (bytes: number) => Promise<boolean>,
): Promise<ReadBatch> {
  const { accept, reject } = classifyFiles(files);
  const opened: Doc[] = [];
  const rejected = [...reject];

  for (const file of accept) {
    if (file.size > SIZE_HARD_BYTES) {
      rejected.push(file.name);
      continue;
    }
    if (file.size > SIZE_SOFT_BYTES) {
      const proceed = await onLargeFile(file.size);
      if (!proceed) {
        rejected.push(file.name);
        continue;
      }
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      rejected.push(file.name);
      continue;
    }
    opened.push(await openMarkdown(text, file.name));
  }
  return { opened, rejected };
}

/**
 * Wire global ingestion handlers and return a teardown function. The caller (App) owns
 * the store; we push docs into it and let the store's "change" event drive rendering.
 *
 * - dragenter/dragover: show the drop overlay and allow the drop (only for file drags).
 * - dragleave/drop: hide the overlay.
 * - drop: read accepted markdown files into the store.
 * - paste: when not focused in a field, open the clipboard text as a new untitled doc.
 * - #file-input change: read picked files into the store.
 */
export function installInputHandlers(
  store: DocStore,
  opts: {
    onReject(names: string[]): void;
    onLargeFile(bytes: number): Promise<boolean>;
  },
): () => void {
  const overlay = document.getElementById(IDS.dragOverlay);
  const fileInput = document.getElementById(IDS.fileInput) as HTMLInputElement | null;

  // Depth counter: nested dragenter/leave events fire per child element; only hide the
  // overlay when the cursor has truly left the window.
  let dragDepth = 0;

  const showOverlay = (): void => {
    if (overlay) overlay.hidden = false;
  };
  const hideOverlay = (): void => {
    dragDepth = 0;
    if (overlay) overlay.hidden = true;
  };

  const commit = (batch: ReadBatch): void => {
    for (const doc of batch.opened) store.add(doc.name, doc.text);
    if (batch.rejected.length > 0) opts.onReject(batch.rejected);
  };

  const onDragEnter = (e: DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth += 1;
    showOverlay();
  };

  const onDragOver = (e: DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (e: DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth -= 1;
    if (dragDepth <= 0) hideOverlay();
  };

  const onDrop = (e: DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    hideOverlay();
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
    if (files.length === 0) return;
    void readFiles(files, opts.onLargeFile).then(commit);
  };

  const onPaste = (e: ClipboardEvent): void => {
    if (isEditableTarget(e.target)) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text.trim()) return;
    e.preventDefault();
    void openMarkdown(text, "Pasted.md").then((doc) => store.add(doc.name, doc.text));
  };

  const onFileInputChange = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    // Reset so picking the same file again re-fires change.
    input.value = "";
    if (files.length === 0) return;
    void readFiles(files, opts.onLargeFile).then(commit);
  };

  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
  window.addEventListener("paste", onPaste);
  fileInput?.addEventListener("change", onFileInputChange);

  return () => {
    window.removeEventListener("dragenter", onDragEnter);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("dragleave", onDragLeave);
    window.removeEventListener("drop", onDrop);
    window.removeEventListener("paste", onPaste);
    fileInput?.removeEventListener("change", onFileInputChange);
    hideOverlay();
  };
}
