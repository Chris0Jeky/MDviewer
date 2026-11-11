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

/** One actionable-Markdown line patch (docs/design/ACTIONABLE_MARKDOWN.md, "Write-back"). */
export interface LinePatch { line: number; id?: string | null; expect: string; replace: string }
/** A2 result. `unplaced`: nothing written; re-derive patch `index` from `text` and retry once. */
export type PatchResult =
  | { outcome: "saved"; generation: number; text: string }
  | { outcome: "unplaced"; index: number; text: string }
  | { outcome: "failed"; code: string };

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
  /** Apply line patches to the bound document `token` as one conflict-checked change. */
  patchDocument: (token: string, patches: LinePatch[]): Promise<PatchResult> =>
    invoke("patch_document", { token, patches }),
  onPending: (callback: () => void): Promise<() => void> => listen("mdviewer:files-pending", callback),
  onClose: (canClose: () => boolean): Promise<() => void> => getCurrentWindow().onCloseRequested(async event => {
    // Prevent before awaiting: the host otherwise destroys the window immediately.
    event.preventDefault();
    if (canClose()) await getCurrentWindow().destroy();
  }),
};
