import { test, expect, openFiles, readyReader, readyWorkspace, documentTabs, RICH_MARKDOWN } from "./helpers";

const DOCS = [
  { name: "alpha.md", text: "# Alpha\n\nFirst document.\n\n## Second section\n\nMore." },
  { name: "beta.md", text: "# Beta\n\nSecond document." },
];

test("with a document open the chrome is one 40 px bar and a 24 px status line", async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 800 });
  await openFiles(page, DOCS);
  await readyReader(page, "Alpha");
  const bar = await page.locator(".shell-bar").boundingBox();
  const status = await page.locator(".reader-footer").boundingBox();
  expect(bar!.height).toBeLessThanOrEqual(44);
  expect(status!.height).toBeLessThanOrEqual(24);
  await expect(page.locator("#shell-panel")).toBeHidden();
  await expect(page.locator("#reader-status")).toContainText("alpha.md · ");
  await expect(page.locator("#reader-status")).toContainText(/\d+ words · ~\d+ tokens/);
  await expect(page.locator("#reader-save-state")).toHaveText("In memory");
  await expect(documentTabs(page)).toHaveText(["alpha.md", "beta.md"]);
  await expect(documentTabs(page).first()).toHaveAttribute("aria-selected", "true");
});

test("the first document paints before the panel or palette code loads", async ({ page, audit }) => {
  await openFiles(page, DOCS);
  await readyReader(page, "Alpha");
  const lazy = () => audit.requests.filter(url => /\/assets\/(?:panel|palette|library-panel)-[^/]+\.js$/.test(url));
  expect(lazy(), "no shell chunks before the first use").toEqual([]);
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox", { name: "Search commands and files" })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+b");
  await expect(page.locator("#shell-panel [role=tablist]")).toBeVisible();
  expect(lazy().length).toBe(2); // palette, then panel
});

test("every former reader control is a command in the palette", async ({ page }) => {
  await openFiles(page, DOCS);
  await readyReader(page, "Alpha");
  const titles = ["New document", "Open files…", "Close document", "Next document", "Previous document", "Light theme", "Dark theme",
    "Sepia theme", "Follow Windows theme", "Smaller text", "Larger text", "Edit & PDF", "Print or export PDF…", "Save a copy…",
    "Show or hide the library and outline", "Show the outline", "Copy reference (path and selected lines)"];
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Search commands and files" });
  for (const title of titles) {
    await input.fill(title);
    await expect(page.getByRole("option", { name: title }).first(), title).toBeVisible();
  }
  // Open documents are listed first, so the palette also switches documents.
  await input.fill("beta");
  await page.keyboard.press("Enter");
  await readyReader(page, "Beta");
  await expect(documentTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
});

test("a keyboard-only walk reaches the bar, tabs, menu, panel and palette and returns focus", async ({ page }) => {
  await openFiles(page, DOCS);
  await readyReader(page, "Alpha");
  await page.locator("body").focus();
  await page.keyboard.press("Tab"); // skip link
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Library and outline" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(documentTabs(page).first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await readyReader(page, "Beta");
  await expect(documentTabs(page).nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await readyReader(page, "Alpha");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Edit & PDF", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const more = page.getByRole("button", { name: "More", exact: true });
  await expect(more).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "More" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: /Close document/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  // Theme from the menu by keyboard: type-ahead to "Dark theme", Enter.
  await page.keyboard.press("Enter");
  await page.keyboard.press("d");
  await expect(menu.getByRole("menuitemradio", { name: /Dark theme/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", "dark");
  // Panel: Ctrl+B opens it; its tabs take focus by Tab; Ctrl+B closes it again.
  await page.keyboard.press("Control+b");
  await expect(page.locator("#shell-panel")).toBeVisible();
  await expect(page.locator("#reader-outline a")).toHaveCount(2);
  await page.locator("#shell-panel [role=tab]").first().focus();
  await page.keyboard.press("Control+b");
  await expect(page.locator("#shell-panel")).toBeHidden();
  await expect(page.getByRole("button", { name: "Library and outline" })).toBeFocused();
  // Palette returns focus where it opened.
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox", { name: "Search commands and files" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Library and outline" })).toBeFocused();
  // Tab keys: Delete closes the focused document.
  await documentTabs(page).first().focus();
  await page.keyboard.press("Delete");
  await readyReader(page, "Beta");
  await expect(documentTabs(page)).toHaveText(["beta.md"]);
});

test("Ctrl+P prints the paginated document, never the reading view", async ({ page }) => {
  await openFiles(page, [{ name: "notes.md", text: RICH_MARKDOWN }]);
  await readyReader(page, "Desktop field notes");
  await page.keyboard.press("Control+p");
  await readyWorkspace(page, RICH_MARKDOWN);
  await expect.poll(() => page.evaluate(() => window.__desktopEvidence.prints.length)).toBe(1);
  const [print] = await page.evaluate(() => window.__desktopEvidence.prints);
  expect(print!.sheets).toBeGreaterThan(0);
  expect(print!.text).toContain("Desktop field notes");
});

test("shell screenshots: three themes, a narrow window and forced colors", async ({ page, browser }) => {
  for (const theme of ["light", "dark", "sepia"] as const) {
    await page.evaluate(t => localStorage.setItem("mdviewer.settings.v1", JSON.stringify({ schemaVersion: 1, screenTheme: t })), theme);
    await page.reload();
    await page.setViewportSize({ width: 1120, height: 800 });
    await openFiles(page, DOCS);
    await readyReader(page, "Alpha");
    await page.screenshot({ path: test.info().outputPath(`shell-${theme}.png`) });
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.screenshot({ path: test.info().outputPath(`shell-${theme}-more.png`) });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 760, height: 800 });
  await page.keyboard.press("Control+b");
  await expect(page.locator("#shell-panel")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(760);
  await page.screenshot({ path: test.info().outputPath("shell-narrow-760-panel.png") });
  await page.locator("#reader-outline a").first().focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#shell-panel")).toBeHidden();

  const forced = await browser.newContext({ forcedColors: "active", viewport: { width: 1120, height: 800 } });
  const forcedPage = await forced.newPage();
  await forcedPage.goto(page.url());
  await openFiles(forcedPage, DOCS);
  await readyReader(forcedPage, "Alpha");
  await forcedPage.getByRole("button", { name: "More", exact: true }).click();
  await expect(forcedPage.getByRole("menu", { name: "More" })).toBeVisible();
  await forcedPage.screenshot({ path: test.info().outputPath("shell-forced-colors.png") });
  await forced.close();
});

test("review fixes: modal palette, workspace Ctrl+P, narrow drawer and focus after the last tab", async ({ page }) => {
  await openFiles(page, DOCS);
  await readyReader(page, "Alpha");
  // Shortcuts never run under the open palette; it announces its result count.
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Search commands and files" });
  await expect(input).toBeFocused();
  await page.keyboard.press("Control+w");
  await expect(documentTabs(page)).toHaveCount(2);
  await input.fill("zzzz-nothing");
  await expect(page.locator(".shell-palette [role=status]")).toHaveText("No matches");
  await page.keyboard.press("Escape");

  // Ctrl+P inside the workspace prints the paginated document too.
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, DOCS[0]!.text);
  await page.keyboard.press("Control+p");
  await expect.poll(() => page.evaluate(() => window.__desktopEvidence.prints.length)).toBe(1);
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Alpha");

  // Narrow: the drawer never hides what has focus.
  await page.setViewportSize({ width: 760, height: 800 });
  await page.keyboard.press("Control+b");
  await expect(page.locator("#shell-panel")).toBeVisible();
  await expect(page.locator("#shell-panel [role=tab][aria-selected=true]")).toBeFocused();
  await page.locator("#reader-document").focus();
  await expect(page.locator("#shell-panel")).toBeHidden();

  // Closing the last document moves focus to New, not to the page.
  await documentTabs(page).first().focus();
  await page.keyboard.press("Delete");
  await readyReader(page, "Beta");
  await documentTabs(page).first().focus();
  await page.keyboard.press("Delete");
  await expect(page.locator("#reader-new-empty")).toBeFocused();
});
