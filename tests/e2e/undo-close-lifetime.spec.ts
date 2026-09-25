import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

test("recovery handles long filenames, explicit discard and print hiding on phones", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  const name = `${"very-long-filename-".repeat(16)}.md`;
  await loadMarkdownIntoApp(page, "# Recoverable", name);
  await waitForPagination(page);
  await page.getByRole("button", { name: `Close ${name}`, exact: true }).click();
  const row = page.locator(".document-recovery");
  await expect(row).toBeVisible();
  await expect(row.locator("strong")).toHaveText(name);
  await expect(row.locator("strong")).toHaveAttribute("title", name);
  expect(await page.locator("#toolbar").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath("undo-close-phone.png") });
  await page.emulateMedia({ media: "print" });
  await expect(row).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await row.getByRole("button", { name: "Discard closed document" }).click();
  await expect(row).toBeHidden();
  await expect(page.getByRole("button", { name: "Open Markdown", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.locator("#editor-input")).toHaveValue("");
  await expect(row).toBeHidden();
});

test("recovery preserves Preview-only mode and returns focus to document identity", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Preview draft", "preview.md");
  await waitForPagination(page);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Close preview.md", exact: true }).click();
  await page.getByRole("button", { name: "Undo close", exact: true }).click();
  await expect(page.locator("#workspace")).toHaveAttribute("data-view-mode", "preview");
  await expect(page.locator("#doc-switcher-select")).toBeFocused();
  await waitForPagination(page);
  await expect(page.locator("#paged-output")).toContainText("Preview draft");
});
