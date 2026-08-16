import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_MD = readFileSync(join(here, "..", "fixtures", "sample.md"), "utf8");

/** Relative luminance / contrast ratio per WCAG 2.x, for `rgb(r, g, b)` strings. */
function contrastWithWhite(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number) as [
    number,
    number,
    number,
  ];
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return 1.05 / (luminance + 0.05);
}

/**
 * UX-9: sanitize.ts forces task checkboxes to `disabled` (a security decision that stays),
 * and Chrome's disabled UA checkbox ignores `accent-color` — the only styling they had.
 * The result was pale grey on pale grey, effectively invisible in the exported PDF. The
 * control is now drawn by hand with `appearance: none`.
 */
test.describe("task-list checkboxes are visible", () => {
  test("the box is hand-drawn, not the pale disabled UA control", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    const boxes = await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          "#paged-output .task-list-item input[type='checkbox']",
        ),
      );
      return inputs.map((input) => {
        const style = getComputedStyle(input);
        const tick = getComputedStyle(input, "::after");
        const rect = input.getBoundingClientRect();
        return {
          checked: input.checked,
          disabled: input.disabled,
          appearance: style.appearance,
          borderColor: style.borderTopColor,
          borderWidth: style.borderTopWidth,
          background: style.backgroundColor,
          printColorAdjust: style.printColorAdjust,
          opacity: style.opacity,
          tickContent: tick.content,
          tickWidth: parseFloat(tick.width) || 0,
          tickHeight: parseFloat(tick.height) || 0,
          width: rect.width,
          height: rect.height,
        };
      });
    });

    expect(boxes.length, "sample.md has a task list").toBeGreaterThan(0);
    expect(boxes.some((b) => b.checked), "sample.md has a checked item").toBe(true);
    expect(boxes.some((b) => !b.checked), "sample.md has an unchecked item").toBe(true);

    for (const box of boxes) {
      // The security decision is untouched.
      expect(box.disabled).toBe(true);
      // The UA control is replaced, at full opacity, and prints its colour.
      expect(box.appearance).toBe("none");
      expect(box.opacity).toBe("1");
      expect(box.printColorAdjust).toBe("exact");
      expect(box.width).toBeGreaterThan(4);
      expect(box.height).toBeGreaterThan(4);
      expect(parseFloat(box.borderWidth)).toBeGreaterThanOrEqual(1);

      // WCAG 1.4.11: the box outline must reach 3:1 against the white page.
      const outline = contrastWithWhite(box.checked ? box.background : box.borderColor);
      expect(outline, `checkbox outline contrast ${outline.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        3,
      );

      if (box.checked) {
        // A real tick is drawn inside the filled box.
        expect(box.tickContent).not.toBe("none");
        expect(box.tickWidth).toBeGreaterThan(0);
        expect(box.tickHeight).toBeGreaterThan(0);
      }
    }
  });

  test("checked and unchecked boxes are visually distinguishable", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, SAMPLE_MD);
    await waitForPagination(page);

    const [checked, unchecked] = await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          "#paged-output .task-list-item input[type='checkbox']",
        ),
      );
      const read = (input: HTMLInputElement | undefined): string | null =>
        input ? getComputedStyle(input).backgroundColor : null;
      return [read(inputs.find((i) => i.checked)), read(inputs.find((i) => !i.checked))];
    });

    expect(checked).not.toBeNull();
    expect(unchecked).not.toBeNull();
    expect(checked).not.toBe(unchecked);
    // Unchecked stays white paper; checked is inked.
    expect(contrastWithWhite(unchecked!)).toBeLessThan(1.2);
    expect(contrastWithWhite(checked!)).toBeGreaterThanOrEqual(3);
  });
});
