import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

async function select(page: Page, start: number, end: number, direction: "forward" | "backward" = "forward") {
  const input = page.locator("#editor-input");
  await input.focus();
  await input.evaluate((node: HTMLTextAreaElement, range) => node.setSelectionRange(range.start, range.end, range.direction),
    { start, end, direction });
}

test.describe("Markdown writing commands", () => {
  for (const [name, expected] of [
    ["Bold", "**word**"], ["Italic", "*word*"], ["Inline code", "`word`"],
    ["Code block", "```\nword\n```"], ["Heading 1", "# word"], ["Heading 2", "## word"],
    ["Heading 3", "### word"], ["Link", "[word](url)"], ["Bulleted list", "- word"],
    ["Numbered list", "1. word"], ["Task list", "- [ ] word"],
  ]) {
    test(`${name} is one native Undo entry`, async ({ page }) => {
      await page.goto("/");
      await loadMarkdownIntoApp(page, "word", "commands.md");
      const input = page.locator("#editor-input");
      await expect(input).toHaveValue("word");
      await select(page, 0, 4, "backward");
      await page.getByRole("button", { name: "Format Markdown", exact: true }).click();
      await page.getByRole("button", { name, exact: true }).click();
      await expect(input).toHaveValue(expected ?? "");
      await expect(input).toBeFocused();
      await input.press("ControlOrMeta+z");
      await expect(input).toHaveValue("word");
    });
  }

  test("consecutive commands retain separate native Undo entries and Unicode selection", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "left 🧑🏽‍💻 café right", "unicode.md");
    const input = page.locator("#editor-input");
    await expect(input).toHaveValue("left 🧑🏽‍💻 café right");
    await select(page, 5, 17, "backward");
    await input.press("ControlOrMeta+b");
    await expect(input).toHaveValue("left **🧑🏽‍💻 café** right");
    await expect.poll(() => input.evaluate((node: HTMLTextAreaElement) =>
      [node.selectionStart, node.selectionEnd, node.selectionDirection])).toEqual([7, 19, "backward"]);
    await input.press("ControlOrMeta+i");
    await expect(input).toHaveValue("left ***🧑🏽‍💻 café*** right");
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("left **🧑🏽‍💻 café** right");
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("left 🧑🏽‍💻 café right");
  });

  test("first-command adoption preserves native undo and selected placeholder", async ({ page }) => {
    await page.goto("/");
    const input = page.locator("#editor-input");
    await input.focus();
    await input.press("ControlOrMeta+b");
    await expect(input).toHaveValue("**text**");
    await expect.poll(() => input.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd)))
      .toBe("text");
    await page.keyboard.insertText("new");
    await expect(input).toHaveValue("**new**");
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("**text**");
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("");
  });

  test("a multiline list toggle is reversible in one native operation", async ({ page }) => {
    await page.goto("/");
    const source = "  first\n\n  second\nafter";
    await loadMarkdownIntoApp(page, source);
    const input = page.locator("#editor-input");
    await expect(input).toHaveValue(source);
    await select(page, 2, 17, "backward");
    await page.getByRole("button", { name: "Format Markdown", exact: true }).click();
    await page.getByRole("button", { name: "Task list", exact: true }).click();
    await expect(input).toHaveValue("  - [ ] first\n\n  - [ ] second\nafter");
    await page.getByRole("button", { name: "Task list", exact: true }).click();
    await expect(input).toHaveValue(source);
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("  - [ ] first\n\n  - [ ] second\nafter");
  });

  test("formatting cannot carry native Undo across an equal-content document switch", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "word", "a.md");
    const input = page.locator("#editor-input");
    await expect(input).toHaveValue("word");
    await select(page, 0, 4);
    await input.press("ControlOrMeta+b");
    await expect(input).toHaveValue("**word**");
    await loadMarkdownIntoApp(page, "**word**", "b.md");
    await expect(page.locator(".doc-switcher option")).toHaveCount(2);
    await page.locator(".doc-switcher").selectOption({ label: "b.md" });
    await expect(page.locator(".editor-name")).toHaveText("b.md");
    await input.focus();
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("**word**");
    await select(page, 2, 6);
    await input.press("ControlOrMeta+i");
    await expect(input).toHaveValue("***word***");
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("**word**");
    await page.locator(".doc-switcher").selectOption({ label: "a.md" });
    await expect(input).toHaveValue("**word**");
  });

  test("keyboard disclosure, narrow and short controls, preview fidelity, and print exclusion", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 540 });
    await page.goto("/");
    await loadMarkdownIntoApp(page, "# Writing\n\n**Bold** and `code`.\n\n- [ ] Task", "fidelity.md");
    await waitForPagination(page);
    const before = await page.locator("#paged-output").innerHTML();
    const toggle = page.getByRole("button", { name: "Format Markdown", exact: true });
    await toggle.focus();
    await toggle.press("Enter");
    await expect(page.getByRole("button", { name: "Bold", exact: true })).toBeFocused();
    const pane = await page.locator("#editor-pane").boundingBox();
    expect(pane).not.toBeNull();
    for (const button of await page.locator("#editor-formatting button").all()) {
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(30);
      expect(box!.height).toBeGreaterThanOrEqual(30);
      expect(box!.x).toBeGreaterThanOrEqual(pane!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(pane!.x + pane!.width + 1);
    }
    expect((await page.locator("#editor-input").boundingBox())!.height).toBeGreaterThan(40);
    expect(await page.locator("#paged-output").innerHTML()).toBe(before);
    await page.screenshot({ path: test.info().outputPath("formatting-narrow-short.png") });
    await page.getByRole("button", { name: "Close formatting", exact: true }).press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#editor-input")).toBeFocused();
    await toggle.click();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#editor-formatting")).toBeHidden();
    await expect(page.locator("#editor-input")).toBeHidden();
    await expect(page.locator(".pagedjs_page").first()).toBeVisible();
  });

  test("authored panel-name headings neither park Split nor acquire command styles in print", async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 540 });
    await page.goto("/");
    await loadMarkdownIntoApp(page,
      "# Collision checks\n\n## Editor formatting\n\nFormat text.\n\n## Editor search\n\nFind text.\n\n## Ordinary heading\n\nBody.");
    await waitForPagination(page);
    const realPanel = page.locator("#workspace > #editor-pane > #editor-formatting");
    await expect(realPanel).toBeHidden();
    await expect(page.locator("#canvas")).toBeVisible();
    await expect(page.locator("#split-handle")).toBeVisible();
    const headings = page.locator("#paged-output h2");
    await expect(headings).toHaveCount(3);
    const styles = () => headings.evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return { display: style.display, overflow: style.overflowY, padding: style.padding,
        border: style.borderBottomWidth, background: style.backgroundColor };
    }));
    const screen = await styles();
    expect(screen[0]).toEqual(screen[2]);
    expect(screen[1]).toEqual(screen[2]);
    await page.getByRole("button", { name: "Format Markdown", exact: true }).click();
    await expect(realPanel).toBeVisible();
    await expect(page.locator("#canvas")).toBeHidden();
    await page.getByRole("button", { name: "Close formatting", exact: true }).click();
    await expect(page.locator("#canvas")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    for (const heading of await headings.all()) await expect(heading).toBeVisible();
    const print = await styles();
    expect(print[0]).toEqual(print[2]);
    expect(print[1]).toEqual(print[2]);
    await expect(realPanel).toBeHidden();
  });
});
