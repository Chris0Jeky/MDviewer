import { test, expect, newInWorkspace, openFiles, readyReader, readyWorkspace } from "./helpers";

const source = "# Room to write\n\nKeep the source and the finished pages unchanged while opening document controls.\n\n## Next thought\n\nWriting comes first; page settings are available when needed.\n";

test("desktop starts with a calm toolbar and expands layout without changing source or pages", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openFiles(page, [{ name: "writing.md", text: source }]);
  await readyReader(page, "Room to write");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, source);
  const layout = page.locator(".workspace-formatting");
  const summary = layout.locator("summary");
  const editor = page.locator("#editor-input");
  const header = page.getByRole("textbox", { name: "Running header text" });
  await expect(layout).not.toHaveAttribute("open");
  await expect(header).toBeHidden();
  // The pre-fix screenshot started the workspace around y=340 at this size.
  // Require useful writing space, not just a changed disclosure attribute.
  expect(await page.locator("#workspace").evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(450);
  expect(await editor.evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(420);
  await expect(page.getByRole("button", { name: "Print / Save as PDF", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("desktop-toolbar-collapsed-1280.png"), fullPage: true });

  const pageNodes = await page.locator("#paged-output .pagedjs_page").elementHandles();
  const pageState = await page.locator("#paged-output .pagedjs_page").evaluateAll(nodes => nodes.map(node => ({
    text: node.textContent, width: (node as HTMLElement).offsetWidth, height: (node as HTMLElement).offsetHeight,
  })));
  const savedSettings = await page.evaluate(() => localStorage.getItem("mdviewer.settings.v1"));
  await summary.click();
  await expect(header).toBeVisible();
  await expect(editor).toHaveValue(source);
  await page.screenshot({ path: test.info().outputPath("desktop-toolbar-expanded-1280.png"), fullPage: true });
  await header.press("Escape");
  await expect(layout).not.toHaveAttribute("open");
  await expect(summary).toBeFocused();
  await expect(editor).toHaveValue(source);
  expect(await page.evaluate(() => localStorage.getItem("mdviewer.settings.v1"))).toBe(savedSettings);
  expect(await Promise.all(pageNodes.map(node => node.evaluate(element => element.isConnected)))).toEqual(pageNodes.map(() => true));
  expect(await page.locator("#paged-output .pagedjs_page").evaluateAll(nodes => nodes.map(node => ({
    text: node.textContent, width: (node as HTMLElement).offsetWidth, height: (node as HTMLElement).offsetHeight,
  })))).toEqual(pageState);
  expect(await editor.evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(420);
  await Promise.all(pageNodes.map(node => node.dispose()));
});

test("a narrow desktop keeps layout settings reachable and retained after collapse", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 720 });
  await newInWorkspace(page, "button");
  const editor = page.locator("#editor-input");
  await editor.fill(source);
  await expect(page.locator("#paged-output h1")).toHaveText("Room to write");
  const layout = page.locator(".workspace-formatting");
  await expect(layout).not.toHaveAttribute("open");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  expect(await editor.evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(560);
  await page.screenshot({ path: test.info().outputPath("desktop-toolbar-collapsed-560.png"), fullPage: true });

  await layout.locator("summary").click();
  const header = page.getByRole("textbox", { name: "Running header text" });
  await header.fill("Keep this page header");
  await header.press("Escape");
  await expect(layout).not.toHaveAttribute("open");
  await expect(layout.locator("summary")).toBeFocused();
  await expect(editor).toHaveValue(source);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mdviewer.settings.v1")!).runningHeader)).toBe("Keep this page header");
  await layout.locator("summary").click();
  await expect(header).toHaveValue("Keep this page header");
  await header.press("Escape");
  await expect(editor).toHaveValue(source);
});
