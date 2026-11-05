import { expect, test } from "@playwright/test";
import { loadMarkdownIntoApp } from "../helpers/pagedDom";

// Native undo is a browser contract: jsdom cannot establish these guarantees.
test.describe("editor edit ownership and native undo", () => {
  test("adopting the first typed document preserves its native undo entry", async ({ page }) => {
    await page.goto("/");
    const input = page.locator("#editor-input");
    await input.focus();
    await page.keyboard.insertText("First typed document");
    await expect(input).toHaveValue("First typed document");
    await expect(page.locator(".doc-switcher option")).toHaveCount(1);
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("");
  });

  test("equal-content document switches cannot undo into the previous document", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "Earlier content in A", "a.md");
    const input = page.locator("#editor-input");
    await expect(input).toHaveValue("Earlier content in A");
    await input.focus();
    await input.press("ControlOrMeta+a");
    await page.keyboard.insertText("Identical current content");
    await expect(input).toHaveValue("Identical current content");

    await loadMarkdownIntoApp(page, "Identical current content", "b.md");
    const docs = page.locator(".doc-switcher");
    await expect(docs.locator("option")).toHaveCount(2);
    await docs.selectOption({ label: "b.md" });
    await expect(page.locator(".editor-name")).toHaveText("b.md");
    await input.focus();
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("Identical current content");
    await docs.selectOption({ label: "a.md" });
    await expect(input).toHaveValue("Identical current content");
  });

  test("the shared guarded insertion path keeps Tab undoable", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "abc", "tab.md");
    const input = page.locator("#editor-input");
    await expect(input).toHaveValue("abc");
    await input.focus();
    await input.press("End");
    await input.press("Tab");
    await expect(input).toHaveValue("abc\t");
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("abc");
  });
});
