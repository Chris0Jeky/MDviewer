import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { loadFilesIntoApp, loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

/** Independent full-range coverage against the actual painted syntax text. */
async function highlightedCoverage(page: Page) {
  return page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>("#editor-input")!;
    const backdrop = document.querySelector<HTMLElement>("#editor-highlight")!;
    const layer = document.querySelector<HTMLElement>("#editor-match-cue")!;
    const box = input.getBoundingClientRect();
    const walker = document.createTreeWalker(backdrop, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0;
    let started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (!started && input.selectionStart < offset + length) {
        range.setStart(node, input.selectionStart - offset);
        started = true;
      }
      if (started && input.selectionEnd <= offset + length) {
        range.setEnd(node, input.selectionEnd - offset);
        break;
      }
      offset += length;
    }
    const expected = Array.from(range.getClientRects(), rect => ({
      top: Math.max(box.top, rect.top), bottom: Math.min(box.top + input.clientHeight, rect.bottom),
      left: Math.max(box.left, rect.left), right: Math.min(box.left + input.clientWidth, rect.right),
    })).filter(rect => rect.right > rect.left && rect.bottom > rect.top);
    const marks = [...layer.children].map(mark => mark.getBoundingClientRect());
    const first = layer.firstElementChild;
    return {
      covered: expected.length > 0 && expected.every(rect => marks.some(mark =>
        mark.top <= rect.top + 1 && mark.bottom >= rect.bottom - 1 &&
        mark.left <= rect.left + 1 && mark.right >= rect.right - 1)),
      rows: new Set(marks.map(mark => Math.round(mark.top))).size,
      inside: marks.every(mark => mark.left >= box.left - 1 && mark.right <= box.left + input.clientWidth + 1 &&
        mark.top >= box.top - 1 && mark.bottom <= box.top + input.clientHeight + 1),
      pointerEvents: getComputedStyle(layer).pointerEvents,
      background: first ? getComputedStyle(first).backgroundColor : "transparent",
      border: first ? getComputedStyle(first).boxShadow : "none",
      source: input.value,
      selected: input.value.slice(input.selectionStart, input.selectionEnd),
    };
  });
}

async function plainGeometry(page: Page, measureMirrors = false) {
  return page.locator("#editor-input").evaluate((node, withMirrors) => {
    const textarea = node as HTMLTextAreaElement;
    const box = node.getBoundingClientRect();
    const styles = getComputedStyle(textarea);
    const lineHeight = parseFloat(styles.lineHeight);
    const marks = [...document.querySelectorAll(".editor-match-rect")].map(mark => {
      const rect = mark.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height };
    });
    // This fixture ends with the match, then exactly one short unwrapped '-->'
    // row and no trailing newline. Native textarea scrollHeight independently
    // anchors its final line box, without accumulating thousands of div rows.
    const nativeLastMatchCenter = box.top + textarea.scrollHeight - textarea.scrollTop -
      parseFloat(styles.paddingBottom) - 1.5 * lineHeight;
    const last = [...marks].sort((a, b) => a.top - b.top).at(-1);
    const mirrors: Array<{ mode: string; authored: string; lineHeight: string; height: number;
      rects: Array<{ top: number; bottom: number; left: number; right: number }> }> = [];
    if (withMirrors) {
      for (const mode of ["computed-pixels", "authored-unitless"]) {
        const mirror = document.createElement("div");
        for (const property of ["font-family", "font-size", "font-weight", "font-style", "font-stretch",
          "font-variant-ligatures", "line-height", "letter-spacing", "word-spacing", "tab-size",
          "white-space", "overflow-wrap", "word-break", "padding", "text-indent", "text-transform",
          "direction", "text-align"]) mirror.style.setProperty(property, styles.getPropertyValue(property));
        const authored = styles.getPropertyValue("--editor-line-height").trim();
        if (mode === "authored-unitless") mirror.style.lineHeight = authored;
        Object.assign(mirror.style, { position: "fixed", top: `${box.top}px`, left: `${box.left}px`,
          width: `${textarea.clientWidth}px`, boxSizing: "border-box", margin: "0", border: "0",
          visibility: "hidden", pointerEvents: "none", overflow: "hidden" });
        const marker = document.createElement("span");
        marker.textContent = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
        mirror.append(document.createTextNode(textarea.value.slice(0, textarea.selectionStart)), marker);
        document.body.append(mirror);
        try {
          mirrors.push({ mode, authored, lineHeight: getComputedStyle(mirror).lineHeight, height: mirror.scrollHeight,
            rects: [...marker.getClientRects()].map(rect => ({ top: rect.top - textarea.scrollTop,
              bottom: rect.bottom - textarea.scrollTop, left: rect.left, right: rect.right })) });
        } finally { mirror.remove(); }
      }
    }
    return { count: marks.length, rows: new Set(marks.map(mark => Math.round(mark.top))).size, marks,
      inside: marks.every(mark => mark.width > 0 && mark.height > 0 && mark.left >= box.left - 1 &&
        mark.right <= box.left + textarea.clientWidth + 1 && mark.top >= box.top - 1 &&
        mark.bottom <= box.top + textarea.clientHeight + 1), top: textarea.scrollTop,
      selected: textarea.value.slice(textarea.selectionStart, textarea.selectionEnd), lineHeight,
      clientWidth: textarea.clientWidth, clientHeight: textarea.clientHeight, scrollHeight: textarea.scrollHeight,
      paddingTop: styles.paddingTop, paddingBottom: styles.paddingBottom, font: styles.font,
      nativeLastMatchCenter, cueLastMatchCenter: last ? (last.top + last.bottom) / 2 : null, mirrors };
  }, measureMirrors);
}

test("active Find cue covers wrapped syntax text while the query keeps focus, including scroll and resize", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/");
  const phrase = "Visible **syntax match** continues across several narrow source rows with enough words to show the complete active result clearly.";
  const source = "# Cue notes\n\n" + "context\n".repeat(8) + phrase + "\n\n" + "tail\n".repeat(60);
  await loadMarkdownIntoApp(page, source);
  await waitForPagination(page);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await query.fill(phrase);
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  await expect(query).toBeFocused();
  await expect.poll(async () => (await highlightedCoverage(page)).covered).toBe(true);
  let geometry = await highlightedCoverage(page);
  expect(geometry.rows).toBeGreaterThan(1);
  expect(geometry.inside).toBe(true);
  expect(geometry.pointerEvents).toBe("none");
  expect(geometry.background).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  expect(geometry.border).not.toBe("none");
  expect(geometry.source).toBe(source);
  expect(geometry.selected).toBe(phrase);
  await page.screenshot({ path: test.info().outputPath("find-active-wrapped-cue.png"), fullPage: true });

  await page.locator("#editor-input").evaluate(input => { input.scrollTop += 42; });
  await expect.poll(async () => (await highlightedCoverage(page)).covered).toBe(true);
  await page.setViewportSize({ width: 780, height: 900 });
  await expect.poll(async () => (await highlightedCoverage(page)).covered).toBe(true);
  geometry = await highlightedCoverage(page);
  expect(geometry.rows).toBeGreaterThan(1);
  expect(geometry.inside).toBe(true);
  await expect(query).toBeFocused();
  await expect(page.locator("#editor-input")).toHaveValue(source);
  await page.screenshot({ path: test.info().outputPath("find-active-resized-cue.png"), fullPage: true });

  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#editor-match-cue")).toBeHidden();
  await expect(page.locator("#paged-output .pagedjs_page").first()).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await query.fill("there is no such match");
  await expect(page.locator(".editor-search-status")).toHaveText("No matches");
  await expect(page.locator("#editor-match-cue")).toBeHidden();
  await expect(page.locator(".editor-match-rect")).toHaveCount(0);
});

test("large plain source shows the complete wrapped active cue without moving query focus or the native caret viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.goto("/");
  const phrase = "Large visible match includes enough words to wrap across the source and remain clear while Find keeps its keyboard focus.";
  const source = "# Plain cue\n\n<!--\n" + ("padding " + "x".repeat(72) + "\n").repeat(1600) + phrase + "\n-->";
  expect(source.length).toBeGreaterThan(120_000);
  expect(Buffer.byteLength(source)).toBeLessThan(250_000);
  await loadMarkdownIntoApp(page, source);
  await waitForPagination(page);
  await expect(page.locator("#editor-pane")).toHaveAttribute("data-highlight", "off");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await query.fill(phrase);
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1 match");
  await expect(page.locator("#editor-match-cue")).toBeVisible();
  await expect(query).toBeFocused();
  const input = page.locator("#editor-input");
  const geometry = await plainGeometry(page);
  expect(geometry.count).toBeGreaterThan(1);
  expect(geometry.rows).toBeGreaterThan(1);
  expect(geometry.inside).toBe(true);
  expect(geometry.top).toBeGreaterThan(0);
  expect(geometry.selected).toBe(phrase);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const settled = await plainGeometry(page, true);
  await page.screenshot({ path: test.info().outputPath("find-active-large-plain-cue.png"), fullPage: true });
  const afterScreenshot = await plainGeometry(page);
  const evidencePath = test.info().outputPath("plain-cue-geometry.json");
  await writeFile(evidencePath, JSON.stringify({ initial: geometry, settled, afterScreenshot }, null, 2));
  await test.info().attach("plain-cue-geometry.json", { contentType: "application/json", path: evidencePath });
  expect(settled.cueLastMatchCenter).not.toBeNull();
  expect(Math.abs(settled.cueLastMatchCenter! - settled.nativeLastMatchCenter),
    "the active cue must align with the native textarea's last matched row").toBeLessThan(3);
  expect(Math.abs(afterScreenshot.cueLastMatchCenter! - afterScreenshot.nativeLastMatchCenter),
    "cue alignment must survive settled browser rendering").toBeLessThan(3);
  // Native caret movement is the independent visibility check for a textarea
  // whose source is deliberately absent from the syntax backdrop.
  await input.focus();
  await input.press("ArrowLeft");
  expect(Math.abs((await input.evaluate(node => node.scrollTop)) - geometry.top)).toBeLessThan(geometry.lineHeight * 2);
  await expect(input).toHaveValue(source);
  await expect(page.locator("#editor-match-cue")).toBeHidden();
});

test("document changes and closing Find remove the previous cue and release its input", async ({ page }) => {
  await page.goto("/");
  await loadFilesIntoApp(page, [
    { name: "first.md", content: "# First\n\nactive needle here" },
    { name: "second.md", content: "# Second\n\nDifferent prefix and active needle here" },
  ]);
  const docs = page.locator(".doc-switcher");
  await expect(docs.locator("option")).toHaveCount(2);
  await docs.selectOption({ label: "first.md" });
  await waitForPagination(page);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const query = page.getByRole("searchbox", { name: "Find in Markdown" });
  await query.fill("active needle");
  await expect(page.locator("#editor-match-cue")).toBeVisible();
  const previous = await page.locator("#editor-input").elementHandle();
  await docs.selectOption({ label: "second.md" });
  await expect(page.locator(".editor-name")).toHaveText("second.md");
  expect(await previous!.evaluate(node => node.isConnected)).toBe(false);
  await expect(page.locator("#editor-match-cue")).toBeHidden();
  await expect(page.locator(".editor-match-rect")).toHaveCount(0);
  await expect(page.locator(".editor-search-status")).toHaveText("1 match");
  await query.press("Enter");
  await expect.poll(async () => (await highlightedCoverage(page)).covered).toBe(true);
  await expect(query).toBeFocused();
  await page.getByRole("button", { name: "Close find", exact: true }).click();
  await expect(page.locator("#editor-match-cue")).toBeHidden();
  await expect(page.locator(".editor-match-rect")).toHaveCount(0);
  await expect(page.locator("#editor-input")).toBeFocused();
  await expect(page.locator("#editor-input")).toHaveValue("# Second\n\nDifferent prefix and active needle here");
});
