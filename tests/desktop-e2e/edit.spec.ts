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

test.describe("notepad behaviours in Edit", () => {
  test("Find includes Replace, and both change only the source", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await expect(edit(page)).toBeFocused();
    await page.keyboard.insertText("# Plan\n\nOld word, old word.\n");
    await page.keyboard.press("Control+h");
    await page.getByRole("searchbox", { name: "Find in Markdown" }).fill("old word");
    await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("new word");
    await page.getByRole("button", { name: "Replace all", exact: true }).click();
    await expect(edit(page)).toHaveValue("# Plan\n\nnew word, new word.\n");
    await expect(page.locator("#reader-document p")).toHaveText("new word, new word.");
  });

  test("closing a tab or the window with unsaved text asks first", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await expect(edit(page)).toBeFocused();
    await page.keyboard.insertText("Keep me");
    await expect(documentTabs(page)).toHaveText(["Untitled.md, unsaved changes"]);
    const asked: string[] = [];
    page.once("dialog", dialog => { asked.push(dialog.message()); void dialog.dismiss(); });
    await page.keyboard.press("Control+w");
    await expect.poll(() => asked).toEqual(["Discard unsaved edits to Untitled.md?"]);
    await expect(documentTabs(page)).toHaveText(["Untitled.md, unsaved changes"]);
    await expect(edit(page)).toHaveValue("Keep me");
    // The window: the page refuses to unload while text is unsaved.
    const unload = new Promise<string>(resolve => page.once("dialog", dialog => { resolve(dialog.type()); void dialog.dismiss(); }));
    await page.close({ runBeforeUnload: true });
    expect(await unload).toBe("beforeunload");
  });

  test("the divider drags, by pointer and keyboard, and keeps the ratio", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 700 });
    await openFiles(page, [{ name: "notes.md", text: NOTES }]);
    await readyReader(page, "Notes");
    await page.keyboard.press("Control+e");
    const divider = page.getByRole("separator", { name: "Resize the source and preview panes" });
    await expect(divider).toBeVisible();
    const before = (await page.locator("#reader-edit").boundingBox())!.width;
    const grip = (await divider.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 200, grip.y + grip.height / 2, { steps: 5 });
    await page.mouse.up();
    const dragged = (await page.locator("#reader-edit").boundingBox())!.width;
    expect(dragged).toBeGreaterThan(before + 150);
    await divider.focus();
    await page.keyboard.press("ArrowLeft");
    expect((await page.locator("#reader-edit").boundingBox())!.width).toBeLessThan(dragged);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mdviewer.settings.v1")!).splitRatio)).toBeGreaterThan(0.5);
    await page.keyboard.press("Control+e");
    await expect(divider).toBeHidden();
  });

  test("a checkbox clicked in the preview while editing changes the source in memory", async ({ page }) => {
    await openFiles(page, [{ name: "tasks.md", text: "# Tasks\n\n- [ ] Write the plan\n" }]);
    await readyReader(page, "Tasks");
    await page.keyboard.press("Control+e");
    await expect(edit(page)).toBeFocused();
    await page.locator("#reader-document").getByRole("checkbox", { name: /Write the plan/ }).click();
    await expect(edit(page)).toHaveValue("# Tasks\n\n- [x] Write the plan\n");
    await expect(documentTabs(page)).toHaveText(["tasks.md, unsaved changes"]);
  });

  test("the reader follows the caret when it moves by click or keyboard", async ({ page }) => {
    const long = ["# Top", "", ...Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.\n`), "## Bottom", ""].join("\n");
    await openFiles(page, [{ name: "long.md", text: long }]);
    await readyReader(page, "Top");
    await page.keyboard.press("Control+e");
    await expect(edit(page)).toBeFocused();
    await expect(page.locator("#reader-document h2")).not.toBeInViewport();
    await page.keyboard.press("Control+End");
    await expect(page.locator("#reader-document h2")).toBeInViewport();
    await page.keyboard.press("Control+Home");
    await expect(page.locator("#reader-document h1")).toBeInViewport();
  });
});

test("Ctrl+S on an untitled note in the Windows app opens Save As and binds the file", async ({ page }) => {
  // A faked host (in-page, no IPC): Save As answers as the native dialog would.
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, {
      __saveCalls: calls,
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        transformCallback: () => 1,
        convertFileSrc: (path: string) => path,
        invoke: async (cmd: string) => {
          calls.push(cmd);
          if (cmd === "take_pending_files" || cmd === "session_restore") return { documents: [], errors: [], canceled: false };
          if (cmd === "library_list") return { recent: [], pinned: [], projects: [] };
          if (cmd === "save_document_as") {
            return { outcome: "saved", token: "s".repeat(32), generation: 1, name: "plan.md", path: "C:/notes/plan.md", dir: "C:/notes", encoding: "utf-8", eol: "lf" };
          }
          return null;
        },
      },
    });
  });
  await page.goto("/desktop.html");
  await page.keyboard.press("Control+n");
  await expect(edit(page)).toBeFocused();
  await page.keyboard.insertText("# Plan\n");
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saveCalls: string[] }).__saveCalls.filter(cmd => cmd.startsWith("save_document")))).toEqual(["save_document_as"]);
  await expect(documentTabs(page)).toHaveText(["plan.md"]);
  await expect(page.locator("#reader-status")).toContainText("C:/notes/plan.md");
});
