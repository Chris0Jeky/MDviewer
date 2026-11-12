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

test("actionable controls render as named controls in the reader", async ({ page }) => {
  await openFiles(page, [{ name: "board.md", text: DOC }]);
  await readyReader(page, "Board");
  const doc = page.locator("#reader-document");

  // Marks are checkboxes named by their item and mark; "/" is mixed.
  await expect(doc.getByRole("checkbox")).toHaveCount(6);
  await expect(doc.getByRole("checkbox", { name: "To do (To do)" })).toHaveAttribute("aria-checked", "false");
  await expect(doc.getByRole("checkbox", { name: "Done (Done)" })).toHaveAttribute("aria-checked", "true");
  await expect(doc.getByRole("checkbox", { name: "In progress (In progress)" })).toHaveAttribute("aria-checked", "mixed");
  await expect(doc.getByRole("checkbox", { name: /Blocked \(Blocked\)/ })).toBeVisible();
  await expect(doc.locator("li.am-dropped")).toHaveCSS("text-decoration-line", "line-through");
  await expect(doc.locator("li", { hasText: "Blocked" })).not.toContainText("id:"); // the id comment is invisible

  // Choices are one radio group.
  await expect(doc.getByRole("radiogroup")).toHaveCount(1);
  await expect(doc.getByRole("radio", { name: "Large" })).toHaveAttribute("aria-checked", "true");
  await expect(doc.getByRole("radio", { name: "Small" })).toHaveAttribute("aria-checked", "false");
  await expect(doc.locator("li", { hasText: "Large" })).not.toContainText("(x)");

  // Fields: the key is a label, the value an editable button.
  await expect(doc.locator(".am-field-key")).toHaveText(["owner", "reviewer"]);
  await expect(doc.getByRole("button", { name: "Edit owner: Ada" })).toBeVisible();
  await expect(doc.getByRole("button", { name: "Edit reviewer: empty" })).toBeVisible();

  // Chips above the document; a value outside its options is marked.
  await expect(doc.locator(".am-chip")).toHaveCount(2);
  await expect(doc.getByRole("button", { name: /^status: draft\. Click for review/ })).toBeVisible();
  await expect(doc.locator(".am-chip.am-off")).toContainText("urgent");

  // Problems are reported on the Properties card.
  await expect(doc.locator(".reader-properties-problems")).toContainText('"twin" is used 2 times');
  // Authored HTML inputs stay inert: none is enabled.
  await expect(doc.locator("input:not([disabled]):not(.am-input)")).toHaveCount(0);
});

test("in memory (web build), gestures change exactly the span, by pointer and keyboard", async ({ page }) => {
  await openFiles(page, [{ name: "board.md", text: DOC }]);
  await readyReader(page, "Board");
  const doc = page.locator("#reader-document");
  // Click steps the declared cycle " " -> "/" -> "x"; the tab shows unsaved changes.
  await doc.getByRole("checkbox", { name: "To do (To do)" }).click();
  await readyReader(page, "Board");
  await expect(doc.getByRole("checkbox", { name: "To do (In progress)" })).toHaveAttribute("aria-checked", "mixed");
  await expect(page.locator('#shell-tabs [role="tab"]')).toHaveText(["board.md, unsaved changes"]);

  // Space on a focused checkbox steps again.
  await doc.getByRole("checkbox", { name: "To do (In progress)" }).focus();
  await page.keyboard.press("Space");
  await readyReader(page, "Board");
  await expect(doc.getByRole("checkbox", { name: "To do (Done)" })).toHaveAttribute("aria-checked", "true");

  // The context-menu key opens all six marks; digits pick.
  await doc.getByRole("checkbox", { name: "Done (Done)" }).focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Mark Done" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(6);
  await expect(menu.getByRole("menuitemradio", { name: /Done/ })).toBeFocused();
  await page.keyboard.press("5");
  await readyReader(page, "Board");
  await expect(doc.getByRole("checkbox", { name: "Done (Blocked)" })).toBeVisible();

  // A click on a mark outside the cycle opens the menu instead of guessing.
  await doc.getByRole("checkbox", { name: /Question \(Question\)/ }).click();
  await expect(page.getByRole("menu", { name: /Mark Question/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(doc.getByRole("checkbox", { name: /Question \(Question\)/ })).toBeFocused();

  // Choices: arrows move focus, Space selects (one atomic change for the group).
  await doc.getByRole("radio", { name: "Large" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(doc.getByRole("radio", { name: "Small" })).toBeFocused();
  await page.keyboard.press("Space");
  await readyReader(page, "Board");
  await expect(doc.getByRole("radio", { name: "Small" })).toHaveAttribute("aria-checked", "true");
  await expect(doc.getByRole("radio", { name: "Large" })).toHaveAttribute("aria-checked", "false");

  // Fields: Enter commits, Escape cancels.
  await doc.getByRole("button", { name: "Edit reviewer: empty" }).click();
  await page.keyboard.type("Lin");
  await page.keyboard.press("Escape");
  await expect(doc.getByRole("button", { name: "Edit reviewer: empty" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Lin");
  await page.keyboard.press("Enter");
  await readyReader(page, "Board");
  await expect(doc.getByRole("button", { name: "Edit reviewer: Lin" })).toBeVisible();

  // Chips: a click moves to the next option.
  await doc.getByRole("button", { name: /^status: draft/ }).click();
  await readyReader(page, "Board");
  await expect(doc.getByRole("button", { name: /^status: review/ })).toBeVisible();

  // The edited source reaches the editing workspace byte for byte.
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await expect(page.locator("#editor-input")).toHaveValue(DOC
    .replace("status: draft", "status: review")
    .replace("- [ ] To do", "- [x] To do")
    .replace("- [x] Done", "- [!] Done")
    .replace("- ( ) Small", "- (x) Small").replace("- (x) Large", "- ( ) Large")
    .replace("reviewer::", "reviewer:: Lin"));
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
