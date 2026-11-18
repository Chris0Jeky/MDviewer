import { readFileSync } from "node:fs";
import { test, expect, openFiles } from "./helpers";

/** An .html file opens as a sanitized readable view (D7). Invented fixture; nothing may leave the machine. */
const PAGE = readFileSync("tests/fixtures/data/page.html", "utf8");

test("an HTML file shows its body sanitized: no scripts, styles, frames, forms or remote resources", async ({ page }) => {
  const outside: string[] = [];
  const dialogs: string[] = [];
  page.on("request", request => { if (request.url().includes("example.invalid")) outside.push(request.url()); });
  page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.goto("/desktop.html");
  await openFiles(page, [{ name: "page.html", text: PAGE }]);
  const doc = page.locator("#reader-document");
  await expect(doc).toHaveAttribute("aria-busy", "false");
  await expect(doc.locator("h1").first()).toHaveText("page.html");
  await expect(doc).toContainText("title “Invented & local page”");
  await expect(doc).toContainText("Shown without its 2 scripts");
  const body = doc.locator(".readable-html");
  await expect(body.getByRole("heading", { name: "Release notes" })).toBeVisible();
  await expect(body.locator("pre")).toHaveText("line one\n\nline three");
  await expect(body.locator("table")).toContainText("Value");
  await expect(body.locator("script, style, iframe, form, link")).toHaveCount(0);
  // An authored input stays, inert, as in any Markdown with raw HTML.
  await expect(body.locator("input:not([disabled])")).toHaveCount(0);
  await expect(body.locator('img[alt="remote"]')).not.toHaveAttribute("src", /example\.invalid/);
  await expect(page.locator("#reader-status")).toContainText("HTML");
  expect(await page.evaluate(() => document.title)).not.toBe("changed");
  expect(dialogs).toEqual([]);
  expect(outside).toEqual([]);
  // Edit shows the raw source, which Save writes unchanged.
  await page.keyboard.press("Control+e");
  await expect(page.locator("#reader-edit #editor-input")).toHaveValue(PAGE);
});
