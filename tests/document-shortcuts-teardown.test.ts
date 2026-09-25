import { describe, expect, it } from "vitest";
import { mountDocumentShortcuts } from "../src/ui/DocumentShortcuts";

for (const moveOutside of [false, true]) {
  describe(`shortcut toolbar teardown (move outside: ${moveOutside})`, () => {
    it("does not consume browser shortcuts when the root outlives its buttons", () => {
      const root = document.createElement("div");
      root.innerHTML = `<div class="workspace-actions"><button class="workspace-action">Open</button></div>
        <div class="workspace-session"><span class="workspace-privacy"></span><button class="workspace-action">Save</button></div>`;
      document.body.append(root);
      const buttons = Array.from(root.querySelectorAll("button"));
      const stop = mountDocumentShortcuts(root);
      try {
        if (moveOutside) document.body.append(...buttons);
        else root.replaceChildren();
        expect(root.isConnected).toBe(true);
        for (const key of ["o", "s"]) {
          const event = new KeyboardEvent("keydown", { key, ctrlKey: true, cancelable: true });
          window.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(false);
        }
      } finally {
        stop(); root.remove(); buttons.forEach((button) => button.remove());
      }
    });
  });
}
