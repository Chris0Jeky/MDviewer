import { expect, test } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { chromeHeadingMarkdown as markdown, chromeHeadings } from "../helpers/chromeHeadings";
const workspaceSelector = "#app > #workspace";
const canvasSelector = `${workspaceSelector} > #canvas`;
const documentSelector = `${canvasSelector} > #paged-output`;

test.beforeEach(async ({ browser, browserName }, info) => {
  await info.attach("browser-runtime", { body: JSON.stringify({ engine: browserName, version: browser.version() }), contentType: "application/json" });
});

for (const forcedColors of ["none", "active"] as const) {
  test(`chrome-named headings retain document flow in Split and Preview (${forcedColors})`, async ({ page }) => {
    await page.emulateMedia({ forcedColors });
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown);
    await waitForPagination(page);

    for (const viewMode of ["split", "preview"] as const) {
      await page.getByRole("button", { name: viewMode === "split" ? "Split" : "Preview", exact: true }).click();
      await expect(page.locator(workspaceSelector)).toHaveAttribute("data-view-mode", viewMode);
      for (const { id, title } of chromeHeadings) {
        const heading = page.locator(`${documentSelector} h2[id="${id}"]`);
        await expect(heading).toHaveCount(1);
        await expect.soft(heading, `${viewMode}: ${id} must keep its authored text`).toHaveText(title, { timeout: 1_000 });
        await expect.soft(heading, `${viewMode}: ${id} must remain visible`).toBeVisible({ timeout: 1_000 });
        const paint = await heading.evaluate(element => {
          const style = getComputedStyle(element);
          return { display: style.display, position: style.position, fill: style.webkitTextFillColor,
            pointerEvents: style.pointerEvents, width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height };
        });
        expect.soft(paint.display, `${viewMode}: ${id} must use ordinary heading flow`).toBe("block");
        expect.soft(paint.position, `${viewMode}: ${id} must not become a chrome overlay`).toBe("static");
        expect.soft(paint.pointerEvents, `${viewMode}: ${id} must remain selectable`).toBe("auto");
        expect.soft(paint.width, `${viewMode}: ${id} must not become a narrow divider`).toBeGreaterThan(100);
        expect.soft(paint.height, `${viewMode}: ${id} must not become a viewport-sized shell`).toBeLessThan(100);
        expect.soft(paint.fill, `${viewMode}: ${id} must paint its text`).not.toMatch(/^(?:transparent|rgba\(0, 0, 0, 0\))$/);
      }
    }
    await page.screenshot({ path: test.info().outputPath(`chrome-headings-${forcedColors}.png`), fullPage: true });
  });
}

test("printing hides chrome while preserving headings with the same names", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, markdown);
  await waitForPagination(page);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const canvas = page.locator(canvasSelector);
  await expect(canvas).toBeHidden();
  const parked = await canvas.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(parked.width).toBeGreaterThan(0);
  expect(parked.height).toBeGreaterThan(0);

  await page.emulateMedia({ media: "print" });
  await expect(page.locator(`${workspaceSelector} > #editor-pane`)).toBeHidden();
  await expect(page.locator(`${workspaceSelector} > #split-handle`)).toBeHidden();
  await expect(canvas).toBeVisible();
  for (const { id, title } of chromeHeadings) {
    const heading = page.locator(`${documentSelector} h2[id="${id}"]`);
    await expect.soft(heading).toHaveText(title, { timeout: 1_000 });
    await expect.soft(heading, `print must retain the ${id} heading`).toBeVisible({ timeout: 1_000 });
    await expect.soft(heading).toHaveCSS("position", "static", { timeout: 1_000 });
    await expect.soft(heading).toHaveCSS("display", "block", { timeout: 1_000 });
  }
  await page.screenshot({ path: test.info().outputPath("chrome-headings-print.png"), fullPage: true });
});

test("a search-named heading cannot park a short Split preview while Find is closed", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 420 });
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Editor search\n\nThis is document content, not an open Find panel.");
  await waitForPagination(page);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const canvas = page.locator(canvasSelector);
  const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
  await expect(canvas).toBeVisible();
  await expect(page.locator(`${workspaceSelector} > #editor-pane > #editor-search`)).toBeHidden();

  await source.focus();
  await source.press("ControlOrMeta+f");
  await expect(page.getByRole("searchbox", { name: "Find in Markdown" })).toBeFocused();
  await expect(canvas).toBeHidden();
  const parked = await canvas.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(parked.width).toBeGreaterThan(0);
  expect(parked.height).toBeGreaterThan(0);
  await page.getByRole("searchbox", { name: "Find in Markdown" }).press("Escape");
  await expect(source).toBeFocused();
  await expect(canvas).toBeVisible();
  await expect(page.locator(workspaceSelector)).toHaveAttribute("data-view-mode", "split");
});
