import type { LibraryEntry, OpenBatch, ProjectFile, ProjectScan } from "../native";
import { decodeText } from "./codec";
import {
  MAX_IMAGE_BYTES, MAX_TEMPLATE_BYTES, SCAN_DEPTH, SCAN_FILES, imageType, isAgentData, isAgentFile, isMarkdownName,
  isScanned, isSkippedFolder, isTemplate, resolveReference, withMarkdownExtension,
} from "./paths";

/**
 * Granted folders on the browser host (web parity W4). The user grants a folder with
 * `showDirectoryPicker`; it becomes a project. Relative links, `@imports`, `[[name]]` links,
 * local images and templates resolve inside a granted folder only (`paths.ts`), never above it,
 * and a document opened on its own is located inside a granted folder with `resolve()`. Nothing
 * here is persisted yet: the handle store arrives with W5.
 */
type Permission = "granted" | "denied" | "prompt";
interface Permissioned {
  queryPermission?(options: { mode: "read" | "readwrite" }): Promise<Permission>;
  requestPermission?(options: { mode: "read" | "readwrite" }): Promise<Permission>;
}
export interface DirHandle extends FileSystemDirectoryHandle, Permissioned {}
interface Project { id: string; handle: DirHandle; at: number }
interface Scanned { project: Project; segments: string[]; handle: FileSystemFileHandle }

/** A link from a document no granted folder holds: the shell offers to grant one. */
export class NeedsFolder extends Error {
  constructor(message: string) { super(message); this.name = "NeedsFolder"; }
}

export const MAX_PROJECTS = 64;

export interface FolderDeps {
  /** Open files as bound documents (the host's ordinary open). */
  open(handles: FileSystemFileHandle[]): Promise<OpenBatch>;
  /** The file handle behind a bound document's token. */
  handleOf(token: string): FileSystemFileHandle | undefined;
  /** Ask the user for a folder; rejects with AbortError on cancel. */
  pick(): Promise<DirHandle>;
}

const newId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, "0")).join("");

async function readable(handle: Permissioned): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if (await handle.queryPermission({ mode: "read" }) === "granted") return true;
  // Asked, never assumed: the browser shows its own prompt (it needs a click to be allowed to).
  return await handle.requestPermission?.({ mode: "read" }).catch(() => "denied") === "granted";
}

async function fileAt(root: DirHandle, segments: readonly string[]): Promise<FileSystemFileHandle> {
  let dir: FileSystemDirectoryHandle = root;
  for (const part of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return dir.getFileHandle(segments.at(-1)!);
}

export function createFolders(deps: FolderDeps) {
  let projects: Project[] = [];
  let scanned = new Map<string, Scanned>();

  const entry = (project: Project): LibraryEntry => ({ id: project.id, name: project.handle.name, dir: "", path: project.handle.name, at: project.at });

  /** The granted folder holding a bound document, and the document's place in it. */
  async function locate(token: string): Promise<{ project: Project; segments: string[] } | null> {
    const handle = deps.handleOf(token);
    if (!handle) return null;
    for (const project of projects) {
      const segments = await project.handle.resolve(handle).catch(() => null);
      if (segments?.length) return { project, segments };
    }
    return null;
  }

  async function located(token: string, what: string): Promise<{ project: Project; segments: string[] }> {
    if (!deps.handleOf(token)) throw new Error("This document is no longer linked to its file.");
    const place = await locate(token);
    if (!place) throw new NeedsFolder(`${what} resolve inside a folder you choose. Choose the folder that holds this document to follow them.`);
    if (!await readable(place.project.handle)) throw new Error(`MDviewer no longer has access to ${place.project.handle.name}. Choose it again.`);
    return place;
  }

  return {
    list: (): LibraryEntry[] => projects.map(entry),
    has: (id: string): boolean => projects.some(project => project.id === id),

    /** Grant a folder; the same folder twice is one project. Resolves to its id, or null on cancel. */
    async add(): Promise<string | null> {
      let handle: DirHandle;
      try { handle = await deps.pick(); }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return null; throw error; }
      for (const project of projects) if (await project.handle.isSameEntry(handle)) return project.id;
      if (projects.length >= MAX_PROJECTS) throw new Error(`The library holds at most ${MAX_PROJECTS} projects. Remove one first.`);
      const project = { id: newId(), handle, at: Date.now() };
      projects = [...projects, project];
      return project.id;
    },

    remove(id: string): void { projects = projects.filter(project => project.id !== id); },
    clear(): void { projects = []; scanned = new Map(); },

    /** The bounded walk of `library.rs` `scan`: depth 8, 5,000 files, the same skips and listings. */
    async scan(id: string): Promise<ProjectScan> {
      const project = projects.find(item => item.id === id);
      if (!project) throw new Error("This project is no longer in the library.");
      if (!await readable(project.handle)) throw new Error(`MDviewer no longer has access to ${project.handle.name}. Choose it again.`);
      for (const [key, value] of scanned) if (value.project === project) scanned.delete(key);
      const files: ProjectFile[] = [];
      let truncated = false;
      const stack: Array<{ dir: DirHandle; segments: string[] }> = [{ dir: project.handle, segments: [] }];
      walk: while (stack.length) {
        const { dir, segments } = stack.pop()!;
        try {
          for await (const [name, child] of dir.entries()) {
            const path = [...segments, name];
            if (child.kind === "directory") {
              if (isSkippedFolder(path)) continue;
              if (path.length >= SCAN_DEPTH) { truncated = true; continue; }
              stack.push({ dir: child as DirHandle, segments: path });
            } else if (isScanned(path)) {
              if (files.length >= SCAN_FILES) { truncated = true; break walk; }
              const handle = child as FileSystemFileHandle;
              const modified = await handle.getFile().then(file => file.lastModified, () => 0);
              const id = newId();
              scanned.set(id, { project, segments: path, handle });
              const relative = path.join("/");
              files.push({ id, name, relative, path: `${project.handle.name}/${relative}`, modified,
                agent: isAgentFile(path) || isAgentData(path), unseen: false });
            }
          }
        } catch { continue; } // an unreadable folder is skipped, as natively
      }
      files.sort((a, b) => b.modified - a.modified);
      return { files, truncated };
    },

    /** Open a scanned file as a bound document; false when the id is not a scanned file. */
    async open(id: string): Promise<OpenBatch | null> {
      const file = scanned.get(id);
      if (!file) return null;
      return deps.open([file.handle]);
    },

    /** A template's text, read-only (`read_template`): directly in `templates/`, Markdown, at most 1 MB. */
    async readTemplate(id: string): Promise<{ name: string; text: string }> {
      const file = scanned.get(id);
      if (!file || !isTemplate(file.segments)) throw new Error("This is not a template of a pinned project.");
      const blob = await file.handle.getFile().catch(() => { throw new Error("This template could not be read."); });
      if (blob.size > MAX_TEMPLATE_BYTES) throw new Error("This template is larger than 1 MB.");
      return { name: blob.name, text: decodeText(new Uint8Array(await blob.arrayBuffer())).text };
    },

    /** Open a relative Markdown link or `@import` from the bound document `token`. */
    async openRelative(token: string, href: string): Promise<OpenBatch> {
      const place = await located(token, "Local links");
      const target = resolveReference(place.segments, href);
      if (!target) throw new Error("This link does not point to a local document inside the folder you chose.");
      const segments = withMarkdownExtension(target);
      if (!isMarkdownName(segments.at(-1)!)) throw new Error("Links open Markdown documents only. Open other files with Open.");
      let handle: FileSystemFileHandle;
      try { handle = await fileAt(place.project.handle, segments); }
      catch { return { documents: [], errors: [{ name: segments.at(-1)!, message: "This linked file does not exist." }], canceled: false }; }
      return deps.open([handle]);
    },

    /** Bytes of a local image the bound document `token` references (typed, 20 MB cap). */
    async readAsset(token: string, src: string): Promise<ArrayBuffer> {
      const place = await located(token, "Local images").catch(error => { throw new Error(error instanceof NeedsFolder ? "not-local" : "unreadable"); });
      const target = resolveReference(place.segments, src);
      if (!target) throw new Error("not-local");
      if (!imageType(target.at(-1)!)) throw new Error("unsupported-type");
      const file = await fileAt(place.project.handle, target).then(handle => handle.getFile()).catch(() => { throw new Error("unreadable"); });
      if (file.size > MAX_IMAGE_BYTES) throw new Error("too-large");
      return file.arrayBuffer();
    },
  };
}
