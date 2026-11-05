import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/app/settings";
import { startWorkspace } from "../src/desktop/workspace";

let app: App | undefined;
let detach: (() => void) | undefined;

beforeEach(() => {
  document.body.innerHTML = '<input id="file-input" type="file" hidden><div id="app"></div>';
  localStorage.clear();
});

afterEach(async () => {
  await app?.flushRender();
  detach?.(); app?.destroy();
  app = undefined; detach = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("desktop document layout disclosure", () => {
  it.each([false, true])("starts collapsed without changing saved settings (narrow viewport: %s)", narrow => {
    vi.stubGlobal("matchMedia", () => ({ matches: narrow }));
    const saved = { ...DEFAULT_SETTINGS, paperSize: "letter" as const, docFont: "sans" as const,
      showToc: false, runningHeader: "Saved page header" };
    saveSettings(saved);
    const mounted = startWorkspace(document.getElementById("app")!, () => {}, () => true, () => {});
    app = mounted.app; detach = mounted.detachShortcuts;
    const disclosure = document.querySelector<HTMLDetailsElement>(".workspace-formatting")!;
    expect(disclosure.open).toBe(false);
    expect(app.settings).toEqual(saved);
    expect(loadSettings()).toEqual(saved);
    expect(document.querySelector<HTMLInputElement>('[aria-label="Running header text"]')!.value).toBe("Saved page header");
  });

  it("keeps one-click access and Escape focus while retaining a changed setting", async () => {
    const mounted = startWorkspace(document.getElementById("app")!, () => {}, () => true, () => {});
    app = mounted.app; detach = mounted.detachShortcuts;
    const disclosure = document.querySelector<HTMLDetailsElement>(".workspace-formatting")!;
    const summary = disclosure.querySelector("summary")!;
    expect(disclosure.open).toBe(false);
    summary.click();
    expect(disclosure.open).toBe(true);
    const header = document.querySelector<HTMLInputElement>('[aria-label="Running header text"]')!;
    header.focus(); header.value = "My page header";
    header.dispatchEvent(new Event("input", { bubbles: true }));
    await app.flushRender();
    const beforeClose = loadSettings();
    header.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(disclosure.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(loadSettings()).toEqual(beforeClose);
    summary.click();
    expect(disclosure.open).toBe(true);
    expect(header.value).toBe("My page header");
  });

  it.each([false, true])("retains the web entry's adaptive default when no desktop preference is supplied (narrow: %s)", narrow => {
    vi.stubGlobal("matchMedia", () => ({ matches: narrow }));
    app = App.init(document.getElementById("app")!, { inputHandlers: false });
    expect(document.querySelector<HTMLDetailsElement>(".workspace-formatting")!.open).toBe(!narrow);
  });
});
