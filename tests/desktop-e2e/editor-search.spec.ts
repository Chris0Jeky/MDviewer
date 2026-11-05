import { readFile } from "node:fs/promises";
import { test, expect, openFiles, readyReader, readyWorkspace } from "./helpers";

test("desktop source Find and Replace preserves the exact saved note and reading view", async ({ page }) => {
  const source = "# Local writing\n\nA cat and another cat.\n";
  await openFiles(page, [{ name: "writing.md", text: source }]);
  await readyReader(page, "Local writing");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, source);
  await page.locator("#editor-input").press("Control+h");
  await page.getByRole("searchbox", { name: "Find in Markdown" }).fill("cat");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 2 matches");
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("fox");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  const edited = "# Local writing\n\nA fox and another fox.\n";
  await expect(page.locator("#editor-input")).toHaveValue(edited);
  await expect(page.locator("#paged-output")).toContainText("A fox and another fox.");
  await page.screenshot({ path: test.info().outputPath("desktop-find-replace.png"), fullPage: true });
  const saving = page.waitForEvent("download");
  await page.locator("#editor-input").press("Control+s");
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("writing.md");
  expect(await readFile((await saved.path())!, "utf8")).toBe(edited);
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Local writing");
  await expect(page.locator("#reader-document")).toContainText("A fox and another fox.");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("another fox");
});

for (const width of [560, 1280]) {
  test(`Find keeps source usable in a short ${width}×420 desktop window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 420 });
    const source = "# Short window\n\nFind a cat and another cat.\n";
    await openFiles(page, [{ name: "short.md", text: source }]);
    await readyReader(page, "Short window");
    await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
    await readyWorkspace(page, source);
    await page.getByRole("button", { name: "Split", exact: true }).click();
    const originalMode = await page.locator("#workspace").getAttribute("data-view-mode");
    const originalRatio = await page.locator("#workspace").evaluate(node => node.style.getPropertyValue("--split-ratio"));
    const originalPages = await page.locator(".pagedjs_page").count();
    const originalSourceBox = await page.locator("#editor-input").boundingBox();
    const originalPage = await page.locator(".pagedjs_page").first().elementHandle();
    await page.locator("#editor-input").press("Control+h");
    await page.getByRole("searchbox", { name: "Find in Markdown" }).fill("cat");
    await expect(page.locator(".editor-search-status")).toHaveText("1 of 2 matches");
    const geometry = await page.locator("#workspace").evaluate(workspace => {
      const box = workspace.getBoundingClientRect();
      const input = workspace.querySelector<HTMLTextAreaElement>("#editor-input")!;
      const sourceBox = input.getBoundingClientRect();
      const controls = Array.from(workspace.querySelectorAll<HTMLElement>("#editor-search input, #editor-search button"))
        .filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect());
      return { height: sourceBox.height, bottom: sourceBox.bottom, viewport: innerHeight,
        controlsInside: controls.every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1 &&
          rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1) };
    });
    expect(geometry.controlsInside).toBe(true);
    expect(geometry.height).toBeGreaterThanOrEqual(60);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport + 1);
    const parked = await page.locator("#canvas").evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, visibility: getComputedStyle(node).visibility };
    });
    expect(parked.visibility).toBe("hidden");
    expect(parked.width).toBeGreaterThan(0);
    expect(parked.height).toBeGreaterThan(0);
    expect(await originalPage!.evaluate(node => node.isConnected)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`desktop-find-short-${width}.png`), fullPage: true });
    await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("fox");
    await page.getByRole("button", { name: "Replace all", exact: true }).click();
    await expect(page.locator("#editor-input")).toHaveValue(source.replaceAll("cat", "fox"));
    await page.getByRole("button", { name: "Close find", exact: true }).click();
    await expect(page.locator("#canvas")).toBeVisible();
    await expect(page.locator("#workspace")).toHaveAttribute("data-view-mode", originalMode!);
    expect(await page.locator("#workspace").evaluate(node => node.style.getPropertyValue("--split-ratio"))).toBe(originalRatio);
    await expect(page.locator(".pagedjs_page")).toHaveCount(originalPages);
    await expect(page.locator("#paged-output")).toContainText("Find a fox and another fox.");
    const restored = await page.locator("#editor-input").boundingBox();
    expect(restored!.width).toBeCloseTo(originalSourceBox!.width, 0);
    expect(restored!.height).toBeCloseTo(originalSourceBox!.height, 0);
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    await page.locator("#editor-input").press("Control+h");
    expect((await page.locator("#editor-input").boundingBox())!.height).toBeGreaterThanOrEqual(60);
    await page.getByRole("button", { name: "Close find", exact: true }).click();
    await expect(page.locator("#workspace")).toHaveAttribute("data-view-mode", "editor");
  });
}
