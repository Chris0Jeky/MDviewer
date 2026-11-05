import { test, expect, openFiles, readyReader } from "./helpers";
import { chromeHeadingMarkdown, chromeHeadings } from "../helpers/chromeHeadings";

test.beforeEach(async ({ browser, browserName }, info) => {
  await info.attach("browser-runtime", { body: JSON.stringify({ engine: browserName, version: browser.version() }), contentType: "application/json" });
});

test("desktop shell IDs remain ordinary headings in reading, workspace and print", async ({ page }) => {
  await openFiles(page, [{ name: "chrome-headings.md", text: chromeHeadingMarkdown }]);
  await readyReader(page, "Chrome heading collisions");
  for (const id of ["reader-shell", "desktop-workspace", "app"]) {
    const heading = page.locator(`#reader-document h2[id="${id}"]`);
    await expect.soft(heading).toHaveCSS("display", "block", { timeout: 1_000 });
  }

  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  const app = page.locator("body > #desktop-workspace > #app");
  const workspace = app.locator(":scope > #workspace");
  const canvas = workspace.locator(":scope > #canvas");
  const output = canvas.locator(":scope > #paged-output");
  await expect(output.locator(".pagedjs_page").first()).toBeVisible({ timeout: 30_000 });
  await expect(app).toHaveJSProperty("inert", false);
  await expect(app.locator(".is-paginating")).toHaveCount(0);
  await app.getByRole("button", { name: "Split", exact: true }).click();

  for (const forcedColors of ["none", "active"] as const) {
    await page.emulateMedia({ forcedColors });
    for (const { id, title } of chromeHeadings) {
      const heading = output.locator(`h2[id="${id}"]`);
      await expect.soft(heading).toHaveText(title, { timeout: 1_000 });
      await expect.soft(heading, `desktop ${forcedColors}: ${id}`).toBeVisible({ timeout: 1_000 });
      const paint = await heading.evaluate(element => {
        const style = getComputedStyle(element);
        return { display: style.display, position: style.position, height: element.getBoundingClientRect().height };
      });
      expect.soft(paint.display, id).toBe("block");
      expect.soft(paint.position, id).toBe("static");
      expect.soft(paint.height, id).toBeLessThan(100);
    }
  }

  await page.emulateMedia({ media: "print", forcedColors: "none" });
  await expect(page.locator("body > #reader-shell")).toBeHidden();
  await expect(app.locator(":scope > #toolbar")).toBeHidden();
  await expect(workspace.locator(":scope > #editor-pane")).toBeHidden();
  await expect(canvas).toBeVisible();
  for (const { id, title } of chromeHeadings) {
    const heading = output.locator(`h2[id="${id}"]`);
    await expect.soft(heading).toHaveText(title, { timeout: 1_000 });
    await expect.soft(heading, `desktop print: ${id}`).toBeVisible({ timeout: 1_000 });
    await expect.soft(heading).toHaveCSS("display", "block", { timeout: 1_000 });
  }
  await page.screenshot({ path: test.info().outputPath("desktop-chrome-headings-print.png"), fullPage: true });
});
