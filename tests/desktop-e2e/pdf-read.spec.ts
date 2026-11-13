import type { Page } from "@playwright/test";
import { test, expect, openFiles, readyReader } from "./helpers";
import { encrypted, linkedDocument, longDocument } from "../helpers/pdfCorpus";

const pdfAsset = /\/assets\/(?:pdf-[^/]+\.(?:js|css)|pdfium-[^/]+\.(?:js|wasm))$/;

async function openPdfFile(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+O");
  await (await chooser).setFiles([{ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) }]);
}

const view = (page: Page) => page.locator("#reader-pdf .pdf-view");

test("the PDF chunk and engine load only when a PDF is opened, and the PDF reads well", async ({ page, audit }) => {
  // Cold start and a Markdown document: nothing from src/pdf is requested.
  await openFiles(page, [{ name: "notes.md", text: "# Notes\n\nPlain Markdown." }]);
  await readyReader(page, "Notes");
  expect(audit.requests.filter(url => pdfAsset.test(url))).toEqual([]);

  await openPdfFile(page, "linked.pdf", linkedDocument());
  await expect(view(page).locator(".pdf-page")).toHaveCount(2);
  await expect(view(page).locator(".pdf-page").first().locator("canvas")).toBeVisible();
  expect(audit.requests.some(url => /\/assets\/pdfium-[^/]+\.wasm$/.test(url))).toBe(true);
  await expect(page.locator("#reader-pdf")).toBeVisible();
  await expect(page.locator("#reader-scroll")).toBeHidden();
  await expect(page.getByRole("tab", { name: "linked.pdf" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#reader-status")).toContainText("page 1 of 2");
  await expect(page.locator("#reader-edit-toggle")).toBeDisabled();

  // Selectable text layer with the page's words.
  await expect(view(page).locator(".pdf-page").first().locator(".pdf-text")).toContainText("Hello PDF world");

  // Bookmarks become the outline and jump.
  await page.keyboard.press("Control+B");
  const outline = page.locator("#reader-outline");
  await expect(outline.getByRole("button", { name: "Introduction" })).toBeVisible();
  await outline.getByRole("button", { name: "Second page" }).click();
  await expect(view(page).getByRole("spinbutton", { name: "Page number" })).toHaveValue("2");

  // Find with Ctrl+F.
  await view(page).locator(".pdf-scroll").focus();
  await page.keyboard.press("Control+F");
  await expect(view(page).getByRole("searchbox", { name: "Find in PDF" })).toBeFocused();
  await page.keyboard.type("pdf world");
  await expect(view(page).locator(".pdf-find-count")).toHaveText("1 of 1");
  await expect(view(page).locator(".pdf-hit.is-current")).toHaveCount(1);

  // Internal links jump; blocked actions (javascript:, Launch, JavaScript, SubmitForm) do nothing.
  const first = view(page).locator(".pdf-page").first();
  await expect(first.locator(".pdf-link-blocked")).toHaveCount(5);
  await first.getByRole("link", { name: "Go to page 2" }).click();
  await expect(view(page).getByRole("spinbutton", { name: "Page number" })).toHaveValue("2");
  // External links have no href: only the shell's openWebLink path opens them.
  const external = first.getByRole("link", { name: "Open https://example.org/" });
  await expect(external).not.toHaveAttribute("href", /./);
  await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = (url?: string | URL) => { (window as unknown as { __opened: string[] }).__opened.push(String(url)); return null; }; });
  await external.click();
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(["https://example.org/"]);

  // Zoom keeps the page; the page box grows.
  const before = await first.boundingBox();
  await view(page).getByRole("button", { name: "Zoom in (Ctrl+=)" }).click();
  await expect(view(page).locator(".pdf-zoom-label")).toHaveText("110%");
  expect((await first.boundingBox())!.width).toBeGreaterThan(before!.width);

  // Thumbnails.
  await view(page).getByRole("button", { name: "Page thumbnails" }).click();
  await expect(view(page).locator(".pdf-thumb")).toHaveCount(2);
  await expect(view(page).locator(".pdf-thumb canvas").first()).toBeVisible();

  await page.screenshot({ path: test.info().outputPath("pdf-view.png") });

  // Back to Markdown and back to the PDF.
  await page.getByRole("tab", { name: "notes.md" }).click();
  await readyReader(page, "Notes");
  await expect(page.locator("#reader-pdf")).toBeHidden();
  await page.getByRole("tab", { name: "linked.pdf" }).click();
  await expect(page.locator("#reader-pdf")).toBeVisible();

  // Closing the PDF returns to the Markdown document.
  await page.keyboard.press("Control+W");
  await expect(page.getByRole("tab", { name: "linked.pdf" })).toHaveCount(0);
  await readyReader(page, "Notes");
  await page.screenshot({ path: test.info().outputPath("pdf-read.png") });
});

test("an encrypted PDF asks for its password and opens only with the right one", async ({ page }) => {
  await openPdfFile(page, "locked.pdf", await encrypted(linkedDocument(), "s3cret"));
  const form = page.locator("#reader-pdf .pdf-password");
  await expect(form).toBeVisible();
  const password = form.getByLabel("Password");
  await expect(password).toBeFocused();
  await password.fill("wrong");
  await form.getByRole("button", { name: "Open" }).click();
  await expect(form.getByRole("status")).toContainText("did not open");
  await password.fill("s3cret");
  await form.getByRole("button", { name: "Open" }).click();
  await expect(view(page).locator(".pdf-page")).toHaveCount(2);
  await expect(view(page).locator(".pdf-text").first()).toContainText("Hello PDF world");
});

test("a non-PDF named .pdf is refused with a message and opens no tab", async ({ page }) => {
  await openPdfFile(page, "fake.pdf", new TextEncoder().encode("# not really a pdf"));
  await expect(page.locator("#reader-notice")).toContainText("fake.pdf: This file is not a PDF.");
  await expect(page.getByRole("tab", { name: "fake.pdf" })).toHaveCount(0);
});

test("a 1,000-page PDF stays responsive and keeps few pages drawn", async ({ page }) => {
  test.setTimeout(180_000);
  await openPdfFile(page, "long.pdf", await longDocument(1000, 12));
  await expect(view(page).locator(".pdf-page")).toHaveCount(1000, { timeout: 30_000 });
  const scroller = view(page).locator(".pdf-scroll");
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    const started = Date.now();
    await scroller.evaluate((node, f) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * f; }, fraction);
    await expect(view(page).locator(".pdf-page canvas").first()).toBeVisible();
    expect(Date.now() - started).toBeLessThan(5_000);
  }
  await expect(view(page).getByRole("spinbutton", { name: "Page number" })).toHaveValue("1000");
  await expect(view(page).locator(".pdf-page").last().locator(".pdf-text")).toContainText("Page 1000 line 1 ");
  expect(await view(page).locator(".pdf-page canvas").count()).toBeLessThanOrEqual(12);
});

test("Edit closes, with its text kept, when a PDF tab is shown", async ({ page }) => {
  await openFiles(page, [{ name: "draft.md", text: "# Draft\n\nFirst line." }]);
  await readyReader(page, "Draft");
  await page.keyboard.press("Control+E");
  const source = page.locator("#reader-edit #editor-input");
  await expect(source).toBeFocused({ timeout: 30_000 });
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Typed before the PDF.");
  await openPdfFile(page, "linked.pdf", linkedDocument());
  await expect(view(page).locator(".pdf-page")).toHaveCount(2);
  await expect(page.locator("#reader-edit")).toBeHidden();
  await page.keyboard.press("Control+E"); // does nothing while a PDF is shown
  await expect(page.locator("#reader-edit")).toBeHidden();
  await page.getByRole("tab", { name: /draft\.md/ }).click();
  await expect(page.locator("#reader-document")).toContainText("Typed before the PDF.");
});
