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

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;

declare global { interface Window { __copied: string[] } }

// Record what the app writes. The OS clipboard is machine-wide state on a Windows host
// (other checkouts run tests here too), so it is not a reliable assertion channel.
test.beforeEach(async ({ page }) => {
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = async text => { window.__copied.push(text); };
  });
});

const clipboard = (page: import("@playwright/test").Page): Promise<string> => page.evaluate(() => window.__copied.at(-1) ?? "");

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
    const heading = document.createTreeWalker(document.querySelector("#reader-document h3")!, NodeFilter.SHOW_TEXT).nextNode()!;
    range.setEnd(heading, 2);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.keyboard.press("Control+Shift+C");
  expect(await clipboard(page)).toBe(DOC.slice(DOC.indexOf("Intro"), DOC.indexOf("### Deeper") + "### Deeper".length));
  await expect(page.locator(".reader-toast")).toHaveText("Copied 12 lines of Markdown");

  // A rendered diagram keeps its source mapping and copies its fence body.
  const diagram = doc.locator(".reader-code", { has: page.locator("figure svg") });
  await expect(diagram).toHaveAttribute("data-src", /^\d+-\d+$/);
  await diagram.hover();
  await diagram.getByRole("button", { name: "Copy code" }).click();
  expect(await clipboard(page)).toBe(["flowchart LR", "  A --> B"].join("\n"));
});
