import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 844 }]) {
  test(`Undo close restores current Unicode source at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await loadMarkdownIntoApp(page, "# Original", "notes-café.md");
    await waitForPagination(page);
    const source = "# Current draft\n\nExact edits: café → λ\n";
    await page.locator("#editor-input").fill(source);
    await page.getByRole("button", { name: "Close document", exact: true }).click();
    await expect(page.locator("#empty-state")).toBeVisible();
    const undo = page.getByRole("button", { name: "Undo close", exact: true });
    await expect(undo).toBeVisible();
    await undo.focus();
    await undo.press("Enter");
    await expect(page.locator("#editor-input")).toHaveValue(source);
    await expect(page.locator("#editor-input")).toBeFocused();
    await expect(page.locator("#doc-switcher-select option:checked")).toHaveText("notes-café.md");
    await expect(undo).toBeHidden();
    await waitForPagination(page);
  });
}

test("Undo close appends recovery without overwriting another open document", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# First draft", "first.md");
  await waitForPagination(page);
  await loadMarkdownIntoApp(page, "# Second draft", "second.md");
  await waitForPagination(page);
  await page.getByRole("button", { name: "Close document", exact: true }).click();
  await page.locator("#editor-input").fill("# First draft, edited after close");
  await page.getByRole("button", { name: "Undo close", exact: true }).click();
  await expect(page.locator("#editor-input")).toHaveValue("# Second draft");
  await page.locator("#doc-switcher-select").selectOption({ label: "first.md" });
  await expect(page.locator("#editor-input")).toHaveValue("# First draft, edited after close");
  await expect(page.locator("#doc-switcher-select option")).toHaveCount(2);
});
