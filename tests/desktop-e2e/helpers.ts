import { test as base, expect, type Page } from "@playwright/test";

interface Audit { requests: string[]; external: string[]; errors: string[]; allowedCsp: string[] }
interface BrowserEvidence {
  violations: Array<{ directive: string; blocked: string }>;
  prints: Array<{ text: string; sheets: number }>;
  inlineRan?: boolean;
  hostileRan?: boolean;
}

declare global {
  interface Window { __desktopEvidence: BrowserEvidence }
}

export const test = base.extend<{ audit: Audit }>({
  audit: [async ({ page, baseURL }, use) => {
    if (!baseURL) throw new Error("Desktop browser tests require a configured baseURL.");
    const localOrigin = new URL(baseURL).origin;
    const audit: Audit = { requests: [], external: [], errors: [], allowedCsp: [] };
    page.on("request", request => audit.requests.push(request.url()));
    page.on("pageerror", error => audit.errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== localOrigin) {
        audit.external.push(url.href);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      window.__desktopEvidence = { violations: [], prints: [] };
      document.addEventListener("securitypolicyviolation", event => {
        window.__desktopEvidence.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
      });
      // A real OS dialog cannot be driven in headless Chromium. Snapshot the
      // document at the exact print request; the test also renders print media.
      window.print = () => {
        const host = document.getElementById("paged-output");
        window.__desktopEvidence.prints.push({ text: host?.innerText ?? "", sheets: host?.querySelectorAll(".pagedjs_page").length ?? 0 });
      };
    });
    if (onBrowserHost()) await installPickers(page);
    await page.goto("/desktop.html");
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
    await use(audit);
    expect(audit.external, "desktop must not attempt remote requests").toEqual([]);
    expect(audit.errors, "no uncaught runtime errors").toEqual([]);
    const violations = await page.evaluate(() => window.__desktopEvidence.violations);
    expect(violations.filter(item => !audit.allowedCsp.includes(`${item.directive}:${item.blocked}`)), "render and export must work under the production CSP").toEqual([]);
  }, { auto: true }],
});

export { expect };

/**
 * The suite also runs on the browser host (project `webhost-desktop`, web parity W2a): the same
 * shell, with files opened as real handles from the origin private file system. The OS pickers
 * cannot be driven headless, so a test-only override hands the app those handles; `window.__pick`
 * names the files Open returns and `window.__saveAs` the file Save As returns (abort when unset).
 */
export const onBrowserHost = (): boolean => ["webhost-desktop", "webhost-chromium"].includes(test.info().project.name);

declare global {
  interface Window { __pick: string[]; __saveAs: string | null }
}

export async function installPickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__pick = [];
    window.__saveAs = null;
    const abort = () => new DOMException("The user aborted a request.", "AbortError");
    Object.assign(window, {
      showOpenFilePicker: async () => {
        const paths = window.__pick.splice(0);
        if (!paths.length) throw abort();
        const root = await navigator.storage.getDirectory();
        // "folder/name.md" picks a file inside a folder of the private file system.
        return Promise.all(paths.map(async path => {
          const parts = path.split("/");
          let dir = root;
          for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
          return dir.getFileHandle(parts.at(-1)!);
        }));
      },
      showSaveFilePicker: async () => {
        if (!window.__saveAs) throw abort();
        return (await navigator.storage.getDirectory()).getFileHandle(window.__saveAs, { create: true });
      },
    });
  });
}

/**
 * Save a copy (a download). Without a file host Ctrl+S is Save Copy; where Ctrl+S saves the file in
 * place (the browser host) the copy is the explicit command: Save Markdown in the workspace, More → "Save a copy…"
 * in the reader. In-place Save is covered by `tests/webhost-e2e/save.spec.ts`.
 */
export async function saveCopy(page: Page, from: import("@playwright/test").Locator): Promise<void> {
  if (!onBrowserHost()) { await from.press("Control+s"); return; }
  if (await page.locator("#desktop-workspace").isVisible()) {
    await page.getByRole("button", { name: "Save Markdown", exact: true }).click();
    return;
  }
  await moreMenu(page, "Save a copy…");
}

/** Write a file into the origin private file system (the browser host's "disk" in tests). */
export const writeFile = (page: Page, path: string, bytes: Buffer): Promise<void> => page.evaluate(async ({ path, base64 }) => {
  const parts = path.split("/");
  let dir = await navigator.storage.getDirectory();
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const handle = await dir.getFileHandle(parts.at(-1)!, { create: true });
  const writable = await handle.createWritable();
  // Base64, not a number array: the session-limit fixtures are 12.6 MB.
  await writable.write(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
  await writable.close();
}, { path, base64: bytes.toString("base64") });

export const readFile = async (page: Page, name: string): Promise<Buffer> => Buffer.from(await page.evaluate(async name => {
  const file = await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile();
  return [...new Uint8Array(await file.arrayBuffer())];
}, name));

export const RICH_MARKDOWN = `# Desktop field notes

A private local note with **emphasis** and an endnote.[^note]

## Code and mathematics

\`\`\`typescript
const answer: number = 42;
console.log(answer);
\`\`\`

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## Diagram

\`\`\`mermaid
flowchart LR
  A[Read locally] --> B[Export when ready]
\`\`\`

[^note]: This footnote stays with the document.
`;

let picks = 0;
/**
 * Open files the way a user picks them. `open` triggers the picker; Ctrl+O works from the empty
 * state, the tabs and the document alike (S3 has no Open button in the bar).
 */
export async function openFiles(page: Page, files: Array<{ name: string; text: string } | { name: string; bytes: Buffer }>,
  open: () => Promise<void> = () => page.keyboard.press("Control+O")): Promise<void> {
  if (onBrowserHost()) {
    // The browser host opens the files themselves (bound, savable in place). Each pick gets its own
    // folder: two picks of "notes.md" are two files, as two copies are on the fallback path.
    const folder = `pick-${++picks}`;
    for (const file of files) await writeFile(page, `${folder}/${file.name}`, bytesOf(file));
    await page.evaluate(paths => { window.__pick = paths; }, files.map(file => `${folder}/${file.name}`));
    await open();
    // Like the file chooser path: return once the picker has handed over the files.
    await page.waitForFunction(() => window.__pick.length === 0);
    return;
  }
  const chooser = page.waitForEvent("filechooser");
  await open();
  await (await chooser).setFiles(files.map(file => ({ name: file.name, mimeType: "text/markdown", buffer: bytesOf(file) })));
}
const bytesOf = (file: { text: string } | { bytes: Buffer }): Buffer => "bytes" in file ? file.bytes : Buffer.from(file.text);

/** A new blank document in the PDF workspace: New opens Edit (S5), then Export PDF…. */
export async function newInWorkspace(page: Page, via: "keyboard" | "button" = "keyboard"): Promise<void> {
  if (via === "keyboard") await page.keyboard.press("Control+n");
  else await page.getByRole("button", { name: "New document", exact: true }).click();
  await expect(page.locator("#reader-edit #editor-input")).toBeFocused({ timeout: 30_000 });
  await openPdf(page);
  await expect(page.locator("#app #editor-input")).toBeFocused({ timeout: 30_000 });
}

export async function readyReader(page: Page, heading: string): Promise<void> {
  await expect(page.locator("#reader-document")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#reader-document h1")).toHaveText(heading);
  await expect(page.locator("#reader-shell > footer #reader-status")).toContainText(/ words? · /);
}

export async function readyWorkspace(page: Page, text: string): Promise<void> {
  await expect(page.locator("#desktop-workspace")).toBeVisible();
  await expect(page.locator("#editor-input")).toHaveValue(text);
  await expect(page.locator("#paged-output .pagedjs_page").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".is-paginating")).toHaveCount(0);
  await expect(page.locator("#app")).toHaveJSProperty("inert", false);
}

export async function dropFiles(page: Page, files: Array<{ name: string; text: string }>, target = "#reader-shell"): Promise<void> {
  const dataTransfer = await page.evaluateHandle(specs => {
    const data = new DataTransfer();
    for (const spec of specs) data.items.add(new File([spec.text], spec.name, { type: "text/markdown" }));
    return data;
  }, files);
  await page.locator(target).dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
}

/** The reader's document tabs (S3). A dirty tab's text ends with ", unsaved changes". */
export const documentTabs = (page: Page) => page.locator('#shell-tabs [role="tab"]');

/** Select a document tab by its label (a leading "• " dirty mark is ignored). */
export async function selectDocument(page: Page, label: string): Promise<void> {
  const name = label.replace(/^• /, "");
  await page.locator("#shell-tabs").getByText(name, { exact: true }).click();
}

/** Run a More-menu item by its visible title. */
export async function moreMenu(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menu", { name: "More" }).getByText(title, { exact: true }).click();
}

/** The paginated workspace: More → Export PDF… (also Ctrl+Shift+E and the palette). */
export async function openPdf(page: Page): Promise<void> {
  await moreMenu(page, "Export PDF…");
}

/** Open the left panel on its Outline tab. */
export async function showOutline(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Library and outline", exact: true });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const tab = page.locator("#shell-panel").getByRole("tab", { name: "Outline", exact: true });
  await tab.click();
  await expect(page.locator("#reader-outline")).toBeVisible();
}
