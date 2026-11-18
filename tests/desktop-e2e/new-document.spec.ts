import { readFile } from "node:fs/promises";
import { test, expect, documentTabs, moreMenu, openFiles, readyReader, readyWorkspace, openPdf, saveCopy } from "./helpers";

test("New starts a local note in Edit beside the live reader and saves exact Markdown", async ({ page, audit }) => {
  await expect(page.locator("#editor-input, #paged-output")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("desktop-new-empty-reader.png"), fullPage: true });
  await page.getByRole("button", { name: "New document", exact: true }).click();
  const editor = page.locator("#reader-edit #editor-input");
  await expect(editor).toBeFocused({ timeout: 30_000 });
  await expect(editor).toHaveValue("");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(documentTabs(page)).toHaveText(["Untitled.md"]);
  await expect(page.locator("#reader-notice")).toBeHidden(); // an empty note is a start, not a problem
  const source = "# A new local note\n\n**Written here**, with Unicode: café → λ.\n";
  await editor.fill(source);
  await expect(page.locator("#reader-document h1")).toHaveText("A new local note");
  await expect(documentTabs(page)).toHaveText(["Untitled.md, unsaved changes"]);
  await page.screenshot({ path: test.info().outputPath("desktop-new-document.png"), fullPage: true });
  // Edit is the reader plus a source pane: no workspace, preview or Paged.js code is loaded.
  expect(audit.requests.filter(url => /\/assets\/(?:workspace|App|paged|pagedjs)[^/]*\.(?:js|css)$/i.test(url))).toEqual([]);
  const saving = page.waitForEvent("download");
  await saveCopy(page, editor);
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("Untitled.md");
  expect(await readFile((await saved.path())!, "utf8")).toBe(source);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("A new local note");
  // The same text continues into the paginated workspace.
  await openPdf(page);
  await readyWorkspace(page, source);
  await expect(page.locator("#paged-output h1")).toHaveText("A new local note");
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "A new local note");
  await expect(documentTabs(page)).toHaveText(["Untitled.md, unsaved changes"]);
  await expect(page.locator("#reader-edit")).toBeHidden();
});

test("New retains existing files, uses distinct names and reveals a Preview-only source pane", async ({ page }) => {
  const originals = [{ name: "UNTITLED.MD", text: "# Keep this original" }, { name: "Untitled 2.md", text: "# Keep this other file" }];
  await openFiles(page, originals);
  await readyReader(page, "Keep this original");
  await moreMenu(page, "New document");
  await expect(page.locator("#reader-edit #editor-input")).toBeFocused({ timeout: 30_000 });
  await expect(documentTabs(page)).toHaveText(["UNTITLED.MD", "Untitled 2.md", "Untitled 3.md"]);
  await page.locator("#reader-edit #editor-input").fill("# Keep the new source too");
  await openPdf(page);
  const editor = page.locator("#editor-input");
  const picker = page.getByRole("combobox", { name: "Active document" });
  await expect(editor).toBeFocused({ timeout: 30_000 });
  await expect(picker.locator("option")).toHaveText(["UNTITLED.MD", "Untitled 2.md", "Untitled 3.md"]);
  await readyWorkspace(page, "# Keep the new source too");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.locator("#workspace")).toHaveAttribute("data-view-mode", "editor");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("");
  await expect(picker.locator("option")).toHaveText(["UNTITLED.MD", "Untitled 2.md", "Untitled 3.md", "Untitled 4.md"]);
  await picker.selectOption({ label: "Untitled 3.md" });
  await expect(editor).toHaveValue("# Keep the new source too");
  for (const original of originals) {
    await picker.selectOption({ label: original.name });
    await expect(editor).toHaveValue(original.text);
  }
  await page.screenshot({ path: test.info().outputPath("desktop-new-reveals-source.png"), fullPage: true });
});

test("reader and workspace New shortcuts keep blank documents distinct and closable", async ({ page }) => {
  await page.keyboard.press("Control+n");
  const edit = page.locator("#reader-edit #editor-input");
  await expect(edit).toBeFocused({ timeout: 30_000 });
  await edit.press("Control+n");
  await expect(documentTabs(page)).toHaveText(["Untitled.md", "Untitled 2.md"]);
  await expect(edit).toBeFocused();
  await edit.press("Meta+n");
  await expect(documentTabs(page)).toHaveText(["Untitled.md", "Untitled 2.md", "Untitled 3.md"]);
  await expect(edit).toBeFocused();
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.keyboard.press("Control+w");
  await expect(documentTabs(page)).toHaveText(["Untitled.md", "Untitled 2.md"]);
  expect(dialogs, "pristine blank documents contain no edits to discard").toEqual([]);
  // The workspace's own New keeps its documents distinct too.
  await openPdf(page);
  const editor = page.locator("#editor-input");
  const picker = page.getByRole("combobox", { name: "Active document" });
  await expect(editor).toBeFocused({ timeout: 30_000 });
  await editor.press("Meta+n");
  await expect(picker.locator("option")).toHaveText(["Untitled.md", "Untitled 2.md", "Untitled 3.md"]);
  await page.getByRole("button", { name: "Close Untitled 3.md", exact: true }).click();
  await expect(picker.locator("option")).toHaveText(["Untitled.md", "Untitled 2.md"]);
  expect(dialogs).toEqual([]);
});

test("New refuses a full desktop session without replacing the selected file", async ({ page }) => {
  await openFiles(page, Array.from({ length: 32 }, (_, index) => ({ name: `${index}.md`, text: `# Retained document ${index}` })));
  await readyReader(page, "Retained document 0");
  await moreMenu(page, "New document");
  await expect(page.locator("#reader-notice")).toContainText("at most 32 documents");
  await expect(documentTabs(page)).toHaveCount(32);
  await expect(page.locator("#reader-document h1")).toHaveText("Retained document 0");
  await expect(page.locator("#editor-input")).toHaveCount(0);
  await openPdf(page);
  await readyWorkspace(page, "# Retained document 0");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.locator("#workspace-notice")).toContainText("at most 32 documents");
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveCount(32);
  await expect(page.locator("#editor-input")).toHaveValue("# Retained document 0");
});
