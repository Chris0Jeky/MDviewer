import { test, expect, openFiles, readyReader, readyWorkspace } from "./helpers";

const SKILL = `---
name: broken-skill
summary: Use when: the export fails
---

# Body heading

Body text.
`;

test("front matter is a Properties card in the reader and omitted from the paginated output", async ({ page }) => {
  await openFiles(page, [{ name: "SKILL.md", text: SKILL }]);
  await readyReader(page, "Body heading");
  const doc = page.locator("#reader-document");
  const card = doc.locator("details.reader-properties");
  await expect(card).toHaveAttribute("open", "");
  await expect(card.locator("summary")).toContainText("2 problems");
  await expect(card.locator(".reader-properties-problems li")).toHaveText([
    /Line 3: The value of "summary" contains ": "/,
    /Line 1: This skill has no "description"/,
  ]);
  await expect(card.locator("dt")).toHaveText(["name", "summary"]);
  await expect(doc.locator("hr, h2")).toHaveCount(0);
  await card.locator("summary").click();
  await expect(card).not.toHaveAttribute("open", "");
  await expect(card.locator("dl")).toBeHidden();

  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, SKILL);
  const pages = page.locator("#paged-output");
  await expect(pages.locator("h1")).toHaveText("Body heading");
  await expect(pages).not.toContainText("broken-skill");
  await expect(pages.locator("hr")).toHaveCount(0);
});
