import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBatch } from "../src/desktop/native";

// The real desktop entry and command registry; the native host is stubbed.
const boundary = vi.hoisted(() => ({
  pending: vi.fn(), render: vi.fn(), libraryOpen: vi.fn(), pin: vi.fn(), addProject: vi.fn(), clear: vi.fn(),
}));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: vi.fn(), takePending: boundary.pending, releaseDocument: vi.fn(async () => {}),
  library: { open: boundary.libraryOpen, pinDocument: boundary.pin, addProject: boundary.addProject, clear: boundary.clear },
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}), onFilesChanged: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: vi.fn() }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/export/destination", () => ({ SaveCanceled: class extends Error {}, setDownloadDestination: vi.fn() }));

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const TOKEN = "b".repeat(32);
const batch = (name: string, text: string, token: string | null = TOKEN): OpenBatch => ({
  documents: [{ name, text, bytes: text.length, token, path: `C:\\p\\${name}`, dir: "C:\\p", encoding: "utf-8", eol: "lf" }],
  errors: [], canceled: false,
});
const shown = () => document.getElementById("reader-document")!.textContent;
const notice = () => document.getElementById("reader-notice")!.textContent ?? "";

beforeEach(async () => {
  vi.resetModules();
  for (const mock of Object.values(boundary)) mock.mockReset();
  boundary.pending.mockResolvedValue({ documents: [], errors: [], canceled: false });
  boundary.render.mockImplementation(async (text: string) => {
    const rendered = document.createElement("div"); rendered.textContent = text;
    return { document: rendered, warnings: [] };
  });
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      add(type, listener, options);
      removeListeners.push(() => target.removeEventListener(type, listener, options));
    });
  }
  await import("../src/desktop/main");
  await vi.waitFor(() => expect(boundary.pending).toHaveBeenCalledOnce());
});
afterEach(() => {
  removeListeners.splice(0).forEach(remove => remove());
  document.body.replaceChildren();
});

describe("desktop library seam", () => {
  it("opens an entry by id through the same batch path as the picker", async () => {
    const { openLibraryEntry } = await import("../src/desktop/library");
    boundary.libraryOpen.mockResolvedValueOnce(batch("CLAUDE.md", "# Project rules"));
    await openLibraryEntry("l7");
    expect(boundary.libraryOpen).toHaveBeenCalledWith("l7");
    await vi.waitFor(() => expect(shown()).toBe("# Project rules"));
    boundary.libraryOpen.mockResolvedValueOnce({ documents: [], errors: [{ name: "gone.md", message: "Could not read this file." }], canceled: false });
    await openLibraryEntry("l8");
    expect(notice()).toContain("gone.md: Could not read this file.");
  });

  it("pins the bound document, pins projects through the picker and clears only after confirming", async () => {
    const { runCommand, listCommands } = await import("../src/desktop/commands");
    expect(listCommands().map(command => command.id)).toEqual(expect.arrayContaining(["library.pinDocument", "library.addProject", "library.clear"]));
    expect(runCommand("library.pinDocument"), "no bound document yet").toBe(false);
    boundary.libraryOpen.mockResolvedValueOnce(batch("notes.md", "# Notes"));
    const { openLibraryEntry } = await import("../src/desktop/library");
    await openLibraryEntry("l1");
    await vi.waitFor(() => expect(shown()).toBe("# Notes"));
    boundary.pin.mockResolvedValueOnce(true);
    expect(runCommand("library.pinDocument")).toBe(true);
    await vi.waitFor(() => expect(notice()).toBe("Pinned notes.md."));
    expect(boundary.pin).toHaveBeenCalledWith(TOKEN);
    boundary.addProject.mockResolvedValueOnce("l2");
    runCommand("library.addProject");
    await vi.waitFor(() => expect(notice()).toBe("Project pinned to the library."));
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    runCommand("library.clear");
    await Promise.resolve();
    expect(boundary.clear).not.toHaveBeenCalled();
    runCommand("library.clear");
    await vi.waitFor(() => expect(boundary.clear).toHaveBeenCalledOnce());
    confirm.mockRestore();
  });
});
