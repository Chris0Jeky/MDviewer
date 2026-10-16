import { describe, expect, it } from "vitest";
import { ATTRS } from "../src/app/dom";
import { SHRINK_LIMIT, type PageArea } from "../src/paginate/measure";
import { shrinkToFit } from "../src/paginate/shrinkToFit";

// Regression pin for Tier-3 shrink-to-fit (src/paginate/shrinkToFit.ts).
// jsdom has no layout engine, so the natural height is stubbed through the
// recorded `data-mdv-source-height` attribute — the same value
// recordSplittableSourceHeights would have stored pre-pagination — instead of
// measuring a real probe. If the scaling block (lines 44-54) were dropped,
// the first test fails: transform/height/width/data-shrunk would all stay empty.
const AREA: PageArea = { widthPx: 800, heightPx: 1000 };

/** Detached container holding a single <pre> with a stubbed natural height. */
function preWithRecordedHeight(recordedHeight: number): { root: HTMLElement; pre: HTMLElement } {
  const root = document.createElement("div");
  const pre = document.createElement("pre");
  pre.textContent = "const x = 1;";
  pre.setAttribute(ATTRS.atomicSourceHeight, String(recordedHeight));
  root.appendChild(pre);
  return { root, pre };
}

describe("shrinkToFit regression pin", () => {
  it("scales a block at ~1.1x page height and reserves its shrunk footprint", () => {
    const naturalHeight = AREA.heightPx * 1.1;
    const { root, pre } = preWithRecordedHeight(naturalHeight);

    shrinkToFit(root, AREA);

    const scale = (AREA.heightPx - 2) / naturalHeight;
    expect(pre.style.transform.startsWith("scale(")).toBe(true);
    expect(pre.style.height).not.toBe("");
    expect(Number.parseFloat(pre.style.height)).toBeCloseTo(AREA.heightPx - 2, 3);
    expect(pre.style.width.endsWith("%")).toBe(true);
    expect(Number.parseFloat(pre.style.width)).toBeCloseTo(100 / scale, 3);
    expect(pre.dataset.shrunk).toBe(scale.toFixed(3));
  });

  it("leaves a block taller than the SHRINK_LIMIT ceiling unscaled", () => {
    const { root, pre } = preWithRecordedHeight(AREA.heightPx * SHRINK_LIMIT + 50);

    shrinkToFit(root, AREA);

    expect(pre.style.transform).toBe("");
    expect(pre.style.height).toBe("");
    expect(pre.style.width).toBe("");
    expect(pre.hasAttribute(ATTRS.shrunk)).toBe(false);
  });
});
