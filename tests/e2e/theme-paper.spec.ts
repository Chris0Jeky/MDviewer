import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

/**
 * The screen theme is app chrome; the paper is print-accurate (UX-2 / UX-3).
 *
 * shiki.css used to swap rendered code onto the dark Shiki side via BOTH
 * `prefers-color-scheme: dark` AND `[data-app-theme="dark"]`. That put dark code on
 * the white page sheets — a preview that could not match the always-dark-on-white
 * PDF, and a real leak risk for the raster Download-PDF path, which rasterizes this
 * very screen DOM. The swap now exists only for the source editor's backdrop.
 *
 * These assertions read COMPUTED colors from a real engine, so they belong here and
 * not in jsdom.
 */

const MD = [
  "# Theme fixture",
  "",
  "Body text before the code block.",
  "",
  "```ts",
  "const answer: number = 42;",
  "export function ask(): number {",
  "  return answer;",
  "}",
  "```",
  "",
].join("\n");

/** Parse `rgb(r, g, b)` / `rgba(...)` into channels; null for transparent-ish values. */
function channels(color: string): [number, number, number] | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Perceived lightness 0–255. Cheap, and all these assertions need is light vs dark. */
function luminance(color: string): number | null {
  const c = channels(color);
  if (!c) return null;
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Computed background + foreground of the first rendered code block on a sheet. */
async function paperCode(page: Page): Promise<{ background: string; color: string }> {
  return page
    .locator("#paged-output .pagedjs_page .shiki")
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, color: cs.color };
    });
}

/** Computed color of the first colored token span in the editor's backdrop. */
async function editorTokenColor(page: Page): Promise<string> {
  return page
    .locator("#editor-highlight .editor-line span")
    .first()
    .evaluate((el) => getComputedStyle(el).color);
}

async function setTheme(page: Page, theme: "light" | "dark" | "sepia"): Promise<void> {
  await page.evaluate((t) => window.__mdviewer!.updateSettings({ screenTheme: t }), theme);
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", theme);
}

test.describe("paper stays print-accurate in every screen theme", () => {
  test("code on a page sheet keeps the LIGHT Shiki side in the dark app theme", async ({
    page,
  }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, MD);
    await waitForPagination(page);

    await setTheme(page, "light");
    const inLight = await paperCode(page);

    await setTheme(page, "dark");
    // Changing the screen theme is not a REFLOW_KEY, but re-assert the sheets are
    // still there before measuring so a mid-teardown read can't pass vacuously.
    await waitForPagination(page);
    const inDark = await paperCode(page);

    // Byte-identical, not merely "both lightish": the paper must not react at all.
    expect(inDark.background).toBe(inLight.background);
    expect(inDark.color).toBe(inLight.color);

    // And the light side is genuinely dark-on-light, i.e. the PDF's contract.
    const bg = luminance(inDark.background);
    const fg = luminance(inDark.color);
    expect(bg, `unexpected background ${inDark.background}`).not.toBeNull();
    expect(fg, `unexpected foreground ${inDark.color}`).not.toBeNull();
    expect(bg!).toBeGreaterThan(200);
    expect(fg!).toBeLessThan(140);
  });

  test("sepia does not tint the paper's code either", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, MD);
    await waitForPagination(page);

    await setTheme(page, "light");
    const inLight = await paperCode(page);
    await setTheme(page, "sepia");
    const inSepia = await paperCode(page);

    expect(inSepia.background).toBe(inLight.background);
    expect(inSepia.color).toBe(inLight.color);
  });

  test("the editor backdrop DOES follow the app theme (it is chrome, not paper)", async ({
    page,
  }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, MD);
    await waitForPagination(page);

    // The backdrop only paints once the debounced tokenizer has run.
    await expect(page.locator("#editor-pane")).toHaveAttribute("data-highlight", "on");
    await expect(page.locator("#editor-highlight .editor-line span").first()).toBeAttached();

    await setTheme(page, "light");
    const lightToken = await editorTokenColor(page);

    await setTheme(page, "dark");
    // The swap is a pure CSS rule on an already-painted span, but poll rather than
    // read once so a repaint racing the theme change cannot flake the comparison.
    await expect
      .poll(() => editorTokenColor(page))
      .not.toBe(lightToken);

    // Sanity: the same document's PAPER did not move while the editor did.
    const paperInDark = await paperCode(page);
    await setTheme(page, "light");
    const paperInLight = await paperCode(page);
    expect(paperInDark.color).toBe(paperInLight.color);
  });
});

test.describe("the screen-theme control names itself as screen-only (UX-2)", () => {
  test("carries a visible Screen label and sits right of the document controls", async ({
    page,
  }) => {
    await page.goto("/");

    const themeGroup = page.locator('#toolbar .toolbar-group[aria-label="Screen"]');
    await expect(themeGroup).toBeVisible();
    await expect(themeGroup.locator(".toolbar-label")).toHaveText("Screen");

    // Right of the spacer means right of every document-setting group.
    const layoutBox = await page
      .locator('#toolbar .toolbar-group[aria-label="Layout"]')
      .boundingBox();
    const themeBox = await themeGroup.boundingBox();
    const exportBox = await page
      .locator('#toolbar .toolbar-group[aria-label="Export"]')
      .boundingBox();

    expect(themeBox!.x).toBeGreaterThan(layoutBox!.x);
    // …and before Export, so the primary action keeps the far edge.
    expect(themeBox!.x).toBeLessThan(exportBox!.x);
  });

  test("aria-pressed stays in sync with the persisted setting", async ({ page }) => {
    await page.goto("/");
    const light = page.getByRole("button", { name: "Light" });
    const dark = page.getByRole("button", { name: "Dark" });

    await dark.click();
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "dark");
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await expect(light).toHaveAttribute("aria-pressed", "false");
  });
});
