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

/** An 8 KB run-card fence: tabs, Unicode, markup characters, backticks, a 400-character line. */
function runCard(): { doc: string; body: string } {
  const lines = [
    "You are a careful reviewer. Follow every step & report <findings> as `code`.",
    "\tIndented with a tab; trailing spaces stay   ",
    "Ünïcödé — “quotes”, emoji 🧭, CJK 漢字, RTL שלום",
    "``` inner backticks are content, not a fence",
    "x".repeat(400),
  ];
  const body: string[] = [];
  for (let index = 0; body.join("\n").length < 8_192; index++) body.push(`${index}: ${lines[index % lines.length]}`);
  const text = body.join("\n");
  return { doc: `# Run card\n\n\`\`\`\`text\n${text}\n\`\`\`\`\n\nSmall follow-up:\n\n\`\`\`\nsecond block\n\`\`\`\n`, body: text };
}

test("a long run-card fence copies byte for byte from a sticky, keyboard-reachable button and wraps", async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 800 });
  const { doc: text, body } = runCard();
  expect(new TextEncoder().encode(body).length).toBeGreaterThanOrEqual(8_192);
  await openFiles(page, [{ name: "run-card.md", text }]);
  await readyReader(page, "Run card");
  const scroll = page.locator("#reader-scroll");
  const code = page.locator("#reader-document .reader-code").first();

  // Long lines wrap: neither the page nor the code block scrolls sideways.
  expect(await scroll.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await code.locator("pre").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

  // Halfway down the block, the button is still on screen.
  await code.evaluate((el, scroller) => {
    const host = document.querySelector<HTMLElement>(scroller)!;
    host.style.scrollBehavior = "auto";
    host.scrollTop += el.getBoundingClientRect().top - host.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
  }, "#reader-scroll");
  const button = code.getByRole("button", { name: "Copy code" });
  await code.hover({ position: { x: 40, y: 40 } });
  const [box, view] = [await button.boundingBox(), await scroll.boundingBox()];
  expect(box!.y).toBeGreaterThanOrEqual(view!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(view!.y + view!.height);

  // Keyboard: focus reveals it, Enter copies, and the button itself says Copied.
  await button.focus();
  await expect(button).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  expect(await clipboard(page)).toBe(body);
  expect(await clipboard(page)).toBe(text.split("\n").slice(3, 3 + body.split("\n").length).join("\n"));
  await expect(button.getByText("Copied")).toBeVisible();
  await expect(page.locator(".reader-toast")).toHaveText(`Copied ${body.split("\n").length} lines of code`);
});
