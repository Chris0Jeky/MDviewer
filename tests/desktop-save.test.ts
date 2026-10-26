import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadMarkdown } from "../src/export/markdown";
import { SaveCanceled, setDownloadDestination } from "../src/export/destination";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), onClose: vi.fn(), destroy: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: ipc.onClose, destroy: ipc.destroy }) }));
import { native } from "../src/desktop/native";

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  ipc.invoke.mockReset().mockResolvedValue({ canceled: false });
  ipc.onClose.mockReset().mockResolvedValue(() => {});
  ipc.destroy.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { setDownloadDestination(null); vi.unstubAllGlobals(); });

it("routes exact source bytes to an awaited native save without a browser download", async () => {
  const source = "# Café → λ\n\nLast unsaved edit\n";
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const saved = new Promise<void>(resolve => { finish = resolve; });
  const destination = vi.fn(async (blob: Blob, filename: string) => {
    expect(await blob.text()).toBe(source);
    expect(filename).toBe("notes.md");
    started();
    await saved;
  });
  setDownloadDestination(destination);
  let completed = false;
  const exported = Promise.resolve(downloadMarkdown("C:\\notes.md", source)).then(() => { completed = true; });
  await entered;
  expect(completed).toBe(false);
  expect(document.querySelector("a[download]")).toBeNull();
  finish();
  await exported;
  expect(completed).toBe(true);
  expect(destination).toHaveBeenCalledTimes(1);
});

it("does not convert native cancellation or write failure into a browser download", async () => {
  setDownloadDestination(async () => { throw new SaveCanceled(); });
  await expect(downloadMarkdown("note.md", "keep me")).rejects.toBeInstanceOf(SaveCanceled);
  setDownloadDestination(async () => { throw new Error("Unable to save export."); });
  await expect(downloadMarkdown("note.md", "keep me")).rejects.toThrow("Unable to save export.");
  expect(document.querySelector("a[download]")).toBeNull();
});

it("sends raw UTF-8 bytes and an encoded filename, retaining cancellation", async () => {
  ipc.invoke.mockResolvedValueOnce({ canceled: true });
  const result = await native.save(new Blob(["café"]), "Résumé notes.md");
  expect(result).toEqual({ canceled: true });
  expect(ipc.invoke).toHaveBeenCalledTimes(1);
  const [command, bytes, options] = ipc.invoke.mock.calls[0]!;
  expect(command).toBe("save_export");
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(Array.from(bytes as Uint8Array)).toEqual([99, 97, 102, 195, 169]);
  expect(options).toEqual({
    headers: { "x-mdviewer-filename": "R%C3%A9sum%C3%A9%20notes.md" },
  });
});

it("refuses oversize exports before allocating or calling IPC", async () => {
  const arrayBuffer = vi.fn();
  await expect(native.save({ size: 128 * 1024 * 1024 + 1, arrayBuffer } as unknown as Blob, "large.pdf"))
    .rejects.toThrow("128 MiB");
  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(ipc.invoke).not.toHaveBeenCalled();
});

it("blocks native close first and destroys only after the host guard permits it", async () => {
  let allowed = false;
  await native.onClose(() => allowed);
  const callback = ipc.onClose.mock.calls[0]![0] as (event: { preventDefault(): void }) => Promise<void>;
  const preventDefault = vi.fn();
  await callback({ preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(ipc.destroy).not.toHaveBeenCalled();
  allowed = true;
  await callback({ preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(2);
  expect(ipc.destroy).toHaveBeenCalledTimes(1);
});
