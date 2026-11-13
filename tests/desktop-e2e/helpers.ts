import { test as base, expect, type FileChooser, type Page } from "@playwright/test";

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
    await page.goto("/desktop.html");
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    await use(audit);
    expect(audit.external, "desktop must not attempt remote requests").toEqual([]);
    expect(audit.errors, "no uncaught runtime errors").toEqual([]);
    const violations = await page.evaluate(() => window.__desktopEvidence.violations);
    expect(violations.filter(item => !audit.allowedCsp.includes(`${item.directive}:${item.blocked}`)), "render and export must work under the production CSP").toEqual([]);
  }, { auto: true }],
});

export { expect };

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

/** A pick of the given files. Goes through the reader's file input, the element Ctrl+O clicks, so a lost key press cannot time a test out (#303). */
export async function openFiles(page: Page, files: Array<{ name: string; text: string }>): Promise<void> {
  await page.locator("#reader-file-input").setInputFiles(files.map(file => ({ name: file.name, mimeType: "text/markdown", buffer: Buffer.from(file.text) })));
}

/**
 * Drive Ctrl+O itself and return the file chooser it opens. A key press can land
 * before the page's shortcut handler is ready or while a mode change owns the
 * window, and nothing observable says so, so the press is retried until a chooser
 * opens (#303). Ctrl+O works from the empty state, the tabs and the document alike.
 */
export async function chooseWithShortcut(page: Page): Promise<FileChooser> {
  let chooser: FileChooser | undefined;
  await expect(async () => {
    [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5_000 }), page.keyboard.press("Control+o")]);
  }).toPass({ timeout: 45_000 });
  return chooser!;
}

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
