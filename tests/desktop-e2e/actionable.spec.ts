import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, openFiles, readyReader, readyWorkspace } from "./helpers";

const fixture = (name: string): string => readFileSync(resolve("tests/fixtures/actionable", `${name}.md`), "utf8");

const DOC = `---
title: Board
status: draft
status.options: [draft, review, done]
priority: urgent
priority.options: [low, high]
marks: [" ", "/", "x"]
---

# Board

- [ ] To do
- [x] Done
- [/] In progress
- [-] Dropped
- [!] Blocked <!-- id: twin -->
- [?] Question <!-- id: twin -->

- ( ) Small
- (x) Large

owner:: Ada
reviewer::
`;

test("actionable controls render statically in the reader", async ({ page }) => {
  await openFiles(page, [{ name: "board.md", text: DOC }]);
  await readyReader(page, "Board");
  const doc = page.locator("#reader-document");

  // Marks: the task-list boxes plus glyphs for the four new marks, each with a name.
  await expect(doc.locator(".task-list-item-checkbox")).toHaveCount(2);
  await expect(doc.getByRole("img", { name: "In progress" })).toHaveCount(1);
  await expect(doc.getByRole("img", { name: "Dropped" })).toHaveCount(1);
  await expect(doc.getByRole("img", { name: "Blocked" })).toHaveCount(1);
  await expect(doc.getByRole("img", { name: "Question" })).toHaveCount(1);
  await expect(doc.locator("li.am-dropped")).toHaveCSS("text-decoration-line", "line-through");
  await expect(doc.locator("li", { hasText: "Blocked" })).not.toContainText("id:"); // the id comment is invisible

  // Choices.
  await expect(doc.getByRole("img", { name: "Selected", exact: true })).toHaveCount(1);
  await expect(doc.getByRole("img", { name: "Not selected", exact: true })).toHaveCount(1);
  await expect(doc.locator("li", { hasText: "Large" })).not.toContainText("(x)");

  // Fields: the key is a label, the value stays.
  await expect(doc.locator(".am-field-key")).toHaveText(["owner", "reviewer"]);
  await expect(doc.locator("p", { has: page.locator(".am-field-key") })).not.toContainText("::");

  // Chips above the document; a value outside its options is marked.
  await expect(doc.locator(".am-chip")).toHaveCount(2);
  await expect(doc.locator(".am-chip").first()).toContainText("status");
  await expect(doc.locator(".am-chip.am-off")).toContainText("urgent");

  // Problems are reported on the Properties card.
  await expect(doc.locator(".reader-properties-problems")).toContainText('"twin" is used 2 times');

  // A1 is static: nothing to click changes the document.
  await expect(doc.locator("input:not([disabled])")).toHaveCount(0);
  await doc.getByRole("img", { name: "In progress" }).click();
  await expect(doc.getByRole("img", { name: "In progress" })).toHaveCount(1);
});

test("the paginated output shows marks and choices as glyphs, fields as text and no chips", async ({ page }) => {
  await openFiles(page, [{ name: "board.md", text: DOC }]);
  await readyReader(page, "Board");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, DOC);
  const pages = page.locator("#paged-output");
  await expect(pages.locator(".am-box")).toHaveCount(4);
  await expect(pages.locator(".am-radio")).toHaveCount(2);
  await expect(pages).toContainText("owner:: Ada");
  await expect(pages.locator(".am-chip, .am-field-key")).toHaveCount(0);
  await expect(pages).not.toContainText("status.options");
});

test("every conformance fixture renders without errors", async ({ page }) => {
  for (const name of ["tasks", "marks", "choices", "fields", "chips", "bom-crlf"]) {
    await openFiles(page, [{ name: `${name}.md`, text: fixture(name) }]);
    await expect(page.locator("#reader-document")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#reader-notice")).not.toContainText("Could not render");
  }
});
