import { test, expect, type Page } from "@playwright/test";
import { waitForPagination } from "../helpers/pagedDom";

async function pickMarkdown(page: Page, name: string, text: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser", { timeout: 5_000 });
  await page.getByRole("button", { name: "Open Markdown", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "text/markdown", buffer: Buffer.from(text) });
}

test("document-authored file-input IDs do not intercept Open Markdown", async ({ page }) => {
  await page.goto("/");
  await pickMarkdown(page, "reserved-id.md", "# Authored identifiers\n\n<div id=\"file-input\">Document-owned marker.</div>");
  await waitForPagination(page);
  // This node precedes the application's real body-level file input in document
  // order. A fresh global getElementById lookup would click the authored div.
  await expect(page.locator('#paged-output [id="file-input"]')).toHaveText("Document-owned marker.");

  await pickMarkdown(page, "second.md", "# Second document\n\nOpened using the real picker.");
  await waitForPagination(page);
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveText(["reserved-id.md", "second.md"]);
  await expect(page.locator("#editor-input")).toHaveValue("# Second document\n\nOpened using the real picker.");
  await expect(page.locator("#paged-output")).toContainText("Opened using the real picker.");
  await expect(page.locator("#paged-output")).not.toContainText("Document-owned marker.");
});
