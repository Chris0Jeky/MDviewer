import type { Page } from "@playwright/test";

/**
 * One in-memory Windows host for the desktop e2e suite (web parity W0). It answers at the Tauri IPC
 * layer, so the shell runs its real `tauriHost` (`src/desktop/hosts/tauri.ts`) against it: the
 * commands, their arguments and their result shapes are the ones `src-tauri/src/commands` serves.
 * State lives in page memory, ids are opaque, and the webview never sends a path. Native bounds,
 * the store and the file system are proven by the Rust tests and the native smoke, not here.
 */
export interface FakeEntry { id: string; name: string; dir: string; path: string; at: number }
export interface FakeFile { id: string; name: string; relative: string; path: string; modified: number; agent: boolean; unseen: boolean }
export interface FakeSeed {
  recent?: FakeEntry[];
  pinned?: FakeEntry[];
  projects?: FakeEntry[];
  /** Scan results by project id; a project without one fails to scan ("The folder is missing."). */
  scans?: Record<string, Array<Omit<FakeFile, "unseen"> & { seen?: boolean }>>;
  /** Openable entries by id: [name, text]. */
  texts?: Record<string, [string, string]>;
  /** Templates by id: [name, text]. */
  templates?: Record<string, [string, string]>;
  /** Where Save As "chooses" to write. */
  saveAs?: { name: string; dir: string };
  /** Files passed at launch, [name, text]: the first `take_pending_files` returns them, bound. */
  pending?: Array<[string, string]>;
  /** PDFs by library id: [name, bytes as base64]. `library_open` returns them as `kind: "pdf"`. */
  pdfs?: Record<string, [string, string]>;
}
export interface FakeState { calls: Array<[string, Record<string, unknown>]>; files: Record<string, string> }
declare global { interface Window { __fake: FakeState } }

export const fakeEntry = (id: string, name: string, dir: string): FakeEntry => ({ id, name, dir, path: `${dir}\\${name}`, at: 1 });

export async function installFakeHost(page: Page, seed: FakeSeed = {}): Promise<void> {
  await page.addInitScript((seed: FakeSeed) => {
    const empty = { documents: [], errors: [], canceled: false };
    const state = {
      recent: [...(seed.recent ?? [])], pinned: [...(seed.pinned ?? [])], projects: [...(seed.projects ?? [])],
      seen: new Set<string>(),
    };
    const fake: FakeState = { calls: [], files: {} };
    window.__fake = fake;
    let callback = 0;
    let saved = 0;
    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
      take_pending_files: () => {
        const launch = (seed.pending ?? []).splice(0).map(([name, text], index) => {
          const token = `p${index}`.padEnd(32, "0");
          fake.files[token] = text;
          return { name, text, bytes: text.length, token, path: `C:\\work\\${name}`, dir: "C:\\work", encoding: "utf-8", eol: "lf" };
        });
        return { documents: launch, errors: [], canceled: false };
      },
      // The A2 line patch: each patch replaces one line whose current text is `expect`.
      patch_document: ({ token, patches }) => {
        const text = fake.files[token as string];
        if (text === undefined) return { outcome: "failed", code: "revoked" };
        const lines = text.split("\n");
        for (const patch of patches as Array<{ line: number; expect: string; replace: string }>) {
          if (lines[patch.line - 1] !== patch.expect) return { outcome: "unplaced", index: 0, text };
          lines[patch.line - 1] = patch.replace;
        }
        fake.files[token as string] = lines.join("\n");
        return { outcome: "saved", generation: ++saved, text: fake.files[token as string] };
      },
      session_restore: () => empty,
      library_list: () => ({ recent: state.recent, pinned: state.pinned, projects: state.projects }),
      library_read_template: ({ id }) => {
        const found = seed.templates?.[id as string];
        if (!found) throw new Error("This library entry is no longer available.");
        return { name: found[0], text: found[1] };
      },
      library_scan: ({ id }) => {
        const files = seed.scans?.[id as string];
        if (!files) throw new Error("The folder is missing.");
        return { files: files.map(({ seen, ...file }) => ({ ...file, unseen: !seen && !state.seen.has(file.id) })), truncated: false };
      },
      library_open: ({ id }) => {
        const pdf = seed.pdfs?.[id as string];
        if (pdf) {
          const token = (id as string).padEnd(32, "0");
          return { documents: [{ name: pdf[0], text: "", bytes: 0, token, path: `C:\\work\\${pdf[0]}`, dir: "C:\\work", encoding: "utf-8", eol: "none", kind: "pdf" }], errors: [], canceled: false };
        }
        const [name, text] = seed.texts?.[id as string] ?? ["missing.md", "# Missing\n"];
        state.seen.add(id as string);
        const document = { name, text, bytes: text.length, token: (id as string).padEnd(32, "0"), path: `C:\\work\\board\\${name}`, dir: "C:\\work\\board", encoding: "utf-8", eol: "lf" };
        return { documents: [document], errors: [], canceled: false };
      },
      library_pin: ({ id }) => {
        const found = state.recent.find(item => item.id === id);
        if (!found) return false;
        if (!state.pinned.some(item => item.id === id)) state.pinned.push(found);
        return true;
      },
      library_unpin: ({ id }) => {
        state.pinned = state.pinned.filter(item => item.id !== id);
        state.projects = state.projects.filter(item => item.id !== id);
      },
      library_forget: ({ id }) => { state.recent = state.recent.filter(item => item.id !== id); },
      library_mark_seen: ({ id }) => { state.seen.add(id as string); },
      library_clear: () => { state.recent = []; state.pinned = []; state.projects = []; },
      save_document_as: () => {
        if (!seed.saveAs) return { outcome: "canceled" };
        const { name, dir } = seed.saveAs;
        return { outcome: "saved", token: "s".repeat(32), generation: ++saved, name, path: `${dir}/${name}`, dir, encoding: "utf-8", eol: "lf" };
      },
      read_pdf: ({ token }) => {
        const found = Object.entries(seed.pdfs ?? {}).find(([id]) => id.padEnd(32, "0") === token);
        if (!found) throw new Error("revoked");
        return Uint8Array.from(atob(found[1][1]), c => c.charCodeAt(0)).buffer;
      },
      "plugin:event|listen": () => ++callback,
    };
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        transformCallback: () => ++callback,
        convertFileSrc: (path: string) => path,
        invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
          // Byte bodies (Save) are not recorded; only command names and object arguments.
          fake.calls.push([cmd, args instanceof Uint8Array ? {} : args]);
          const handler = handlers[cmd];
          return handler ? handler(args) : null;
        },
      },
    });
  }, seed);
}

/** Command names the shell sent, in order. */
export const fakeCalls = (page: Page): Promise<string[]> => page.evaluate(() => window.__fake.calls.map(([cmd]) => cmd));
