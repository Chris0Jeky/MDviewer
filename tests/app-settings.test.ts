import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from "../src/app/settings";
import { buildStylesheet } from "../src/paginate/cssBuilder";

describe("App settings updates", () => {
  it("validates patches before notifying listeners, persisting, or rendering", () => {
    localStorage.clear();
    const listener = vi.fn();
    const app = Object.create(App.prototype) as App;
    Object.assign(app, {
      settings: { ...DEFAULT_SETTINGS, paperSize: "letter" },
      settingsListeners: new Set([listener]),
      scheduleRender: vi.fn(),
    });

    app.updateSettings({
      runningHeader: 42, margins: "invalid", fontSizePt: -1, showToc: "yes",
    } as unknown as Partial<Settings>);

    const expected = { ...DEFAULT_SETTINGS, paperSize: "letter" };
    expect(app.settings).toEqual(expected);
    expect(listener).toHaveBeenCalledWith(expected);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toEqual(expected);
    expect(() => buildStylesheet(app.settings)).not.toThrow();

    app.updateSettings({ runningHeader: "Valid header", margins: "wide" });
    expect(app.settings).toEqual({ ...expected, runningHeader: "Valid header", margins: "wide" });
  });
});
