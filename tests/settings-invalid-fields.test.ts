import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  DOC_FONT_STACKS,
  MARGIN_MM,
  migrateSettings,
} from "../src/app/settings";

describe("settings: migrateSettings rejects hostile store values", () => {
  it("reverts evil enum/number fields to defaults", () => {
    const out = migrateSettings({
      codeTheme: "evil",
      paperSize: "a3",
      margins: "huge",
      docFont: "evil",
      fontSizePt: "big",
      screenTheme: "evil",
    } as unknown);
    expect(out.codeTheme).toBe(DEFAULT_SETTINGS.codeTheme);
    expect(out.paperSize).toBe(DEFAULT_SETTINGS.paperSize);
    expect(out.margins).toBe(DEFAULT_SETTINGS.margins);
    expect(out.docFont).toBe(DEFAULT_SETTINGS.docFont);
    expect(out.fontSizePt).toBe(DEFAULT_SETTINGS.fontSizePt);
    expect(out.screenTheme).toBe(DEFAULT_SETTINGS.screenTheme);
    // Reverted values must be usable by downstream consumers.
    expect(MARGIN_MM[out.margins]).not.toBeNaN();
    expect(DOC_FONT_STACKS[out.docFont]).toBeTypeOf("string");
  });

  it("reverts hostile boolean/zoom/runningHeader fields to defaults", () => {
    const out = migrateSettings({
      showToc: "yes-string",
      showPageNumbers: 1,
      showLineNumbers: "no",
      titlePage: 1,
      zoom: "evil",
      runningHeader: 42,
    } as unknown);
    expect(out.showToc).toBe(DEFAULT_SETTINGS.showToc);
    expect(out.showPageNumbers).toBe(DEFAULT_SETTINGS.showPageNumbers);
    expect(out.showLineNumbers).toBe(DEFAULT_SETTINGS.showLineNumbers);
    expect(out.titlePage).toBe(DEFAULT_SETTINGS.titlePage);
    expect(out.zoom).toBe(DEFAULT_SETTINGS.zoom);
    expect(out.runningHeader).toBe(DEFAULT_SETTINGS.runningHeader);
  });

  it("preserves valid values instead of resetting everything", () => {
    const out = migrateSettings({
      codeTheme: "nord",
      paperSize: "letter",
      margins: "wide",
      docFont: "slab",
      fontSizePt: 13,
      screenTheme: "dark",
      showToc: false,
      showPageNumbers: false,
      titlePage: false,
      showLineNumbers: true,
      zoom: 0.5,
      runningHeader: "My Paper",
      viewMode: "preview",
      splitRatio: 0.6,
    });
    expect(out.codeTheme).toBe("nord");
    expect(out.paperSize).toBe("letter");
    expect(out.margins).toBe("wide");
    expect(out.docFont).toBe("slab");
    expect(out.fontSizePt).toBe(13);
    expect(out.screenTheme).toBe("dark");
    expect(out.showToc).toBe(false);
    expect(out.showPageNumbers).toBe(false);
    expect(out.titlePage).toBe(false);
    expect(out.showLineNumbers).toBe(true);
    expect(out.zoom).toBe(0.5);
    expect(out.runningHeader).toBe("My Paper");
    expect(out.viewMode).toBe("preview");
    expect(out.splitRatio).toBe(0.6);
    expect(out.schemaVersion).toBe(1);
  });
});
