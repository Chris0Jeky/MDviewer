import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

// TECH-1: with a document loaded on a phone viewport, the primary toolbar row must
// stay a compact strip instead of wrapping into half the screen, while every
// control stays reachable and the page never scrolls sideways.
const DOC = [
  "# Phone toolbar",
  "",
  "A paragraph of research notes. ".repeat(20),
  "",
  "```ts",
  "const answer: number = 42;",
  "```",
  "",
  "| A | B |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "> [!note] A callout block.",
  "",
  "## Second section",
  "",
  "More text. ".repeat(40),
].join("\n");

test("phone toolbar stays compact with a document loaded", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await loadMarkdownIntoApp(page, DOC, "phone.md");
  expect(await waitForPagination(page)).toBeGreaterThan(0);

  // No sideways page scroll at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    375,
  );

  // The toolbar must leave the preview usable: pre-fix it measured 347px tall
  // with a 320px workspace on this viewport.
  expect(
    await page.locator("#toolbar").evaluate((el) => (el as HTMLElement).offsetHeight),
  ).toBeLessThanOrEqual(260);
  expect(
    await page.locator("#workspace").evaluate((el) => (el as HTMLElement).clientHeight),
  ).toBeGreaterThanOrEqual(400);
  await expect(page.locator(".workspace-formatting")).not.toHaveAttribute("open");

  // A mid-strip control stays operable: reaching the View group and switching
  // to Preview-only must hand the freed space to the canvas.
  const previewMode = page.getByRole("button", { name: "Preview", exact: true });
  await previewMode.scrollIntoViewIfNeeded();
  await previewMode.click();
  expect(
    await page.locator("#canvas").evaluate((el) => (el as HTMLElement).clientHeight),
  ).toBeGreaterThanOrEqual(400);

  // Every primary control stays reachable through the strip: scrolling it into
  // view must land its box inside the toolbar without moving the page sideways.
  for (const name of ["Print / Save as PDF", "Download PDF"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeEnabled();
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    const inside = await button.evaluate((btn) => {
      const toolbar = document.getElementById("toolbar")!.getBoundingClientRect();
      const box = btn.getBoundingClientRect();
      return box.left >= toolbar.left - 1 && box.right <= toolbar.right + 1;
    });
    expect(inside).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    375,
  );
  await page.screenshot({ path: test.info().outputPath("toolbar-375.png") });
});

test("tablet toolbar keeps full-width controls without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await loadMarkdownIntoApp(page, DOC, "tablet.md");
  expect(await waitForPagination(page)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    768,
  );
  await expect(page.getByRole("button", { name: "Print / Save as PDF", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("toolbar-768.png") });
});
