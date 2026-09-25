import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

for (const modifier of ["Control", "Meta"]) {
  test(`${modifier}+S saves latest source rather than the application HTML`, async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "# Original", "notes.md");
    await waitForPagination(page);
    const source = "# Latest edit\n\nUnicode: café → λ\n";
    await page.locator("#editor-input").fill(source);
    const downloaded = page.waitForEvent("download", { timeout: 5000 });
    await page.locator("#editor-input").press(`${modifier}+s`);
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("notes.md");
    expect(await readFile((await download.path())!, "utf8")).toBe(source);
    await expect(page.locator("#editor-input")).toHaveValue(source);
  });
}

test("Control+O reuses the Markdown file picker", async ({ page }) => {
  await page.goto("/");
  const picking = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.locator("#editor-input").press("Control+o");
  const picker = await picking;
  await picker.setFiles({ name: "keyboard.md", mimeType: "text/markdown", buffer: Buffer.from("# Opened with the keyboard") });
  await waitForPagination(page);
  await expect(page.locator("#editor-input")).toHaveValue("# Opened with the keyboard");
});
