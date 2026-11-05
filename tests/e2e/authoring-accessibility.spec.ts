import { expect, test, type Page } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

test.beforeEach(async ({ browser, browserName }, info) => {
  await info.attach("browser-runtime", {
    body: JSON.stringify({ engine: browserName, version: browser.version() }),
    contentType: "application/json",
  });
});

async function source(page: Page, text = "# Accessible writing\n\nCafé 日本語 and a repeated word word."): Promise<void> {
  await page.goto("/");
  await loadMarkdownIntoApp(page, text);
  await waitForPagination(page);
}

test("Find exposes its state and has a complete keyboard return path", async ({ page }) => {
  await source(page);
  const input = page.getByRole("textbox", { name: "Markdown source", exact: true });
  const find = page.getByRole("button", { name: "Find", exact: true });
  await expect(find).toHaveAttribute("aria-expanded", "false");
  await input.focus();
  await input.press("ControlOrMeta+f");
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await expect(query).toBeFocused();
  await expect(find).toHaveAttribute("aria-expanded", "true");
  await query.fill("word");
  const region = page.getByRole("search", { name: "Find and replace in Markdown" });
  await expect(region.getByRole("status")).toHaveText("1 of 2 matches");
  expect(await region.ariaSnapshot()).toContain('status: 1 of 2 matches');
  await query.press("Tab");
  const matchCase = page.getByRole("button", { name: "Match case", exact: true });
  await expect(matchCase).toBeFocused();
  await matchCase.press("Space");
  await expect(matchCase).toHaveAttribute("aria-pressed", "true");
  await matchCase.press("Escape");
  await expect(input).toBeFocused();
  await expect(region).toBeHidden();
  await input.press("Shift+Tab");
  await expect(find).toBeFocused();
});

test("composition guards leave source and shortcuts alone until composition ends", async ({ page }) => {
  const text = "# Composition\n\n日本語 café";
  await source(page, text);
  const input = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await input.focus();
  const consumed = await input.evaluate(element => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "に" }));
    const results = [];
    for (const key of ["Tab", "f", "h", "s", "o"]) {
      const event = new KeyboardEvent("keydown", { key, ctrlKey: key !== "Tab", isComposing: true, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      results.push(event.defaultPrevented);
    }
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }));
    return results;
  });
  expect(consumed).toEqual([false, false, false, false, false]);
  await expect(input).toHaveValue(text);
  await expect(page.getByRole("searchbox", { name: "Find in Markdown" })).toBeHidden();
  await input.press("ControlOrMeta+f");
  await expect(page.getByRole("searchbox", { name: "Find in Markdown" })).toBeFocused();
});

test("forced colors keep source text and the active match independently visible", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await source(page, "# Contrast\n\nFind this visible text, with **syntax**.");
  await expect(page.locator("#editor-pane")).toHaveAttribute("data-highlight", "on");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find in Markdown" }).fill("visible");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  const paint = await page.locator("#editor-input").evaluate(input => {
    const style = getComputedStyle(input);
    const cue = getComputedStyle(document.querySelector(".editor-match-rect")!);
    return { forced: matchMedia("(forced-colors: active)").matches,
      text: style.webkitTextFillColor, foreground: style.color, background: style.backgroundColor,
      caret: style.caretColor, cueOutline: cue.outlineStyle, cueWidth: parseFloat(cue.outlineWidth) };
  });
  expect(paint.forced).toBe(true);
  expect(paint.cueOutline).not.toBe("none");
  expect(paint.cueWidth).toBeGreaterThanOrEqual(1);
  expect(paint.text).not.toBe("transparent");
  expect(paint.text).not.toBe("rgba(0, 0, 0, 0)");
  expect(paint.foreground).not.toBe(paint.background);
  expect(paint.caret).not.toBe(paint.background);
  await expect(page.locator("#editor-highlight")).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("forced-colors-source.png"), fullPage: true });
});

test("short reflow and reduced motion preserve keyboard Find and readable source space", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 420 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const text = "# Reflow\n\n" + "A long source line for keyboard searching.\n".repeat(50) + "final target";
  await source(page, text);
  const input = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await input.focus();
  await input.press("ControlOrMeta+f");
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await query.fill("final target");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  await expect(query).toBeFocused();
  const metrics = await page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>("#editor-input")!;
    const pane = input.getBoundingClientRect();
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      sourceHeight: pane.height, sourceBottom: pane.bottom,
      scroll: input.scrollTop, selected: input.value.slice(input.selectionStart, input.selectionEnd),
      scrollBehavior: getComputedStyle(document.querySelector("#canvas")!).scrollBehavior };
  });
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.width);
  expect(metrics.sourceHeight).toBeGreaterThan(60);
  expect(metrics.sourceBottom).toBeLessThanOrEqual(421);
  expect(metrics.scroll).toBeGreaterThan(0);
  expect(metrics.selected).toBe("final target");
  expect(metrics.scrollBehavior).toBe("auto");
  await query.press("Escape");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(text);
  await page.screenshot({ path: test.info().outputPath("short-authoring-reflow.png"), fullPage: true });
});
