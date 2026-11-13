import type { Page } from "@playwright/test";
import { test, expect, documentTabs, readyReader } from "../desktop-e2e/helpers";

/**
 * Open and Save on the browser host (web parity W1). In Chromium the files are real
 * `FileSystemFileHandle`s from the origin private file system: the OS pickers cannot be driven
 * headless, so a test-only override of `showOpenFilePicker`/`showSaveFilePicker` hands the app
 * OPFS handles. The app then reads, compares and writes them through the same API calls a
 * user-picked file gets (`getFile`, `createWritable`). Firefox has no picker API and proves the
 * fallback: a file input to open, a download to save, and nothing written in place.
 */
declare global {
  interface Window { __pick: string[]; __saveAs: string | null }
}

async function installPickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__pick = [];
    window.__saveAs = null;
    const abort = () => new DOMException("The user aborted a request.", "AbortError");
    Object.assign(window, {
      showOpenFilePicker: async () => {
        if (!window.__pick.length) throw abort();
        const root = await navigator.storage.getDirectory();
        return Promise.all(window.__pick.map(name => root.getFileHandle(name)));
      },
      showSaveFilePicker: async () => {
        if (!window.__saveAs) throw abort();
        return (await navigator.storage.getDirectory()).getFileHandle(window.__saveAs, { create: true });
      },
    });
  });
  await page.goto("/desktop.html");
  // The shell boots after the browser host loads; a key pressed before that reaches nothing.
  await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
}

const writeFile = (page: Page, name: string, bytes: Buffer) => page.evaluate(async ({ name, bytes }) => {
  const handle = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Uint8Array(bytes));
  await writable.close();
}, { name, bytes: [...bytes] });

const readFile = async (page: Page, name: string): Promise<Buffer> => Buffer.from(await page.evaluate(async name => {
  const file = await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile();
  return [...new Uint8Array(await file.arrayBuffer())];
}, name));

/** `text` (LF) in a file's conventions, as an editor of that file would write it. */
function encode(text: string, encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be", eol: "\n" | "\r\n" | "\r"): Buffer {
  const body = text.replace(/\n/g, eol);
  if (encoding === "utf-8") return Buffer.from(body, "utf8");
  if (encoding === "utf-8-bom") return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, "utf8")]);
  const le = Buffer.from(body, "utf16le");
  if (encoding === "utf-16le") return Buffer.concat([Buffer.from([0xff, 0xfe]), le]);
  const be = Buffer.from(le);
  be.swap16();
  return Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
}

async function openPicked(page: Page, name: string, heading: string): Promise<void> {
  await page.evaluate(name => { window.__pick = [name]; }, name);
  await page.keyboard.press("Control+O");
  await readyReader(page, heading);
}

async function appendInEdit(page: Page, text: string): Promise<void> {
  await page.keyboard.press("Control+e");
  const input = page.locator("#reader-edit #editor-input");
  await expect(input).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(text);
}

test.describe("Chromium: the file the user picked", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "File System Access API");
  test.beforeEach(async ({ page }) => { await installPickers(page); });

  const CASES = [
    ["utf-8", "\n"], ["utf-8-bom", "\r\n"], ["utf-16le", "\r\n"], ["utf-16be", "\n"], ["utf-8", "\r"],
  ] as const;
  for (const [encoding, eol] of CASES) {
    test(`Ctrl+S writes exactly the edit back, keeping ${encoding} and ${JSON.stringify(eol)}`, async ({ page }) => {
      const name = `round-${encoding}-${eol.length}${eol === "\r" ? "cr" : ""}.md`;
      const before = "# Café notes\n\nBody \u{1f4c4}.\n";
      await writeFile(page, name, encode(before, encoding, eol));
      await openPicked(page, name, "Café notes");
      await expect(page.locator("#reader-save-state")).toHaveText("Saved");
      await appendInEdit(page, "Added line.");
      await expect(documentTabs(page)).toHaveText([`${name}, unsaved changes`]);
      await page.keyboard.press("Control+s");
      await expect(page.locator("#reader-save-state")).toHaveText("Saved");
      expect((await readFile(page, name)).equals(encode(`${before}Added line.`, encoding, eol))).toBe(true);
      await expect(documentTabs(page)).toHaveText([name]);
    });
  }

  test("an outside change is never overwritten: Save refuses and the file keeps the other program's bytes", async ({ page }) => {
    await writeFile(page, "shared.md", Buffer.from("# Shared\n\nMine.\n"));
    await openPicked(page, "shared.md", "Shared");
    await writeFile(page, "shared.md", Buffer.from("# Shared\n\nTheirs.\n"));
    await appendInEdit(page, "Typed.");
    await page.keyboard.press("Control+s");
    await expect(page.locator("#reader-notice")).toContainText("changed on disk since MDviewer last read or saved it. Nothing was written");
    expect((await readFile(page, "shared.md")).toString()).toBe("# Shared\n\nTheirs.\n");
    await expect(documentTabs(page)).toHaveText(["shared.md, unsaved changes"]);
  });

  test("Save on a new note asks where, writes UTF-8 with LF and binds the file", async ({ page }) => {
    await page.evaluate(() => { window.__saveAs = "plan.md"; });
    await page.keyboard.press("Control+n");
    await expect(page.locator("#reader-edit #editor-input")).toBeFocused();
    await page.keyboard.insertText("# Plan\n\nFirst.\n");
    await page.keyboard.press("Control+s");
    await expect(documentTabs(page)).toHaveText(["plan.md"]);
    expect((await readFile(page, "plan.md")).toString()).toBe("# Plan\n\nFirst.\n");
    // Bound now: the next Ctrl+S writes in place without asking.
    await page.evaluate(() => { window.__saveAs = null; });
    await page.keyboard.insertText("Second.\n");
    await page.keyboard.press("Control+s");
    await expect(page.locator("#reader-save-state")).toHaveText("Saved");
    expect((await readFile(page, "plan.md")).toString()).toBe("# Plan\n\nFirst.\nSecond.\n");
  });

  test("a canceled picker opens nothing and reports nothing", async ({ page }) => {
    await page.keyboard.press("Control+O");
    await page.waitForTimeout(300); // nothing should happen; give it the chance to
    await expect(page.locator("#reader-notice")).toBeHidden();
    await expect(documentTabs(page)).toHaveCount(0);
  });
});

test.describe("Firefox: no picker API, so a copy", () => {
  test.skip(({ browserName }) => browserName !== "firefox", "fallback path");

  test("opens through the file input and saves a downloaded copy, never in place", async ({ page }) => {
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+O");
    await (await chooser).setFiles([{ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes\r\n\r\nText.\r\n") }]);
    await readyReader(page, "Notes");
    await expect(page.locator("#reader-save-state")).toHaveText("In memory");
    const download = page.waitForEvent("download");
    await page.keyboard.press("Control+s");
    expect((await download).suggestedFilename()).toBe("notes.md");
  });
});
