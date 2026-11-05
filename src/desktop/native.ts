import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface OpenBatch {
  documents: Array<{ name: string; text: string; bytes: number }>;
  errors: Array<{ name: string; message: string }>;
  canceled: boolean;
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
  onPending: (callback: () => void): Promise<() => void> => listen("mdviewer:files-pending", callback),
  onClose: (canClose: () => boolean): Promise<() => void> => getCurrentWindow().onCloseRequested(async event => {
    // Prevent before awaiting: the host otherwise destroys the window immediately.
    event.preventDefault();
    if (canClose()) await getCurrentWindow().destroy();
  }),
};
