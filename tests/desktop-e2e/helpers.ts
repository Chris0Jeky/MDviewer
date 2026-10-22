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
  audit: [async ({ page }, use) => {
    const audit: Audit = { requests: [], external: [], errors: [], allowedCsp: [] };
    page.on("request", request => audit.requests.push(request.url()));
    page.on("pageerror", error => audit.errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== "http://127.0.0.1:5183") {
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

export async function openFiles(page: Page, files: Array<{ name: string; text: string }>): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await chooser).setFiles(files.map(file => ({ name: file.name, mimeType: "text/markdown", buffer: Buffer.from(file.text) })));
}

export async function readyReader(page: Page, heading: string): Promise<void> {
  await expect(page.locator("#reader-document")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#reader-document h1")).toHaveText(heading);
  await expect(page.locator("#reader-shell > footer #reader-status")).toContainText("Reading view");
}

export async function readyWorkspace(page: Page, text: string): Promise<void> {
  await expect(page.locator("#desktop-workspace")).toBeVisible();
  await expect(page.locator("#editor-input")).toHaveValue(text);
  await expect(page.locator("#paged-output .pagedjs_page").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".is-paginating")).toHaveCount(0);
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
