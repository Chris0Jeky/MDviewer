import { test, expect, openFiles, readyReader, readyWorkspace, dropFiles } from "./helpers";

test("Undo close cannot exceed 32 documents and a refusal retains the latest offer", async ({ page }) => {
  await openFiles(page, Array.from({ length: 32 }, (_, index) => ({ name: `${index}.md`, text: `# Document ${index}` })));
  await readyReader(page, "Document 0");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, "# Document 0");
  await page.getByRole("button", { name: "Close 0.md", exact: true }).click();
  await readyWorkspace(page, "# Document 1");
  await dropFiles(page, [{ name: "replacement.md", text: "# Replacement" }], "#desktop-workspace");
  await readyWorkspace(page, "# Replacement");
  const picker = page.getByRole("combobox", { name: "Active document" });
  const undo = page.getByRole("button", { name: "Undo close", exact: true });
  await undo.click();
  await expect(picker.locator("option")).toHaveCount(32);
  await expect(page.locator("#workspace-notice")).toContainText("at most 32 documents");
  await expect(page.locator(".document-recovery-name")).toHaveText("0.md");
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(picker.locator("option")).toHaveCount(32);
  await expect(page.locator("#editor-input")).toHaveValue("# Replacement");
  // A later real close still replaces recovery: it does not preserve an older offer.
  await page.getByRole("button", { name: "Close replacement.md", exact: true }).click();
  await expect(page.locator(".document-recovery-name")).toHaveText("replacement.md");
  await undo.click();
  await readyWorkspace(page, "# Replacement");
  await expect(picker.locator("option")).toHaveCount(32);
  await expect(undo).toBeHidden();
  await expect(page).toHaveTitle("replacement.md — MDviewer");
});

test("Undo checks UTF-8 session bytes before consuming edits and retries after capacity is freed", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await openFiles(page, [{ name: "draft.md", text: "# Draft" }, { name: "budget.md", text: "# Budget" }]);
  await readyReader(page, "Draft");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, "# Draft");
  const edited = "# Recovered edited draft\n\nPrivate edits λ " + "keep these words. ".repeat(10);
  await page.locator("#editor-input").fill(edited);
  await page.getByRole("button", { name: "Close draft.md", exact: true }).click();
  await readyWorkspace(page, "# Budget");
  // The live source itself remains below 25,000,000 UTF-8 bytes. Restoring
  // the edited draft would exceed that bound, despite being under it in UTF-16.
  const large = `<!--${"é".repeat(12_499_990)}-->`;
  expect(Buffer.byteLength(large)).toBeLessThan(25_000_000);
  expect(Buffer.byteLength(large) + Buffer.byteLength(edited)).toBeGreaterThan(25_000_000);
  await page.locator("#editor-input").fill(large);
  const undo = page.getByRole("button", { name: "Undo close", exact: true });
  await undo.click();
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveText(["budget.md"]);
  await expect(page.locator("#workspace-notice")).toContainText("memory limit");
  await expect(page.locator(".document-recovery-name")).toHaveText("draft.md");
  await expect(undo).toBeVisible();
  // Editing the remaining document frees capacity without replacing recovery.
  await page.locator("#editor-input").fill("# Budget reduced");
  await undo.click();
  await readyWorkspace(page, edited);
  await expect(undo).toBeHidden();
  await expect(page).toHaveTitle("draft.md — MDviewer");
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Recovered edited draft");
  await expect(page.getByRole("combobox", { name: "Open documents" }).locator("option")).toHaveText(["• budget.md", "• draft.md"]);
  page.removeAllListeners("dialog");
  let prompted = false;
  page.on("dialog", async dialog => { prompted = true; await dialog.dismiss(); });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect(prompted, "restored edits retain discard protection after returning to reading").toBe(true);
  await readyReader(page, "Recovered edited draft");
});
