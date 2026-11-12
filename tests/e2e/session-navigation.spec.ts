import { expect, test, type Locator } from "@playwright/test";
import { placeSource } from "../helpers/sourcePosition";
import { loadFilesIntoApp, waitForPagination } from "../helpers/pagedDom";

async function position(input: Locator) {
  return input.evaluate((el: HTMLTextAreaElement) => ({
    start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection,
    top: el.scrollTop, left: el.scrollLeft,
  }));
}

test("same-name equal-content documents restore independent source positions with Find closed and open", async ({ page }) => {
  await page.goto("/");
  const source = "# 筆記 λ😀\n\n<!--\n" + "A long Unicode source line λ😀 with enough words to wrap.\n".repeat(2_500) + "last-needle\n-->";
  await loadFilesIntoApp(page, [{ name: "same.md", content: source }, { name: "same.md", content: source }]);
  const picker = page.getByRole("combobox", { name: "Active document" });
  await expect(picker.locator("option")).toHaveText(["same.md (1 of 2)", "same.md (2 of 2)"]);
  await waitForPagination(page);
  const ids = await picker.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  const input = page.locator("#editor-input");
  await input.focus();
  await placeSource(input, 100, 120, "backward", 900);
  const first = await position(input);
  expect(first.top).toBeGreaterThan(0);
  const previous = await input.elementHandle();
  await page.keyboard.press("Alt+Shift+n");
  await expect(picker).toHaveValue(ids[1]!);
  expect(await previous!.evaluate(el => el.isConnected)).toBe(false);
  await expect(input).toBeFocused();
  await placeSource(input, 400, 430, "forward", 2300);
  const second = await position(input);
  for (let iteration = 0; iteration < 3; iteration++) {
    await page.keyboard.press("Alt+Shift+p");
    await expect(picker).toHaveValue(ids[0]!);
    await expect.poll(() => position(input)).toEqual(first);
    await page.keyboard.press("Alt+Shift+n");
    await expect.poll(() => position(input)).toEqual(second);
  }
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await query.fill("last-needle");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  const found = await position(input);
  await page.keyboard.press("Alt+Shift+p");
  await expect(query).toBeFocused();
  await expect.poll(() => position(input)).toEqual(first);
  await page.keyboard.press("Alt+Shift+n");
  await expect.poll(() => position(input)).toEqual(found);
  await expect(input).toHaveValue(source);
  await page.keyboard.press("Alt+Shift+d");
  await expect(picker).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("session-navigation-long-source.png"), fullPage: true });
});

test("Undo Close restores source position under a new identity and keeps native undo isolated", async ({ page }) => {
  await page.goto("/");
  const source = "# Restored\n\n<!--\n" + "source λ😀\n".repeat(500) + "-->";
  await loadFilesIntoApp(page, [{ name: "restore.md", content: source }, { name: "keep.md", content: "# Keep" }]);
  await waitForPagination(page);
  const input = page.locator("#editor-input");
  const picker = page.getByRole("combobox", { name: "Active document" });
  const oldId = await picker.inputValue();
  await input.focus();
  await input.press("ControlOrMeta+End");
  await page.keyboard.insertText("\nAn edit");
  await placeSource(input, 60, 80, "backward", 700);
  const saved = await position(input);
  await page.getByRole("button", { name: "Close restore.md", exact: true }).click();
  await expect(input).toHaveValue("# Keep");
  await page.getByRole("button", { name: "Undo close", exact: true }).click();
  await expect(input).toHaveValue(source + "\nAn edit");
  await expect.poll(() => position(input)).toEqual(saved);
  expect(await picker.inputValue()).not.toBe(oldId);
  await input.press("ControlOrMeta+z");
  await expect(input).toHaveValue(source + "\nAn edit");
});

test("position and picker focus commands do not repaginate or rewrite source", async ({ page }) => {
  await page.goto("/");
  const source = "# Stable\n\nUnchanged source λ😀";
  await loadFilesIntoApp(page, [{ name: "stable.md", content: source }]);
  await waitForPagination(page);
  const sheet = await page.locator("#paged-output .pagedjs_page").first().elementHandle();
  const input = page.locator("#editor-input");
  await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(3, 10, "backward"));
  await page.keyboard.press("Alt+Shift+d");
  const picker = page.getByRole("combobox", { name: "Active document" });
  await expect(picker).toBeFocused();
  await picker.selectOption(await picker.inputValue());
  await page.waitForTimeout(350); // Cross the content debounce; the actual page must survive.
  expect(await sheet!.evaluate(el => el.isConnected)).toBe(true);
  await expect(input).toHaveValue(source);
  expect((await position(input)).start).toBe(3);
});

test("preview positions belong to their documents and pane toggles preserve source coordinates", async ({ page }) => {
  await page.goto("/");
  const source = "# Long preview\n\n" + Array.from({ length: 25 }, (_, index) => `## Section ${index}\n\n${"A paragraph for independent document positions. ".repeat(20)}\n\n`).join("");
  await loadFilesIntoApp(page, [{ name: "a.md", content: source }, { name: "b.md", content: source }]);
  await waitForPagination(page);
  const input = page.locator("#editor-input");
  const canvas = page.locator("#canvas");
  const picker = page.getByRole("combobox", { name: "Active document" });
  await placeSource(input, 500, 530, "backward", 450);
  const sourcePosition = await position(input);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await canvas.evaluate(el => { el.style.scrollBehavior = "auto"; el.scrollTop = 1000; });
  const first = await canvas.evaluate(el => el.scrollTop);
  const switchTo = async (name: string) => {
    const oldSheet = await page.locator("#paged-output .pagedjs_page").first().elementHandle();
    await picker.selectOption({ label: name });
    await expect.poll(() => oldSheet!.evaluate(el => el.isConnected)).toBe(false);
    await waitForPagination(page);
  };
  await switchTo("b.md");
  expect(await canvas.evaluate(el => el.scrollTop)).toBeLessThan(50);
  await canvas.evaluate(el => { el.scrollTop = 2000; });
  const second = await canvas.evaluate(el => el.scrollTop);
  await switchTo("a.md");
  await expect.poll(async () => Math.abs(await canvas.evaluate(el => el.scrollTop) - first)).toBeLessThan(2);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect.poll(() => position(input)).toEqual(sourcePosition);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await switchTo("b.md");
  await expect.poll(async () => Math.abs(await canvas.evaluate(el => el.scrollTop) - second)).toBeLessThan(2);
  await expect(input).toHaveValue(source);
});
