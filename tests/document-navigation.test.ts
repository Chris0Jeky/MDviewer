import { afterEach, describe, expect, it, vi } from "vitest";
import { documentLabels, mountDocumentNavigation } from "../src/ui/DocumentNavigation";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(stop => stop()); document.body.replaceChildren(); });
function setup() {
  const root = document.createElement("div");
  const select = document.createElement("select");
  select.append(new Option("same.md (1 of 2)", "a"), new Option("same.md (2 of 2)", "b"));
  const previous = document.createElement("button"), next = document.createElement("button");
  root.append(select, previous, next); document.body.append(root);
  const navigation = mountDocumentNavigation(root, select, previous, next, root);
  navigation.sync(); cleanup.push(() => navigation.destroy());
  const change = vi.fn(); select.addEventListener("change", change);
  return { root, select, previous, next, navigation, change };
}
function key(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, altKey: true, shiftKey: true, cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(event); return event;
}

describe("document navigation", () => {
  it("cycles the native picker by identity from buttons and disclosed keyboard commands", () => {
    const t = setup();
    expect(t.select.getAttribute("aria-keyshortcuts")).toBe("Alt+Shift+D");
    expect(t.root.textContent).toContain("Alt+Shift");
    t.next.click(); expect(t.select.value).toBe("b");
    expect(key("n").defaultPrevented).toBe(true); expect(t.select.value).toBe("a");
    key("p"); expect(t.select.value).toBe("b");
    key("D"); expect(document.activeElement).toBe(t.select);
    expect(t.change).toHaveBeenCalledTimes(3);
  });

  it("leaves Apple Option text unbound without advertising inactive shortcuts", () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
    const t = setup();
    expect(t.root.querySelector(".workspace-navigation-shortcuts")).toBeNull();
    for (const control of [t.select, t.previous, t.next]) {
      expect(control.hasAttribute("aria-keyshortcuts")).toBe(false);
      expect(control.title).not.toContain("Alt+");
    }
    expect(key("n").defaultPrevented).toBe(false);
    expect(key("∏", { code: "KeyP" }).defaultPrevented).toBe(false);
    expect(key("D").defaultPrevented).toBe(false);
    expect(t.select.value).toBe("a");
    t.next.click(); expect(t.select.value).toBe("b");
    t.previous.click(); expect(t.select.value).toBe("a");
  });

  it("does not claim browser navigation, composition, repeats, hidden modes, or disabled selectors", () => {
    const t = setup();
    for (const name of ["Tab", "PageUp", "PageDown", "ArrowLeft", "ArrowRight"]) {
      expect(key(name, { ctrlKey: true, altKey: false, shiftKey: false }).defaultPrevented).toBe(false);
    }
    expect(key("ArrowUp").defaultPrevented).toBe(false);
    expect(key("ArrowDown").defaultPrevented).toBe(false);
    expect(key("n", { isComposing: true }).defaultPrevented).toBe(false);
    key("n", { repeat: true }); expect(t.select.value).toBe("a");
    t.root.hidden = true; expect(key("n").defaultPrevented).toBe(false);
    t.root.hidden = false; t.select.disabled = true; t.navigation.sync();
    expect(t.next.disabled).toBe(true); expect(key("n").defaultPrevented).toBe(false);
    t.select.disabled = false; t.navigation.destroy();
    expect(key("n").defaultPrevented).toBe(false); expect(t.change).not.toHaveBeenCalled();
  });

  it("labels duplicate Unicode names while retaining distinct IDs", () => {
    expect([...documentLabels([{ id: "one", name: "筆記😀.md" }, { id: "two", name: "筆記😀.md" }, { id: "three", name: "unique.md" }])])
      .toEqual([["one", "筆記😀.md (1 of 2)"], ["two", "筆記😀.md (2 of 2)"], ["three", "unique.md"]]);
  });
});
