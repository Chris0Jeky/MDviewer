import { expect, test } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

test("Find keyboard navigation retains query focus and replacements keep native undo/redo", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, "cat CAT cat", "search.md");
  await waitForPagination(page);
  const input = page.locator("#editor-input");
  await input.focus();
  await input.press("ControlOrMeta+End");
  await page.keyboard.insertText("!");
  await input.press("ControlOrMeta+f");
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await query.fill("cat");
  const status = page.locator(".editor-search-status");
  await expect(status).toHaveText("1 of 3 matches");
  await query.press("Enter");
  await expect(query).toBeFocused();
  await expect(status).toHaveText("2 of 3 matches");
  await query.press("Shift+Enter");
  await expect(status).toHaveText("1 of 3 matches");
  await page.getByRole("button", { name: "Show replace", exact: true }).click();
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("dog");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(input).toHaveValue("dog dog dog!");
  await input.focus();
  await input.press("ControlOrMeta+z");
  await expect(input).toHaveValue("cat CAT cat!");
  await input.press("ControlOrMeta+Shift+z");
  await expect(input).toHaveValue("dog dog dog!");
  await input.press("ControlOrMeta+z");
  await expect(input).toHaveValue("cat CAT cat!");
  await input.press("ControlOrMeta+z");
  await expect(input).toHaveValue("cat CAT cat");
});

test("Find reveals a deep source match and keeps the painted text aligned", async ({ page }) => {
  await page.goto("/");
  const source = "# Search notes\n\n```text\n" + "A source line with enough words to wrap in a narrow editor.\n".repeat(180) + "last-needle\n```\n";
  await loadMarkdownIntoApp(page, source);
  await waitForPagination(page);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find in Markdown" }).fill("last-needle");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  const geometry = await page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>("#editor-input")!;
    const backdrop = document.querySelector<HTMLElement>("#editor-highlight")!;
    const start = input.value.indexOf("last-needle");
    const walker = document.createTreeWalker(backdrop, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let match: DOMRect | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (start < consumed + length) {
        const range = document.createRange();
        range.setStart(node, start - consumed);
        range.setEnd(node, start - consumed + 1);
        match = range.getBoundingClientRect();
        break;
      }
      consumed += length;
    }
    if (!match) throw new Error("Matched source character was not painted");
    const a = input.getBoundingClientRect();
    const b = backdrop.getBoundingClientRect();
    return { top: a.top, bottom: a.bottom, matchTop: match.top, matchBottom: match.bottom,
      inputBox: [a.x, a.y, a.width, a.height], backdropBox: [b.x, b.y, b.width, b.height],
      inputScroll: input.scrollTop, backdropScroll: backdrop.scrollTop,
      selected: input.value.slice(input.selectionStart, input.selectionEnd) };
  });
  expect(geometry.selected).toBe("last-needle");
  expect(geometry.inputScroll).toBeGreaterThan(0);
  expect(geometry.matchTop).toBeGreaterThanOrEqual(geometry.top);
  expect(geometry.matchBottom).toBeLessThanOrEqual(geometry.bottom);
  expect(geometry.inputBox).toEqual(geometry.backdropBox);
  expect(geometry.inputScroll).toBe(geometry.backdropScroll);
  await page.screenshot({ path: test.info().outputPath("source-find-deep-match.png"), fullPage: true });
});

test("large plain-text source reveals its wrapped end without a second caret jump", async ({ page }) => {
  await page.goto("/");
  const source = "# Large source\n\n<!--\n" + ("A long source line with wrapped words " + "x".repeat(60) + "\n").repeat(1_500) + "large-needle\n-->";
  expect(source.length).toBeGreaterThan(120_000);
  expect(Buffer.byteLength(source)).toBeLessThan(250_000);
  await loadMarkdownIntoApp(page, source);
  await waitForPagination(page);
  await expect(page.locator("#editor-pane")).toHaveAttribute("data-highlight", "off");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await query.fill("large-needle");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  await expect(query).toBeFocused();
  const input = page.locator("#editor-input");
  const before = await input.evaluate(el => {
    const textarea = el as HTMLTextAreaElement;
    return { top: textarea.scrollTop, selected: textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
      lineHeight: parseFloat(getComputedStyle(textarea).lineHeight) };
  });
  expect(before.top).toBeGreaterThan(0);
  expect(before.selected).toBe("large-needle");
  await query.press("Escape");
  await expect(input).toBeFocused();
  await input.press("ArrowRight");
  // Chromium's own caret movement is the independent visibility control. If Find
  // left the match offscreen, this native action would jump the source scroller.
  const after = await input.evaluate(el => el.scrollTop);
  expect(Math.abs(after - before.top)).toBeLessThan(before.lineHeight * 2);
  await expect(input).toHaveValue(source);
});

test("Find stays usable at the minimum split width and on a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Narrow source\n\nfind this text");
  await waitForPagination(page);
  await page.locator("#split-handle").press("Home");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find in Markdown" }).fill("text");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  await page.getByRole("button", { name: "Show replace", exact: true }).click();
  for (const narrow of [false, true]) {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    const boxes = await page.locator("#editor-pane").evaluate(pane => {
      const box = pane.getBoundingClientRect();
      const controls = [...pane.querySelectorAll<HTMLElement>(".editor-command, .editor-search-field")]
        .filter(el => el.getClientRects().length).map(el => {
          const r = el.getBoundingClientRect();
          return { label: el.getAttribute("aria-label"), left: r.left, right: r.right, width: r.width };
        });
      return { left: box.left, right: box.right, controls,
        sourceHeight: pane.querySelector("#editor-input")!.getBoundingClientRect().height };
    });
    for (const control of boxes.controls) {
      expect(control.left, `${control.label} left edge`).toBeGreaterThanOrEqual(boxes.left - 1);
      expect(control.right, `${control.label} right edge`).toBeLessThanOrEqual(boxes.right + 1);
      expect(control.width, `${control.label} usable width`).toBeGreaterThanOrEqual(control.label === "Find in Markdown" || control.label === "Replace with" ? 100 : 26);
    }
    expect(boxes.sourceHeight).toBeGreaterThan(20);
    await page.screenshot({ path: test.info().outputPath(narrow ? "source-find-mobile.png" : "source-find-narrow-split.png"), fullPage: true });
  }
});

test("search chrome stays out of print and Preview-only keeps host Find", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Printable\n\nKeep this body.");
  await waitForPagination(page);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find in Markdown" }).fill("body");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#editor-search")).toBeHidden();
  await expect(page.locator("#editor-input")).toBeHidden();
  await expect(page.locator("#paged-output .pagedjs_page").first()).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const consumed = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(consumed).toBe(false);
  await expect(page.locator("#editor-pane")).toBeHidden();
});
