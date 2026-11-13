import { test, expect, openFiles, readyReader, showOutline } from "./helpers";

// Invented fixture (#204): Unicode and duplicate headings below the first screen.
const FILLER = Array.from({ length: 14 }, (_, i) => `Filler paragraph ${i}, long enough to wrap and push the next heading down the page.`).join("\n\n");
const DOC = ["# Unicode notes", "[[toc]]", "## 日本語の見出し", "## Café", "## Cafe\u0301", "## مرحبا بالعالم", "## 日本語の見出し"]
  .map((block, i) => (i < 2 ? block : `${block}\n\n${FILLER}`)).join("\n\n");
const IDS = ["unicode-notes", "日本語の見出し", "café", "café-1", "مرحبا-بالعالم", "日本語の見出し-1"];

async function expectScrolledTo(page: import("@playwright/test").Page, id: string): Promise<void> {
  // After the click the target heading, wherever it was, sits inside the reading viewport.
  await expect.poll(() => page.evaluate((target) => {
    const heading = document.getElementById(target);
    const box = heading?.getBoundingClientRect();
    const view = document.getElementById("reader-scroll")!.getBoundingClientRect();
    return !!box && box.top >= view.top - 1 && box.top < view.bottom;
  }, id)).toBe(true);
  expect(new URL(page.url()).hash).toBe(`#${encodeURIComponent(id)}`);
}

test("reader TOC and outline entries navigate to Unicode and duplicate headings", async ({ page }) => {
  await openFiles(page, [{ name: "unicode-notes.md", text: DOC }]);
  await readyReader(page, "Unicode notes");
  const doc = page.locator("#reader-document");

  await expect(doc.locator(":is(h1,h2)[id]")).toHaveCount(6);
  expect(await doc.locator(":is(h1,h2)[id]").evaluateAll(items => items.map(item => item.id))).toEqual(IDS);
  expect(await doc.locator("nav.toc a").evaluateAll(links => links.map(link => decodeURIComponent(link.getAttribute("href")!.slice(1))))).toEqual(IDS);
  await expect(doc.locator("nav.toc a")).toHaveText(["Unicode notes", "日本語の見出し", "Café", "Cafe\u0301", "مرحبا بالعالم", "日本語の見出し"]);

  // Click TOC entries bottom-up so each one scrolls the viewport.
  for (const index of [5, 4, 3, 2, 1]) {
    await doc.locator("nav.toc a").nth(index).click();
    await expectScrolledTo(page, IDS[index]!);
    await page.locator("#reader-scroll").evaluate(el => el.scrollTo({ top: 0, behavior: "instant" }));
  }

  await showOutline(page);
  const outline = page.locator("#reader-outline a");
  await expect(outline).toHaveCount(6);
  for (const index of [5, 3]) {
    await outline.nth(index).click();
    await expectScrolledTo(page, IDS[index]!);
    await page.locator("#reader-scroll").evaluate(el => el.scrollTo({ top: 0, behavior: "instant" }));
  }
});
