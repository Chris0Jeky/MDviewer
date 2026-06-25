import { describe, it, expect } from "vitest";
import { MM, IN, SHRINK_LIMIT, measurePageArea } from "../src/paginate/measure";
import { DEFAULT_SETTINGS, MARGIN_MM, type Settings } from "../src/app/settings";

const A4_MM = { w: 210, h: 297 };
const LETTER_IN = { w: 8.5, h: 11 };

function withSettings(patch: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe("measure: unit constants", () => {
  it("MM is 96dpi per millimetre", () => {
    expect(MM).toBeCloseTo(96 / 25.4, 9);
  });

  it("IN is 96px per inch", () => {
    expect(IN).toBe(96);
  });

  it("SHRINK_LIMIT is 1.15", () => {
    expect(SHRINK_LIMIT).toBeCloseTo(1.15, 9);
  });

  it("MM and IN are mutually consistent (25.4mm == 1in)", () => {
    expect(MM * 25.4).toBeCloseTo(IN, 6);
  });
});

describe("measure: measurePageArea geometry", () => {
  it("A4 + normal margins subtracts 2x margin on each axis (in px)", () => {
    const area = measurePageArea(withSettings({ paperSize: "a4", margins: "normal" }));
    const m = MARGIN_MM.normal;
    expect(area.widthPx).toBeCloseTo((A4_MM.w - 2 * m) * MM, 4);
    expect(area.heightPx).toBeCloseTo((A4_MM.h - 2 * m) * MM, 4);
  });

  it("Letter + normal margins uses inches for the sheet size", () => {
    const area = measurePageArea(withSettings({ paperSize: "letter", margins: "normal" }));
    const marginPx = MARGIN_MM.normal * MM;
    expect(area.widthPx).toBeCloseTo(LETTER_IN.w * IN - 2 * marginPx, 3);
    expect(area.heightPx).toBeCloseTo(LETTER_IN.h * IN - 2 * marginPx, 3);
  });

  it("narrower margins yield a larger printable area than wider margins", () => {
    const narrow = measurePageArea(withSettings({ paperSize: "a4", margins: "narrow" }));
    const normal = measurePageArea(withSettings({ paperSize: "a4", margins: "normal" }));
    const wide = measurePageArea(withSettings({ paperSize: "a4", margins: "wide" }));
    expect(narrow.widthPx).toBeGreaterThan(normal.widthPx);
    expect(normal.widthPx).toBeGreaterThan(wide.widthPx);
    expect(narrow.heightPx).toBeGreaterThan(normal.heightPx);
    expect(normal.heightPx).toBeGreaterThan(wide.heightPx);
  });

  it("portrait orientation: height exceeds width for both paper sizes", () => {
    for (const paperSize of ["a4", "letter"] as const) {
      const area = measurePageArea(withSettings({ paperSize, margins: "narrow" }));
      expect(area.heightPx).toBeGreaterThan(area.widthPx);
    }
  });

  it("printable area stays strictly positive for the largest margin preset", () => {
    for (const paperSize of ["a4", "letter"] as const) {
      const area = measurePageArea(withSettings({ paperSize, margins: "wide" }));
      expect(area.widthPx).toBeGreaterThan(0);
      expect(area.heightPx).toBeGreaterThan(0);
    }
  });

  it("A4 printable area matches a hand-computed reference (normal margins)", () => {
    // (210 - 40)mm * (96/25.4) = 642.5196..px ; (297 - 40)mm = 971.3385..px
    const area = measurePageArea(withSettings({ paperSize: "a4", margins: "normal" }));
    expect(area.widthPx).toBeCloseTo(170 * (96 / 25.4), 4);
    expect(area.heightPx).toBeCloseTo(257 * (96 / 25.4), 4);
  });
});
