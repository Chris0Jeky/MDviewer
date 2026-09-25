import { expect, it } from "vitest";
import { DocStore } from "../src/app/state";
import { mountDocumentRecovery } from "../src/ui/DocumentRecovery";

it("keeps the recovery announcer mounted and clears its filename", () => {
  const root = document.createElement("div"); document.body.append(root);
  const store = new DocStore();
  const recovery = mountDocumentRecovery(root, store, () => {});
  try {
    const announcer = root.querySelector<HTMLElement>("[role=status]")!;
    expect(announcer).not.toBeNull();
    expect(announcer.closest("[hidden]")).toBeNull();
    expect(announcer.textContent).toBe("");
    store.add("announced.md", "draft"); recovery.closeActive();
    expect(announcer.textContent).toContain("announced.md");
    expect(announcer.textContent).toContain("Undo close");
    root.querySelector<HTMLButtonElement>("[aria-label='Discard closed document']")!.click();
    expect(announcer.textContent).toBe("");
    expect(announcer.closest("[hidden]")).toBeNull();
    recovery.destroy();
    expect(announcer.isConnected).toBe(false);
  } finally { recovery.destroy(); root.remove(); }
});
