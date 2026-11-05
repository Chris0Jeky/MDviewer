import { readFile } from "node:fs/promises";
import { test, expect, openFiles, readyReader, readyWorkspace } from "./helpers";

test("desktop source Find and Replace preserves the exact saved note and reading view", async ({ page }) => {
  const source = "# Local writing\n\nA cat and another cat.\n";
  await openFiles(page, [{ name: "writing.md", text: source }]);
  await readyReader(page, "Local writing");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, source);
  await page.locator("#editor-input").press("Control+h");
  await page.getByRole("searchbox", { name: "Find in Markdown" }).fill("cat");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 2 matches");
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("fox");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  const edited = "# Local writing\n\nA fox and another fox.\n";
  await expect(page.locator("#editor-input")).toHaveValue(edited);
  await expect(page.locator("#paged-output")).toContainText("A fox and another fox.");
  await page.screenshot({ path: test.info().outputPath("desktop-find-replace.png"), fullPage: true });
  const saving = page.waitForEvent("download");
  await page.locator("#editor-input").press("Control+s");
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("writing.md");
  expect(await readFile((await saved.path())!, "utf8")).toBe(edited);
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Local writing");
  await expect(page.locator("#reader-document")).toContainText("A fox and another fox.");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("another fox");
});
