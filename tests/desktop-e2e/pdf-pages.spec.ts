import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { test, expect } from "./helpers";
import { linkedDocument, longDocument, tinyPng } from "../helpers/pdfCorpus";
import { openPdf } from "../../src/pdf/engine";

/** P2 round trip: edit pages in the browser, Save a copy, reopen the file in PDFium and pdf.js. */
async function openPdfFile(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+O");
  await (await chooser).setFiles([{ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) }]);
}
const view = (page: Page) => page.locator("#reader-pdf .pdf-view");
const pagesBar = (page: Page) => view(page).getByRole("toolbar", { name: "Pages" });
const thumb = (page: Page, n: number) => view(page).locator(".pdf-thumb").nth(n - 1);

/** The first line of each page of a `longDocument` as its page number, read by pdf.js. */
async function order(bytes: Uint8Array): Promise<number[]> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  try {
    const pdf = await task.promise;
    const numbers: number[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const text = (await (await pdf.getPage(i)).getTextContent()).items.map(item => ("str" in item ? item.str : "")).join(" ");
      numbers.push(Number(/Page (\d+) line 1/.exec(text)?.[1] ?? 0));
    }
    return numbers;
  } finally { await task.destroy(); }
}

test("reorder, rotate, delete, insert, undo and Save a copy: the saved file has exactly those pages", async ({ page }) => {
  test.setTimeout(120_000);
  await openPdfFile(page, "book.pdf", await longDocument(5, 2));
  await expect(view(page).locator(".pdf-page")).toHaveCount(5);
  await view(page).getByRole("button", { name: "Page thumbnails" }).click();
  await expect(view(page).locator(".pdf-thumb")).toHaveCount(5);

  // Select page 5 and move it to the front (twice "earlier" is slow: drag it).
  await thumb(page, 5).dragTo(thumb(page, 1));
  await expect(view(page).locator(".pdf-thumb")).toHaveCount(5);
  await expect(page.getByRole("tab", { name: /book\.pdf/ })).toHaveAttribute("title", /unsaved changes/);

  // Order is now 5,1,2,3,4. Rotate the second thumbnail (page 1), delete the third (page 2), undo, redo.
  await view(page).locator(".pdf-thumb").nth(1).click();
  await pagesBar(page).getByRole("button", { name: "Rotate right" }).click();
  await expect(view(page).locator(".pdf-page").nth(1)).toHaveCSS("width", "792px");
  await view(page).locator(".pdf-thumb").nth(2).click();
  await pagesBar(page).getByRole("button", { name: /^Delete/ }).click();
  await expect(view(page).locator(".pdf-page")).toHaveCount(4);
  await pagesBar(page).getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(view(page).locator(".pdf-page")).toHaveCount(5);
  await pagesBar(page).getByRole("button", { name: "Redo (Ctrl+Y)" }).click();
  await expect(view(page).locator(".pdf-page")).toHaveCount(4);

  // Insert another PDF's two pages and an image after the last page.
  await view(page).locator(".pdf-thumb").nth(3).click();
  await view(page).locator('input[type="file"][accept*="pdf"]').setInputFiles({ name: "extra.pdf", mimeType: "application/pdf", buffer: Buffer.from(linkedDocument()) });
  await expect(view(page).locator(".pdf-page")).toHaveCount(6);
  await view(page).locator(".pdf-thumb").nth(5).click();
  await view(page).locator('input[type="file"][accept*="image"]').setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from(tinyPng()) });
  await expect(view(page).locator(".pdf-page")).toHaveCount(7);

  // Save a copy (a download on the web). Deleting forced a full rewrite.
  const download = page.waitForEvent("download");
  await pagesBar(page).getByRole("button", { name: "Save a copy…" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("book (edited).pdf");
  await expect(page.locator("#reader-status")).toContainText("rewritten in full");
  const saved = new Uint8Array(readFileSync((await file.path())!));

  // Pages: 5, 1 (rotated), 3, 4, extra 1-2, image; page 2 deleted.
  const numbers = await order(saved);
  expect(numbers.slice(0, 4)).toEqual([5, 1, 3, 4]);
  expect(numbers.length).toBe(7);
  const doc = await openPdf(saved);
  try {
    expect(doc.pageCount).toBe(7);
    expect(doc.pageSize(1)).toEqual({ width: 792, height: 612 });
    expect(doc.pageText(4)).toContain("Hello PDF world");
    expect(doc.pageSize(6)).toEqual({ width: 1.5, height: 0.75 });
    expect(Buffer.from(saved).toString("latin1")).not.toContain(Buffer.from("Page 2 line 1").toString("hex").toUpperCase());
  } finally { doc.close(); }
});

test("Extract opens the selected pages as a new PDF tab; closing an edited PDF asks first", async ({ page }) => {
  await openPdfFile(page, "book.pdf", await longDocument(3, 1));
  await view(page).getByRole("button", { name: "Page thumbnails" }).click();
  await thumb(page, 2).click();
  await thumb(page, 3).click({ modifiers: ["Control"] });
  await expect(pagesBar(page).locator(".pdf-target")).toHaveText("2 pages selected");
  await pagesBar(page).getByRole("button", { name: "Extract to a new PDF" }).click();
  await expect(page.getByRole("tab", { name: /book \(2 pages\)\.pdf/ })).toHaveAttribute("aria-selected", "true");
  await expect(view(page).locator(".pdf-page")).toHaveCount(2);
  page.once("dialog", dialog => { expect(dialog.message()).toContain("Discard unsaved changes"); void dialog.dismiss(); });
  await page.keyboard.press("Control+W");
  await expect(page.getByRole("tab", { name: /book \(2 pages\)\.pdf/ })).toHaveCount(1);
});
