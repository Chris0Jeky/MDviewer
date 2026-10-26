import { test, expect, openFiles, readyReader } from "./helpers";

test("empty-document warnings retain rejected-file errors and clear on the next document", async ({ page }) => {
  await page.locator("#reader-file-input").setInputFiles([
    { name: "empty.md", mimeType: "text/markdown", buffer: Buffer.alloc(0) },
    { name: "invalid.md", mimeType: "text/markdown", buffer: Buffer.from([0xff]) },
  ]);
  await expect(page.locator("#reader-document")).toHaveAttribute("aria-busy", "false");
  const notice = page.locator("#reader-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("invalid.md:");
  await expect(notice).toContainText("This document is empty.");
  await expect(page.locator("#reader-documents option")).toHaveText(["empty.md"]);
  expect(await page.locator("#workspace-notice").textContent()).toBe(await notice.textContent());
  await openFiles(page, [{ name: "next.md", text: "# Next document" }]);
  await readyReader(page, "Next document");
  await expect(notice).toBeHidden();
  await expect(notice).toHaveText("");
});
