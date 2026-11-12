import { readFile } from "node:fs/promises";
import { test, expect, documentTabs, moreMenu, openFiles, readyReader, readyWorkspace, selectDocument } from "./helpers";

test("New starts locally from the empty reader, previews edits and saves exact Markdown", async ({ page, audit }) => {
  await expect(page.locator("#editor-input, #paged-output")).toHaveCount(0);
  expect(audit.requests.filter(url => /\/assets\/workspace-[^/]+\.(?:js|css)$/.test(url))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("desktop-new-empty-reader.png"), fullPage: true });
  await page.getByRole("button", { name: "New document", exact: true }).click();
  const editor = page.locator("#editor-input");
  await expect(editor).toBeFocused({ timeout: 30_000 });
  await expect(editor).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveText(["Untitled.md"]);
  const source = "# A new local note\n\n**Written here**, with Unicode: café → λ.\n";
  await editor.fill(source);
  await readyWorkspace(page, source);
  await expect(page.locator("#paged-output h1")).toHaveText("A new local note");
  await page.screenshot({ path: test.info().outputPath("desktop-new-document.png"), fullPage: true });
  const saving = page.waitForEvent("download");
  await editor.press("Control+s");
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("Untitled.md");
  expect(await readFile((await saved.path())!, "utf8")).toBe(source);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("A new local note");
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "A new local note");
  await expect(documentTabs(page)).toHaveText(["Untitled.md, unsaved changes"]);
});

test("New retains existing files, uses distinct names and reveals a Preview-only source pane", async ({ page }) => {
  const originals = [{ name: "UNTITLED.MD", text: "# Keep this original" }, { name: "Untitled 2.md", text: "# Keep this other file" }];
  await openFiles(page, originals);
  await readyReader(page, "Keep this original");
  await moreMenu(page, "New document");
  const editor = page.locator("#editor-input");
  const picker = page.getByRole("combobox", { name: "Active document" });
  await expect(editor).toBeFocused({ timeout: 30_000 });
  await expect(picker.locator("option")).toHaveText(["UNTITLED.MD", "Untitled 2.md", "Untitled 3.md"]);
  await editor.fill("# Keep the new source too");
  await readyWorkspace(page, "# Keep the new source too");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(editor).toBeHidden();
  await moreMenu(page, "New document");
  await expect(page.locator("#workspace")).toHaveAttribute("data-view-mode", "editor");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("");
  await expect(picker.locator("option")).toHaveText(["UNTITLED.MD", "Untitled 2.md", "Untitled 3.md", "Untitled 4.md"]);
  await selectDocument(page, "Untitled 3.md");
  await expect(editor).toHaveValue("# Keep the new source too");
  for (const original of originals) {
    await selectDocument(page, original.name);
    await expect(editor).toHaveValue(original.text);
  }
  await page.screenshot({ path: test.info().outputPath("desktop-new-reveals-source.png"), fullPage: true });
});

test("reader and workspace New shortcuts keep blank documents distinct and closable", async ({ page }) => {
  await page.keyboard.press("Control+n");
  const editor = page.locator("#editor-input");
  await expect(editor).toBeFocused({ timeout: 30_000 });
  await editor.press("Control+n");
  await editor.press("Meta+n");
  const picker = page.getByRole("combobox", { name: "Active document" });
  await expect(picker.locator("option")).toHaveText(["Untitled.md", "Untitled 2.md", "Untitled 3.md"]);
  await expect(editor).toBeFocused();
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.getByRole("button", { name: "Close Untitled 3.md", exact: true }).click();
  await expect(picker.locator("option")).toHaveText(["Untitled.md", "Untitled 2.md"]);
  expect(dialogs, "pristine blank documents contain no edits to discard").toEqual([]);
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await expect(page.locator("#reader-shell")).toBeVisible();
  await expect(documentTabs(page)).toHaveText(["Untitled.md", "Untitled 2.md"]);
  await page.keyboard.press("Meta+n");
  await expect(editor).toBeFocused({ timeout: 30_000 });
  await expect(picker.locator("option")).toHaveText(["Untitled.md", "Untitled 2.md", "Untitled 3.md"]);
});

test("New refuses a full desktop session without replacing the selected file", async ({ page }) => {
  await openFiles(page, Array.from({ length: 32 }, (_, index) => ({ name: `${index}.md`, text: `# Retained document ${index}` })));
  await readyReader(page, "Retained document 0");
  await moreMenu(page, "New document");
  await expect(page.locator("#reader-notice")).toContainText("at most 32 documents");
  await expect(documentTabs(page)).toHaveCount(32);
  await expect(page.locator("#reader-document h1")).toHaveText("Retained document 0");
  await expect(page.locator("#editor-input")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, "# Retained document 0");
  await moreMenu(page, "New document");
  await expect(page.locator("#workspace-notice")).toContainText("at most 32 documents");
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveCount(32);
  await expect(page.locator("#editor-input")).toHaveValue("# Retained document 0");
});
