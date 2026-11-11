import { test, expect, openFiles, readyReader } from "./helpers";

const DOC = `# Copy notes

Intro paragraph.

## Second

\`\`\`typescript
const kept = 1; // [!code ++]
  indented();
\`\`\`

Second text.

### Deeper

Deep text.

## Third

Third text.
`;

test.beforeEach(async ({ context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL!).origin });
});

const clipboard = (page: import("@playwright/test").Page): Promise<string> => page.evaluate(() => navigator.clipboard.readText());

test("reader copies code bodies, sections, links and selected Markdown source", async ({ page }) => {
  await openFiles(page, [{ name: "copy.md", text: DOC }]);
  await readyReader(page, "Copy notes");
  const doc = page.locator("#reader-document");

  // The notation comment is hidden in the rendered code; the copy keeps the source exactly.
  const code = doc.locator(".reader-code").first();
  await expect(code.locator("pre.shiki")).not.toContainText("[!code");
  const copyCode = code.getByRole("button", { name: "Copy code" });
  await expect(copyCode).toHaveCSS("opacity", "0");
  await code.hover();
  await expect(copyCode).toHaveCSS("opacity", "1");
  await copyCode.click();
  expect(await clipboard(page)).toBe("const kept = 1; // [!code ++]\n  indented();");
  await expect(page.locator(".reader-toast")).toHaveText("Copied 2 lines of code");

  const second = doc.locator("h2", { hasText: "Second" });
  await expect(second).toHaveText("Second");
  await expect(page.getByRole("navigation", { name: "Document headings" }).getByRole("link", { name: "Second", exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Copy section as Markdown" }).click();
  expect(await clipboard(page)).toBe(DOC.slice(DOC.indexOf("## Second"), DOC.indexOf("\n\n## Third")));
  await second.getByRole("button", { name: "Copy link to section" }).click();
  expect(await clipboard(page)).toBe("copy.md#second");

  // Keyboard users reach the buttons in order and see them on focus.
  await second.getByRole("button", { name: "Copy link to section" }).focus();
  await page.keyboard.press("Tab");
  await expect(second.getByRole("button", { name: "Copy section as Markdown" })).toBeFocused();
  await expect(second.getByRole("button", { name: "Copy section as Markdown" })).toHaveCSS("opacity", "1");

  await page.evaluate(() => {
    const paragraphs = document.querySelectorAll("#reader-document > p");
    const range = document.createRange();
    range.setStart(paragraphs[0]!.firstChild!, 3);
    range.setEnd(document.querySelector("#reader-document h3")!.firstChild!.firstChild!, 2);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.keyboard.press("Control+Shift+C");
  expect(await clipboard(page)).toBe(DOC.slice(DOC.indexOf("Intro"), DOC.indexOf("### Deeper") + "### Deeper".length));
  await expect(page.locator(".reader-toast")).toHaveText("Copied 13 lines of Markdown");
});
