import { test, expect } from "@playwright/test";
import { installPickers, readFile, writeFile } from "../desktop-e2e/helpers";

/**
 * The companion shell as a second entry of the web build (web parity W2a): `/desktop.html`
 * boots on the browser host and saves the user's file in place, while `/` stays the existing
 * app until the default flip (W2b). The full shell suite runs on the browser host in
 * `playwright.webhost.config.ts` (project `webhost-desktop`).
 */
test("the web build serves the shell on the browser host beside the existing app", async ({ page }) => {
  await installPickers(page); // OS pickers cannot be driven headless: hand the app OPFS handles
  await page.goto("/desktop.html");
  await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
  await writeFile(page, "notes.md", Buffer.from("# Notes\r\n\r\nFirst.\r\n"));
  await page.evaluate(() => { window.__pick = ["notes.md"]; });
  await page.keyboard.press("Control+O");
  await expect(page.locator("#reader-document h1")).toHaveText("Notes");
  await expect(page.locator("#reader-save-state")).toHaveText("Saved");
  await page.keyboard.press("Control+e");
  await expect(page.locator("#reader-edit #editor-input")).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Second.");
  await page.keyboard.press("Control+s");
  await expect(page.locator("#reader-save-state")).toHaveText("Saved");
  expect((await readFile(page, "notes.md")).toString()).toBe("# Notes\r\n\r\nFirst.\r\nSecond.");

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#reader-shell")).toHaveCount(0);
});
