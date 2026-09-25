import { afterEach, describe, expect, it } from "vitest";
import { mountDocumentShortcuts } from "../src/ui/DocumentShortcuts";

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((stop) => stop()); document.body.replaceChildren(); });

function fixture() {
  const root = document.createElement("div");
  root.innerHTML = `<div class="workspace-actions"><button class="workspace-action">Open</button></div>
    <div class="workspace-session"><span class="workspace-privacy">Memory only</span>
    <button class="workspace-action" title="Save source">Save</button></div>`;
  document.body.append(root);
  const open = root.querySelector<HTMLButtonElement>(".workspace-actions button")!;
  const save = root.querySelector<HTMLButtonElement>(".workspace-session button")!;
  const clicked = { open: 0, save: 0 };
  open.addEventListener("click", () => { clicked.open++; });
  save.addEventListener("click", () => { clicked.save++; });
  const stop = mountDocumentShortcuts(root);
  cleanups.push(stop);
  function key(init: KeyboardEventInit, handled = false): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    if (handled) event.preventDefault();
    window.dispatchEvent(event);
    return event;
  }
  return { root, open, save, clicked, stop, key };
}

describe("local document shortcuts", () => {
  for (const modifier of ["ctrlKey", "metaKey"] as const) {
    it(`routes ${modifier} actions through the existing buttons`, () => {
      const t = fixture();
      expect(t.key({ key: "S", [modifier]: true }).defaultPrevented).toBe(true);
      expect(t.key({ key: "o", [modifier]: true }).defaultPrevented).toBe(true);
      expect(t.clicked).toEqual({ open: 1, save: 1 });
    });
  }

  it.each<KeyboardEventInit>([
    { key: "s" }, { key: "p", ctrlKey: true }, { key: "s", ctrlKey: true, shiftKey: true },
    { key: "s", ctrlKey: true, altKey: true }, { key: "s", ctrlKey: true, metaKey: true },
    { key: "s", ctrlKey: true, isComposing: true },
  ])("leaves unrelated, modified and composition events alone (%j)", (init) => {
    const t = fixture();
    expect(t.key(init).defaultPrevented).toBe(false);
    expect(t.clicked).toEqual({ open: 0, save: 0 });
  });

  it("respects events already handled by the editing surface", () => {
    const t = fixture();
    t.key({ key: "s", ctrlKey: true }, true);
    expect(t.clicked.save).toBe(0);
  });

  it("suppresses browser save for disabled actions and key repeat without clicking", () => {
    const t = fixture();
    t.save.disabled = true;
    expect(t.key({ key: "s", ctrlKey: true }).defaultPrevented).toBe(true);
    t.save.disabled = false;
    expect(t.key({ key: "s", ctrlKey: true, repeat: true }).defaultPrevented).toBe(true);
    expect(t.clicked.save).toBe(0);
  });

  it("ignores a removed workspace and restores owned hints on idempotent cleanup", () => {
    const t = fixture();
    expect(t.save.getAttribute("aria-keyshortcuts")).toBe("Control+s Meta+s");
    expect(t.root.querySelector(".workspace-shortcuts")?.textContent).toContain("save Markdown");
    t.root.remove();
    expect(t.key({ key: "s", ctrlKey: true }).defaultPrevented).toBe(false);
    document.body.append(t.root);
    t.stop(); t.stop();
    expect(t.key({ key: "s", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(t.clicked.save).toBe(0);
    expect(t.save.title).toBe("Save source");
    expect(t.open.hasAttribute("title")).toBe(false);
    expect(t.save.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(t.root.querySelector(".workspace-shortcuts")).toBeNull();
  });

  it("reports a missing or ambiguous toolbar before registering anything", () => {
    const root = document.createElement("div");
    expect(() => mountDocumentShortcuts(root)).toThrow("controls failed to mount");
    expect(root.childElementCount).toBe(0);
  });
});
