import { test, expect, openFiles, readyReader, readyWorkspace } from "./helpers";

for (const size of [{ width: 560, height: 420 }, { width: 640, height: 480 }]) {
  test(`document navigation stays reachable at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openFiles(page, [{ name: "one.md", text: "# One" }, { name: "two.md", text: "# Two" }]);
    await readyReader(page, "One");
    await page.getByRole("button", { name: "Next document", exact: true }).click();
    await readyReader(page, "Two");
    await page.getByRole("button", { name: "Previous document", exact: true }).click();
    await readyReader(page, "One");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
    await readyWorkspace(page, "# One");
    await page.getByRole("button", { name: "Next document", exact: true }).click();
    await expect(page.locator("#editor-input")).toHaveValue("# Two");
    await page.locator("#editor-input").press("Control+h");
    await expect(page.getByRole("textbox", { name: "Replace with", exact: true })).toBeFocused();
    expect(await page.locator("#editor-input").evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: test.info().outputPath(`navigation-${size.width}x${size.height}.png`), fullPage: true });
  });
}

test("reader positions and source selections survive keyboard switches and repeated workspace transitions", async ({ page, audit }) => {
  const source = "# Navigation λ😀\n\n" + Array.from({ length: 45 }, (_, index) => `## Section ${index}\n\nA paragraph of reading text for section ${index}.\n\n`).join("");
  await openFiles(page, [{ name: "same.md", text: source }, { name: "same.md", text: source }]);
  await readyReader(page, "Navigation λ😀");
  const picker = page.getByRole("combobox", { name: "Open documents" });
  await expect(picker.locator("option")).toHaveText(["same.md (1 of 2)", "same.md (2 of 2)"]);
  const scroll = page.locator("#reader-scroll");
  await scroll.evaluate(el => { el.style.scrollBehavior = "auto"; el.scrollTop = 800; });
  const first = await scroll.evaluate(el => el.scrollTop);
  await page.keyboard.press("Alt+Shift+n");
  await readyReader(page, "Navigation λ😀");
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(0);
  await scroll.evaluate(el => { el.scrollTop = 1500; });
  const second = await scroll.evaluate(el => el.scrollTop);
  await page.keyboard.press("Alt+Shift+p");
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(first);
  expect(audit.requests.filter(url => /workspace-|pagedjs/i.test(url)), "reading navigation must keep the PDF workspace lazy").toEqual([]);
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, source);
  const input = page.locator("#editor-input");
  await input.evaluate((el: HTMLTextAreaElement) => { el.setSelectionRange(100, 130, "backward"); el.scrollTop = 500; });
  const sourcePosition = await input.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd, el.selectionDirection, el.scrollTop]);
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Navigation λ😀");
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(first);
  await page.keyboard.press("Alt+Shift+n");
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(second);
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, source);
  await page.keyboard.press("Alt+Shift+p");
  await expect.poll(() => input.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd, el.selectionDirection, el.scrollTop])).toEqual(sourcePosition);
  await expect(input).toHaveValue(source);
  await page.screenshot({ path: test.info().outputPath("desktop-session-navigation.png"), fullPage: true });
});

for (const transition of ["document switch", "workspace round-trip"] as const) {
  test(`reader restores a near-end position after ${transition} with a visible outline at 1000px`, async ({ page, audit }) => {
    await page.setViewportSize({ width: 1000, height: 720 });
    const paragraph = "Wrapped reading text keeps the final document taller when its heading outline is visible. ".repeat(12);
    const source = "# Wrapped reader\n\n" + Array.from({ length: 16 }, (_, index) =>
      `## Section ${index}\n\n${paragraph}\n\n`).join("");
    await openFiles(page, [{ name: "wrapped.md", text: source }, { name: "other.md", text: "# Other" }]);
    await readyReader(page, "Wrapped reader");
    await expect(page.locator("#reader-outline")).toBeVisible();
    await expect(page.locator("#reader-outline a")).toHaveCount(17);
    const scroll = page.locator("#reader-scroll");
    const saved = await scroll.evaluate(el => {
      el.style.scrollBehavior = "auto";
      el.scrollTop = el.scrollHeight - el.clientHeight - 40;
      return el.scrollTop;
    });
    expect(saved).toBeGreaterThan(3000);
    expect(audit.requests.filter(url => /workspace-|pagedjs/i.test(url)), "reading stays lazy before entering the workspace").toEqual([]);

    if (transition === "document switch") {
      const picker = page.getByRole("combobox", { name: "Open documents" });
      await picker.selectOption({ label: "other.md" });
      await readyReader(page, "Other");
      await expect(page.locator("#reader-outline")).toBeHidden();
      await picker.selectOption({ label: "wrapped.md" });
    } else {
      await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
      await readyWorkspace(page, source);
      await page.getByRole("button", { name: "← Reading view", exact: true }).click();
    }

    await readyReader(page, "Wrapped reader");
    await expect(page.locator("#reader-outline")).toBeVisible();
    await expect.poll(() => scroll.evaluate(el => el.scrollTop), {
      message: `Restore the saved near-end offset after ${transition}, using the final outlined layout`,
    }).toBe(saved);
  });
}
