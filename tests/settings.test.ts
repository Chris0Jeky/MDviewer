import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  MARGIN_MM,
  SETTINGS_KEY,
  loadSettings,
  migrateSettings,
  saveSettings,
  type Settings,
} from "../src/app/settings";

describe("settings: defaults and constants", () => {
  it("DEFAULT_SETTINGS has schemaVersion 1 and the documented baseline", () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(1);
    expect(DEFAULT_SETTINGS.paperSize).toBe("a4");
    expect(DEFAULT_SETTINGS.margins).toBe("normal");
    expect(DEFAULT_SETTINGS.codeTheme).toBe("github");
    expect(DEFAULT_SETTINGS.docFont).toBe("serif");
    expect(DEFAULT_SETTINGS.fontSizePt).toBe(11);
    expect(DEFAULT_SETTINGS.showToc).toBe(true);
    expect(DEFAULT_SETTINGS.showPageNumbers).toBe(true);
    expect(DEFAULT_SETTINGS.runningHeader).toBe("");
    expect(DEFAULT_SETTINGS.showLineNumbers).toBe(false);
    expect(DEFAULT_SETTINGS.zoom).toBe("fit");
  });

  it("MARGIN_MM maps the three presets to millimetres", () => {
    expect(MARGIN_MM.narrow).toBeCloseTo(12.7, 5);
    expect(MARGIN_MM.normal).toBe(20);
    expect(MARGIN_MM.wide).toBe(30);
  });
});

describe("settings: migrateSettings", () => {
  it("returns a fresh defaults copy for non-object input", () => {
    for (const bad of [null, undefined, 42, "x", true, []] as unknown[]) {
      const out = migrateSettings(bad);
      expect(out).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("does not return the DEFAULT_SETTINGS reference (no shared mutable state)", () => {
    const a = migrateSettings(null);
    const b = migrateSettings(null);
    expect(a).not.toBe(DEFAULT_SETTINGS);
    expect(a).not.toBe(b);
    a.fontSizePt = 13;
    expect(DEFAULT_SETTINGS.fontSizePt).toBe(11);
    expect(b.fontSizePt).toBe(11);
  });

  it("merges partial objects over the defaults", () => {
    const out = migrateSettings({ codeTheme: "nord", showLineNumbers: true });
    expect(out.codeTheme).toBe("nord");
    expect(out.showLineNumbers).toBe(true);
    // untouched fields stay at default
    expect(out.paperSize).toBe(DEFAULT_SETTINGS.paperSize);
    expect(out.docFont).toBe(DEFAULT_SETTINGS.docFont);
  });

  it("preserves all known Settings fields when extra keys are present", () => {
    // The merge spreads the raw object over defaults; the contract that matters is
    // that every documented Settings field is present and valid afterwards (extra,
    // unknown keys are harmless and ignored by consumers that read typed fields).
    const out = migrateSettings({ codeTheme: "one", bogus: "ignored", x: 1 });
    expect(out.codeTheme).toBe("one");
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof typeof DEFAULT_SETTINGS>) {
      expect(out[key], `field ${key} present`).not.toBeUndefined();
    }
    expect(out.schemaVersion).toBe(1);
  });

  it("always pins schemaVersion to 1 even if the stored value is wrong", () => {
    const out = migrateSettings({ schemaVersion: 99 } as unknown);
    expect(out.schemaVersion).toBe(1);
  });
});

describe("settings: load/save round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loadSettings returns defaults when storage is empty", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("saveSettings writes JSON under the v1 key that loadSettings reads back", () => {
    const custom: Settings = {
      ...DEFAULT_SETTINGS,
      paperSize: "letter",
      margins: "wide",
      codeTheme: "catppuccin",
      runningHeader: "My Paper",
      showLineNumbers: true,
      zoom: 0.5,
    };
    saveSettings(custom);

    const raw = localStorage.getItem(SETTINGS_KEY);
    expect(raw).toBeTypeOf("string");
    expect(JSON.parse(raw as string).paperSize).toBe("letter");

    const loaded = loadSettings();
    expect(loaded).toEqual(custom);
  });

  it("loadSettings tolerates corrupt JSON and returns defaults", () => {
    localStorage.setItem(SETTINGS_KEY, "{ this is : not json ");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("loadSettings merges a partial stored object over the defaults", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ docFont: "slab" }));
    const loaded = loadSettings();
    expect(loaded.docFont).toBe("slab");
    expect(loaded.fontSizePt).toBe(DEFAULT_SETTINGS.fontSizePt);
    expect(loaded.schemaVersion).toBe(1);
  });

  it("loadSettings never throws when localStorage.getItem throws (private mode)", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    spy.mockRestore();
  });

  it("saveSettings never throws when localStorage.setItem throws (quota / private mode)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    spy.mockRestore();
  });
});
