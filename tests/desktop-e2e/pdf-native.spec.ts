import type { Page } from "@playwright/test";
import { installFakeHost, fakeEntry, fakeCalls } from "./fakeHost";
import { test, expect, readyReader } from "./helpers";
import { linkedDocument } from "../helpers/pdfCorpus";

/**
 * P1b: a PDF the Windows host opens (Library here; the picker and launch use the same batch) arrives
 * as `kind: "pdf"` with a PDF token. The shell fetches its bytes through `Host.readPdf`, shows it in a
 * PDF tab and releases the token on close. The fake answers at the IPC layer (`fakeHost.ts`); native
 * bounds and the separate PDF registry are proven by the Rust tests in `commands/pdf.rs`.
 */
async function open(page: Page): Promise<void> {
  await installFakeHost(page, {
    recent: [fakeEntry("r1", "linked.pdf", "C:\\work"), fakeEntry("r2", "notes.md", "C:\\work\\board")],
    texts: { r2: ["notes.md", "# Notes\n\nText."] },
    pdfs: { r1: ["linked.pdf", Buffer.from(linkedDocument()).toString("base64")] },
  });
  await page.goto("/desktop.html");
  await page.getByRole("button", { name: "Library and outline" }).click();
  await page.getByRole("tab", { name: "Library" }).click();
}

test("a natively opened PDF reads its bytes by token, shows in a tab and releases the token on close", async ({ page }) => {
  await open(page);
  const recent = page.locator("#shell-panel section", { has: page.getByRole("heading", { name: "Recent" }) });
  await recent.getByRole("button", { name: /^notes\.md/ }).click();
  await readyReader(page, "Notes");

  await recent.getByRole("button", { name: /^linked\.pdf/ }).click();
  await expect(page.locator("#reader-pdf .pdf-page")).toHaveCount(2);
  await expect(page.locator("#reader-pdf .pdf-text").first()).toContainText("Hello PDF world");
  await expect(page.getByRole("tab", { name: "linked.pdf" })).toHaveAttribute("aria-selected", "true");
  // The PDF never became a text document: no Edit, and no text command used its token.
  await expect(page.locator("#reader-edit-toggle")).toBeDisabled();
  const calls = await fakeCalls(page);
  expect(calls).toContain("read_pdf");
  expect(calls.filter(cmd => ["save_document", "patch_document", "read_document"].includes(cmd))).toEqual([]);

  await page.keyboard.press("Control+W");
  await expect(page.getByRole("tab", { name: "linked.pdf" })).toHaveCount(0);
  await readyReader(page, "Notes");
  expect(await fakeCalls(page)).toContain("release_pdf");
});
