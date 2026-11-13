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
}
export interface FakeState { calls: Array<[string, Record<string, unknown>]> }
declare global { interface Window { __fake: FakeState } }

export const fakeEntry = (id: string, name: string, dir: string): FakeEntry => ({ id, name, dir, path: `${dir}\\${name}`, at: 1 });

export async function installFakeHost(page: Page, seed: FakeSeed = {}): Promise<void> {
  await page.addInitScript((seed: FakeSeed) => {
    const empty = { documents: [], errors: [], canceled: false };
    const state = {
      recent: [...(seed.recent ?? [])], pinned: [...(seed.pinned ?? [])], projects: [...(seed.projects ?? [])],
      seen: new Set<string>(),
    };
    const fake: FakeState = { calls: [] };
    window.__fake = fake;
    let callback = 0;
    let saved = 0;
    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
      take_pending_files: () => empty,
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
