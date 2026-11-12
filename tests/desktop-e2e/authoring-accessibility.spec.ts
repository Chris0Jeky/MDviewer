import { readFile } from "node:fs/promises";
import { test, expect, newInWorkspace, readyWorkspace } from "./helpers";

test("keyboard New, layout, Find and Save expose usable names, states and focus", async ({ page, browser, browserName }, info) => {
  await info.attach("browser-runtime", { body: JSON.stringify({ engine: browserName, version: browser.version() }), contentType: "application/json" });
  await page.setViewportSize({ width: 640, height: 480 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await newInWorkspace(page);
  const input = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await expect(input).toBeFocused({ timeout: 30_000 });
  const text = "# Keyboard-only note\n\nUnicode: café → 日本語.\n";
  await page.keyboard.insertText(text);
  await readyWorkspace(page, text);
  const layout = page.locator(".workspace-formatting");
  const summary = layout.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await expect(layout).toHaveAttribute("open");
  await summary.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest(".workspace-formatting"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(summary).toBeFocused();
  await expect(layout).not.toHaveAttribute("open");
  await input.focus();
  await input.press("Control+f");
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await expect(query).toBeFocused();
  await page.keyboard.insertText("日本語");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  await query.press("Escape");
  await expect(input).toBeFocused();
  const saving = page.waitForEvent("download");
  await input.press("Control+s");
  const saved = await saving;
  expect(await readFile((await saved.path())!, "utf8")).toBe(text);
  await expect(page.getByRole("button", { name: "Save Markdown", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Open Markdown", exact: true })).toHaveAttribute("aria-keyshortcuts", /Control\+o/);
  await expect(page.locator("#reader-new")).toHaveAttribute("aria-keyshortcuts", /Control\+N/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640);
  await page.screenshot({ path: info.outputPath("keyboard-desktop-reflow.png"), fullPage: true });
});

test("an invalid Open announces a recoverable error and keyboard retry opens the file", async ({ page }) => {
  let choosing = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  await (await choosing).setFiles({ name: "not-markdown.txt", mimeType: "text/plain", buffer: Buffer.from("Rejected source") });
  const notice = page.locator("#reader-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("role", "status");
  await expect(notice).toHaveAttribute("aria-live", "polite");
  await expect(notice).toContainText("Markdown");
  const snapshot = await page.locator("#reader-shell").ariaSnapshot();
  expect(snapshot).toContain("Markdown");
  await expect(page.getByRole("button", { name: "Open…", exact: true })).toBeEnabled();
  choosing = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  await (await choosing).setFiles({ name: "valid.md", mimeType: "text/markdown", buffer: Buffer.from("# Recovered note") });
  await expect(page.locator("#reader-document h1")).toHaveText("Recovered note");
  await expect(page.locator("#reader-document")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#reader-status")).toContainText(/ words? · /);
});

test("desktop Find and Format retain usable source space together at 560×420", async ({ page }, info) => {
  await page.setViewportSize({ width: 560, height: 420 });
  await newInWorkspace(page);
  const input = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await expect(input).toBeFocused({ timeout: 30_000 });
  const text = "# Both panels\n\nSource remains available.";
  await page.keyboard.insertText(text);
  await readyWorkspace(page, text);
  const output = page.locator("#paged-output");
  // New may still have its completed blank draft page while typing is debounced.
  // Capture the actual typed document before checking that panel controls keep it.
  await expect(output.locator("h1")).toHaveText("Both panels");
  await readyWorkspace(page, text);
  const rendered = await output.innerHTML();
  const originalInput = await input.elementHandle();
  await page.getByRole("button", { name: "Format Markdown", exact: true }).click();
  await input.focus();
  await input.press("Control+f");
  await expect(page.getByRole("searchbox", { name: "Find in Markdown" })).toBeFocused();
  await expect(page.locator(".workspace-shortcuts")).toBeHidden();
  await expect(page.locator(".workspace-privacy")).toBeVisible();
  await expect(page.locator(".workspace-privacy")).toContainText("Documents stay in memory");
  await expect(page.getByRole("button", { name: "Save Markdown", exact: true })).toBeVisible();
  const source = (await input.boundingBox())!;
  expect(source.height).toBeGreaterThanOrEqual(60);
  expect(source.y + source.height).toBeLessThanOrEqual(421);
  for (const button of await page.locator("#editor-formatting button").all()) {
    await button.scrollIntoViewIfNeeded();
    const bounds = (await button.boundingBox())!;
    // Firefox can report a 30px target a few hundred-thousandths below 30.
    expect(Number(bounds.width.toFixed(3))).toBeGreaterThanOrEqual(30);
    expect(Number(bounds.height.toFixed(3))).toBeGreaterThanOrEqual(30);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(561);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(560);
  expect(await output.innerHTML()).toBe(rendered);
  expect(await input.evaluate((node, old) => node === old, originalInput)).toBe(true);
  const canvas = page.locator("#app > #workspace > #canvas");
  await expect(canvas).toBeHidden();
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(0);
  await input.focus();
  await input.press("End");
  await input.press("!");
  await expect(input).toHaveValue(text + "!");
  await expect(input).toBeFocused();
  await page.screenshot({ path: info.outputPath("desktop-find-format-short.png") });
  await page.getByRole("button", { name: "Close formatting", exact: true }).click();
  await expect(page.locator(".workspace-shortcuts")).toBeVisible();
});
