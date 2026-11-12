import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseTemplate, isTemplatePath } from "../src/desktop/shell/templates";
import { activeTab } from "./helpers/desktopTabs";

// The real desktop entry; the native host is stubbed, including the template read (A4).
const boundary = vi.hoisted(() => ({
  pending: vi.fn(), render: vi.fn(), list: vi.fn(), scan: vi.fn(), readTemplate: vi.fn(), open: vi.fn(),
}));
vi.mock("../src/desktop/native", () => ({ native: {
  available: true, open: boundary.open, takePending: boundary.pending, releaseDocument: vi.fn(async () => {}),
  library: { list: boundary.list, scan: boundary.scan, readTemplate: boundary.readTemplate },
  onPending: vi.fn(async () => () => {}), onClose: vi.fn(async () => () => {}), onFilesChanged: vi.fn(async () => () => {}),
} }));
vi.mock("../src/desktop/workspace", () => ({ startWorkspace: vi.fn() }));
vi.mock("../src/desktop/render", () => ({ renderReaderDocument: boundary.render }));
vi.mock("../src/desktop/edit", () => ({
  mountEditor: () => ({ input: document.createElement("textarea"), setDocument: vi.fn(), focus: vi.fn(), destroy: vi.fn() }),
  mountSplitter: (root: HTMLElement) => { root.append(Object.assign(document.createElement("div"), { id: "split-handle" })); return { sync: vi.fn(), destroy: vi.fn() }; },
}));

// jsdom has <dialog> but not its modal methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); };
});

const html = readFileSync("desktop.html", "utf8");
const removeListeners: Array<() => void> = [];
const TEMPLATE = "# {{title}}\n\nOwner: {{owner}}\nNote: {{note}}\nOn {{date}}\nKeep {{unknown-later}}\n";
const field = (name: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`.shell-template-form input[name="${name}"]`)!;
const submit = (): void => { document.querySelector<HTMLFormElement>(".shell-template-form")!.requestSubmit(); };

describe("template module", () => {
  it("lists only Markdown files directly inside templates/", () => {
    expect(["templates/meeting.md", "templates\\plan.markdown", "templates/deep/x.md", "notes/templates/x.md", "templates/a.json"].map(isTemplatePath))
      .toEqual([true, true, false, false, false]);
  });

  it("asks each field once; a typed value is plain text and cannot add a placeholder", async () => {
    const source = { list: vi.fn(async () => [{ id: "t1", name: "Meeting notes.md", project: "board" }]), read: vi.fn(async () => ({ name: "Meeting notes.md", text: TEMPLATE })) };
    const chosen = chooseTemplate(source, () => new Date(2026, 10, 12, 9, 5));
    await vi.waitFor(() => expect(document.querySelector(".shell-template-pick")).not.toBeNull());
    (document.querySelector(".shell-template-pick") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(field("owner")).not.toBeNull());
    expect([...document.querySelectorAll(".shell-template-form input")].map(input => (input as HTMLInputElement).name)).toEqual(["owner", "note", "unknown-later"]);
    expect(document.activeElement).toBe(field("owner"));
    field("owner").value = "Ada";
    field("note").value = "{{owner}} said {{date}}";
    submit();
    const result = await chosen;
    expect(result?.title).toBe("Meeting notes");
    expect(result?.text).toBe("# Meeting notes\n\nOwner: Ada\nNote: {{owner}} said {{date}}\nOn 2026-11-12\nKeep {{unknown-later}}\n"); // left empty: kept as written
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("an unfilled name the form did not ask for stays as written; Escape cancels", async () => {
    const source = { list: vi.fn(async () => [{ id: "t1", name: "plain.md", project: "board" }]), read: vi.fn(async () => ({ name: "plain.md", text: "# {{title}}\n" })) };
    const chosen = chooseTemplate(source);
    await vi.waitFor(() => expect(document.querySelector(".shell-template-pick")).not.toBeNull());
    document.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(await chosen).toBeNull();
  });

  it("says where templates come from when there are none", async () => {
    const chosen = chooseTemplate({ list: vi.fn(async () => []), read: vi.fn() });
    await vi.waitFor(() => expect(document.querySelector("dialog")!.textContent).toContain("templates folder inside a pinned project"));
    (document.querySelector(".shell-template-cancel") as HTMLButtonElement).click();
    expect(await chosen).toBeNull();
  });
});

describe("New from template in the desktop entry", () => {
  beforeEach(async () => {
    vi.resetModules();
    for (const mock of Object.values(boundary)) mock.mockReset();
    boundary.pending.mockResolvedValue({ documents: [], errors: [], canceled: false });
    boundary.render.mockImplementation(async (text: string) => {
      const rendered = document.createElement("div"); rendered.textContent = text;
      return { document: rendered, warnings: [] };
    });
    boundary.list.mockResolvedValue({ recent: [], pinned: [], projects: [{ id: "p1", name: "board", dir: "C:\\work", path: "C:\\work\\board", at: 1 }] });
    boundary.scan.mockResolvedValue({ truncated: false, files: [
      { id: "f1", name: "Meeting notes.md", relative: "templates\\Meeting notes.md", path: "", modified: 1, agent: false, unseen: false },
      { id: "f2", name: "README.md", relative: "README.md", path: "", modified: 1, agent: false, unseen: false },
    ] });
    boundary.readTemplate.mockResolvedValue({ name: "Meeting notes.md", text: "# {{title}}\n\nOwner: {{owner}}\n" });
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

  it("opens the filled template as an unsaved untitled note in Edit, reading only templates/", async () => {
    const { runCommand } = await import("../src/desktop/commands");
    expect(runCommand("document.newFromTemplate")).toBe(true);
    await vi.waitFor(() => expect(document.querySelectorAll(".shell-template-pick")).toHaveLength(1));
    expect(document.querySelector(".shell-template-pick")!.textContent).toContain("Meeting notes");
    (document.querySelector(".shell-template-pick") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(field("owner")).not.toBeNull());
    expect(boundary.readTemplate).toHaveBeenCalledWith("f1");
    expect(boundary.open).not.toHaveBeenCalled(); // no library_open: no Recent entry, seen mark or binding
    field("owner").value = "Ada";
    submit();
    await vi.waitFor(() => expect(document.getElementById("reader-document")!.textContent).toBe("# Meeting notes\n\nOwner: Ada\n"));
    expect(activeTab()).toBe("• Untitled.md"); // unsaved
    expect(document.getElementById("reader-edit")!.hidden).toBe(false);
  });
});
