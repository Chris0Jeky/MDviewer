import { test, expect, documentTabs, openFiles, readyReader, selectDocument } from "./helpers";

/** Edit (S5): the source editor beside the live reader, patched block by block as you type. */
const NOTES = ["# Notes", "", "First paragraph.", "", "```ts", "const kept = 1;", "```", "", "Last paragraph.", ""].join("\n");
const edit = (page: import("@playwright/test").Page) => page.locator("#reader-edit #editor-input");

test("Ctrl+E edits the open document beside the reader and typing patches only changed blocks", async ({ page, audit }) => {
  await openFiles(page, [{ name: "notes.md", text: NOTES }, { name: "other.md", text: "# Other\n\nSecond file.\n" }]);
  await readyReader(page, "Notes");
  const doc = page.locator("#reader-document");
  const code = await doc.locator(".reader-code").elementHandle();
  await page.keyboard.press("Control+e");
  await expect(edit(page)).toBeFocused();
  await expect(edit(page)).toHaveValue(NOTES);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Type into the first paragraph: the paragraph changes, the highlighted code block is the same node.
  await edit(page).evaluate(input => { (input as HTMLTextAreaElement).setSelectionRange(25, 25); });
  await page.keyboard.type(" Typed here");
  await expect(doc.locator("p").first()).toHaveText("First paragraph. Typed here");
  expect(await doc.locator(".reader-code").evaluate((node, old) => node === old, code)).toBe(true);
  await expect(documentTabs(page)).toHaveText(["notes.md, unsaved changes", "other.md"]);

  // Switching documents shows the other source; switching back keeps the edit.
  await selectDocument(page, "other.md");
  await readyReader(page, "Other");
  await expect(edit(page)).toHaveValue("# Other\n\nSecond file.\n");
  await selectDocument(page, "notes.md, unsaved changes");
  await readyReader(page, "Notes");
  await expect(edit(page)).toHaveValue(NOTES.replace("First paragraph.", "First paragraph. Typed here"));

  // Ctrl+E hides Edit and returns to reading; nothing paginated was loaded.
  await edit(page).focus();
  await page.keyboard.press("Control+e");
  await expect(page.locator("#reader-edit")).toBeHidden();
  await expect(doc).toBeFocused();
  expect(audit.requests.filter(url => /pagedjs|\/assets\/(?:workspace|App)[^/]*\.js$/i.test(url))).toEqual([]);
});

test("undo history survives hiding and showing Edit", async ({ page }) => {
  await openFiles(page, [{ name: "notes.md", text: NOTES }]);
  await readyReader(page, "Notes");
  await page.keyboard.press("Control+e");
  await expect(edit(page)).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nAdded.");
  await expect(page.locator("#reader-document p").last()).toHaveText("Added.");
  await page.keyboard.press("Control+e");
  await expect(page.locator("#reader-edit")).toBeHidden();
  await page.keyboard.press("Control+e");
  await expect(edit(page)).toBeFocused();
  // Native undo still holds the typing (the browser decides how much one step removes).
  const typed = `${NOTES}\nAdded.`;
  await page.keyboard.press("Control+z");
  await expect.poll(() => edit(page).inputValue()).not.toBe(typed);
  expect(typed.startsWith(await edit(page).inputValue())).toBe(true);
  for (let step = 0; step < 8 && (await edit(page).inputValue()) !== NOTES; step++) await page.keyboard.press("Control+z");
  await expect(edit(page)).toHaveValue(NOTES);
  await expect(page.locator("#reader-document p").last()).toHaveText("Last paragraph.");
});

test("Find and Format work in Edit, and their shortcuts belong to the source", async ({ page }) => {
  await openFiles(page, [{ name: "notes.md", text: NOTES }]);
  await readyReader(page, "Notes");
  await page.keyboard.press("Control+e");
  await expect(edit(page)).toBeFocused();
  await page.keyboard.press("Control+f");
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await expect(query).toBeFocused();
  await page.keyboard.insertText("paragraph");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 2 matches");
  await query.press("Escape");
  await expect(edit(page)).toBeFocused();
  // Ctrl+B bolds the selection here (it toggles the panel only outside the source).
  await edit(page).evaluate(input => { (input as HTMLTextAreaElement).setSelectionRange(9, 14); });
  await page.keyboard.press("Control+b");
  await expect(edit(page)).toHaveValue(NOTES.replace("First paragraph.", "**First** paragraph."));
  await expect(page.locator("#shell-panel")).toBeHidden();
  await expect(page.locator("#reader-document strong")).toHaveText("First");
});

test("patched diagrams keep distinct SVG ids", async ({ page }) => {
  const source = ["# Diagrams", "", "```mermaid", "flowchart LR", "  A --> B", "```", "", "Between.", "", "```mermaid", "flowchart LR", "  C --> D", "```", ""].join("\n");
  await openFiles(page, [{ name: "diagrams.md", text: source }]);
  await readyReader(page, "Diagrams");
  const doc = page.locator("#reader-document");
  await expect(doc.locator("figure svg")).toHaveCount(2);
  const first = await doc.locator("figure").first().elementHandle();
  await page.keyboard.press("Control+e");
  await expect(edit(page)).toBeFocused();
  // Change the second diagram: the first figure is kept, the second re-rendered.
  await edit(page).evaluate(input => {
    const area = input as HTMLTextAreaElement;
    const at = area.value.indexOf("C --> D");
    area.setSelectionRange(at, at + "C --> D".length);
  });
  await page.keyboard.insertText("C --> E");
  await expect(doc.locator("figure").nth(1)).toContainText("E");
  expect(await doc.locator("figure").first().evaluate((node, old) => node === old, first)).toBe(true);
  const ids = await doc.locator("figure svg").evaluateAll(svgs => svgs.map(svg => svg.id));
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
});
