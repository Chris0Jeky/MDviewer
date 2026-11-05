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
    await input.evaluate((node: HTMLTextAreaElement) => {
      const events: unknown[] = [];
      Object.defineProperty(node, "formattingInputs", { value: events });
      node.addEventListener("input", (event) => events.push({
        trusted: event.isTrusted, type: (event as InputEvent).inputType,
        start: node.selectionStart, end: node.selectionEnd, length: node.value.length,
      }));
    });
    await page.getByRole("button", { name: "Format Markdown", exact: true }).click();
    await page.getByRole("button", { name: "Task list", exact: true }).click();
    await expect(input).toHaveValue("  - [ ] first\n\n  - [ ] second\nafter");
    const native = await input.evaluate((node: HTMLTextAreaElement & { formattingInputs?: unknown[] }) => ({
      selection: [node.selectionStart, node.selectionEnd, node.selectionDirection], events: node.formattingInputs,
    }));
    expect(native.selection, `Native multiline input sequence: ${JSON.stringify(native.events)}`).toEqual([0, 29, "backward"]);
    await page.getByRole("button", { name: "Task list", exact: true }).click();
    await expect(input).toHaveValue(source);
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("  - [ ] first\n\n  - [ ] second\nafter");
  });

  test("balanced link destinations and complete multiple code spans preserve text and native Undo", async ({ page }) => {
    await page.goto("/");
    const link = "before [label](https://example.com/a_(b)) after";
    await loadMarkdownIntoApp(page, link, "link.md");
    const input = page.locator("#editor-input");
    await expect(input).toHaveValue(link);
    for (const [start, end] of [[8, 13], [7, link.length - 6]]) {
      await select(page, start!, end!, "backward");
      await input.press("ControlOrMeta+k");
      await expect(input).toHaveValue("before label after");
      await input.press("ControlOrMeta+z");
      await expect(input).toHaveValue(link);
    }
    const code = "`one` and `two`";
    await loadMarkdownIntoApp(page, code, "code.md");
    await expect(input).toHaveValue(code);
    await select(page, 0, code.length);
    await page.getByRole("button", { name: "Format Markdown", exact: true }).click();
    await page.getByRole("button", { name: "Inline code", exact: true }).click();
    await expect(input).toHaveValue("`` `one` and `two` ``");
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue(code);
    await select(page, 1, code.length - 1, "backward");
    await page.getByRole("button", { name: "Inline code", exact: true }).click();
    await expect(input).toHaveValue(code);
    await expect(page.locator(".editor-format-status")).toContainText("cannot be formatted safely");
  });

  test("ambiguous emphasis and link shortcuts preserve their source and explain the refusal", async ({ page }) => {
    await page.goto("/");
    for (const [key, source, start, end] of [
      ["i", "\\*word*", 2, 6], ["b", "**one** and **two**", 0, 19],
      ["k", "[label](url \"title\")", 1, 6],
    ] as const) {
      await loadMarkdownIntoApp(page, source, `${key}.md`);
      const input = page.locator("#editor-input");
      await expect(input).toHaveValue(source);
      await select(page, start, end, "backward");
      await input.press(`ControlOrMeta+${key}`);
      await expect(input).toHaveValue(source);
      await expect(input).toBeFocused();
      await expect(page.locator(".editor-format-status")).toContainText("cannot be formatted safely");
      expect(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd, node.selectionDirection]))
        .toEqual([start, end, "backward"]);
    }
  });

  for (const [name, key, marker, opposite] of [
    ["Bold", "b", "**", "*"], ["Italic", "i", "*", "**"],
  ] as const) {
    test(name + " boundary refusals preserve native Undo and valid nested formatting", async ({ page }) => {
      await page.goto("/");
      await loadMarkdownIntoApp(page, "foobar");
      const input = page.locator("#editor-input");
      await expect(input).toHaveValue("foobar");
      await select(page, 3, 3);
      await page.keyboard.insertText("-");
      await expect(input).toHaveValue("foo-bar");
      await select(page, 3, 4, "backward");
      await input.press("ControlOrMeta+" + key);
      await expect(input).toHaveValue("foo-bar");
      await expect(input).toBeFocused();
      expect(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd, node.selectionDirection]))
        .toEqual([3, 4, "backward"]);
      await expect(page.locator(".editor-format-status")).toContainText("cannot be formatted safely");
      await input.press("ControlOrMeta+z");
      await expect(input).toHaveValue("foobar");

      for (const [source, start, end] of [
        [opposite + "ab", 0, opposite.length + 2],
        [`foo${marker}-${marker}bar`, 3, 4 + marker.length * 2],
      ] as const) {
        await loadMarkdownIntoApp(page, source, "literal.md");
        await expect(input).toHaveValue(source);
        await select(page, start, end, "backward");
        await input.press("ControlOrMeta+" + key);
        await expect(input).toHaveValue(source);
        await expect(input).toBeFocused();
        expect(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd, node.selectionDirection]))
          .toEqual([start, end, "backward"]);
        await expect(page.locator(".editor-format-status")).toContainText("cannot be formatted safely");
      }

      const nested = `${opposite}word${opposite}`;
      await loadMarkdownIntoApp(page, nested, "nested.md");
      await expect(input).toHaveValue(nested);
      await select(page, 0, nested.length, "backward");
      await input.press("ControlOrMeta+" + key);
      await expect(input).toHaveValue("***word***");
      await expect(page.locator("#paged-output .doc strong")).toHaveText("word");
      await expect(page.locator("#paged-output .doc em")).toHaveText("word");
      await input.press("ControlOrMeta+z");
      await expect(input).toHaveValue(nested);
    });
  }

  test("Link refuses an image opener without an Undo entry and accepts escaped exclamation", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, "word");
    const input = page.locator("#editor-input");
    await expect(input).toHaveValue("word");
    await select(page, 0, 0);
    await page.keyboard.insertText("!");
    await expect(input).toHaveValue("!word");
    for (const [start, end, direction] of [[1, 5, "backward"], [1, 1, "forward"]] as const) {
      await select(page, start, end, direction);
      await input.press("ControlOrMeta+k");
      await expect(input).toHaveValue("!word");
      await expect(input).toBeFocused();
      expect(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd, node.selectionDirection]))
        .toEqual([start, end, direction]);
      await expect(page.locator(".editor-format-status")).toContainText("cannot be formatted safely");
    }
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("word");

    await loadMarkdownIntoApp(page, "\\!word", "escaped.md");
    await expect(input).toHaveValue("\\!word");
    await select(page, 2, 6);
    await input.press("ControlOrMeta+k");
    await expect(input).toHaveValue("\\![word](url)");
    await expect(page.locator("#paged-output .doc a")).toHaveText("word");
    await expect(page.locator("#paged-output .doc img")).toHaveCount(0);
    await input.press("ControlOrMeta+z");
    await expect(input).toHaveValue("\\!word");
  });

  for (const [name, key, text, tag] of [
    ["Bold", "b", "**word\\\\**", "strong"],
    ["Italic", "i", "*word\\\\*", "em"],
    ["Link", "k", "[word\\\\](url)", "a"],
  ] as const) {
    test(name + " refuses an escaped closer without an Undo entry and accepts even backslashes", async ({ page }) => {
      await page.goto("/");
      await loadMarkdownIntoApp(page, "word");
      const input = page.locator("#editor-input");
      await expect(input).toHaveValue("word");
      await select(page, 4, 4);
      await page.keyboard.insertText("\\");
      await expect(input).toHaveValue("word\\");
      const selections: Array<readonly [number, number, "forward" | "backward"]> = key === "k"
        ? [[0, 5, "backward"]] : [[5, 5, "forward"], [0, 5, "backward"]];
      for (const [start, end, direction] of selections) {
        await select(page, start, end, direction);
        await input.press("ControlOrMeta+" + key);
        await expect(input).toHaveValue("word\\");
        await expect(input).toBeFocused();
        expect(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd, node.selectionDirection]))
          .toEqual([start, end, direction]);
        await expect(page.locator(".editor-format-status")).toContainText("cannot be formatted safely");
        await expect(page.getByRole("group", { name: "Markdown formatting", exact: true })).toBeVisible();
      }
      await input.press("ControlOrMeta+z");
      await expect(input).toHaveValue("word");

      await loadMarkdownIntoApp(page, "word\\\\", "even.md");
      await expect(input).toHaveValue("word\\\\");
      await select(page, 0, 6, "backward");
      await input.press("ControlOrMeta+" + key);
      await expect(input).toHaveValue(text);
      await expect(page.locator("#paged-output .doc " + tag)).toHaveText("word\\");
      await input.press("ControlOrMeta+z");
      await expect(input).toHaveValue("word\\\\");
      if (key !== "k") {
        const marker = key === "b" ? "**" : "*";
        await select(page, 6, 6);
        await input.press("ControlOrMeta+" + key);
        await expect(input).toHaveValue(`word\\\\${marker}text${marker}`);
        expect(await input.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd))).toBe("text");
        await expect(page.locator("#paged-output .doc " + tag)).toHaveText("text");
        await input.press("ControlOrMeta+z");
        await expect(input).toHaveValue("word\\\\");
      }
    });
  }

  test("Find and Format together retain usable source space in a short window", async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 420 });
    await page.goto("/");
    await loadMarkdownIntoApp(page, "# Both panels\n\nSource remains available.");
    await waitForPagination(page);
    await page.getByRole("button", { name: "Format Markdown", exact: true }).click();
    const input = page.locator("#editor-input");
    await input.focus();
    await input.press("ControlOrMeta+f");
    await expect(page.getByRole("searchbox", { name: "Find in Markdown" })).toBeFocused();
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(60);
    for (const button of await page.locator("#editor-formatting button").all()) {
      await button.scrollIntoViewIfNeeded();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(30);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(560);
    await page.screenshot({ path: test.info().outputPath("format-and-find-short.png") });
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
