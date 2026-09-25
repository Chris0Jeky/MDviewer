import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

test("keeps document identity and source saving available after opening", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Saved source\n\nOriginal.", "notes.md");
  await waitForPagination(page);
  await expect(page.getByRole("button", { name: "Open Markdown", exact: true })).toBeVisible();
  await expect(page.getByLabel("Active document")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("workspace-desktop.png") });
  const source = "# Latest edit\n\nUnicode: café → λ\n";
  await page.locator("#editor-input").fill(source);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save Markdown", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("notes.md");
  expect(await readFile((await download.path())!, "utf8")).toBe(source);
});

test("layout disclosure returns focus on Escape without discarding settings", async ({ page }) => {
  await page.goto("/");
  const details = page.locator(".workspace-formatting");
  await details.locator("summary").click();
  await details.locator("summary").click();
  await page.getByLabel("Running header text").fill("Research notes");
  await page.getByLabel("Running header text").press("Escape");
  await expect(details).not.toHaveAttribute("open");
  await expect(details.locator("summary")).toBeFocused();
  await details.locator("summary").click();
  await expect(page.getByLabel("Running header text")).toHaveValue("Research notes");
});

test("half-size preview has no unscaled scroll tail and keeps sheet layout intact", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, Array.from({ length: 25 }, (_, i) => `## Section ${i}\n\n${"A paragraph of research notes. ".repeat(30)}\n`).join("\n"));
  await waitForPagination(page);
  const natural = await page.locator(".pagedjs_page").first().evaluate((el) => (el as HTMLElement).offsetHeight);
  await page.getByRole("button", { name: "50%", exact: true }).click();
  await expect.poll(() => page.locator("#canvas").evaluate((canvas) => {
    const stack = canvas.querySelector(".pagedjs_pages")!;
    return canvas.scrollHeight - Math.max(canvas.clientHeight, stack.getBoundingClientRect().height);
  })).toBeLessThanOrEqual(2);
  expect(await page.locator(".pagedjs_page").first().evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(natural);
  await page.emulateMedia({ media: "print" });
  const host = await page.locator("#paged-output").evaluate((el) => ({ height: (el as HTMLElement).offsetHeight, stack: el.querySelector<HTMLElement>(".pagedjs_pages")!.offsetHeight }));
  expect(host.height).toBeGreaterThanOrEqual(host.stack);
});

for (const width of [320, 390, 760]) {
  test(`keeps phone controls reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator(".workspace-formatting")).not.toHaveAttribute("open");
    await expect(page.getByRole("button", { name: "Open Markdown", exact: true })).toBeVisible();
    expect(await page.locator("#toolbar").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.locator("#canvas").evaluate((el) => el.clientHeight)).toBeGreaterThan(250);
    await page.screenshot({ path: test.info().outputPath(`workspace-${width}.png`) });
  });
}


test("full-size sheets remain horizontally reachable on a narrow preview", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Wide page\n\nBoth page edges must stay reachable.");
  await waitForPagination(page);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "100%", exact: true }).click();
  await expect.poll(() => page.locator("#canvas").evaluate((canvas) => {
    const sheet = canvas.querySelector(".pagedjs_page")!;
    return canvas.scrollWidth - sheet.getBoundingClientRect().width;
  })).toBeGreaterThanOrEqual(0);
  await page.locator("#canvas").evaluate((canvas) => { canvas.scrollLeft = canvas.scrollWidth; });
  await expect.poll(() => page.locator("#canvas").evaluate((canvas) => {
    return canvas.querySelector(".pagedjs_page")!.getBoundingClientRect().right - canvas.getBoundingClientRect().right;
  })).toBeLessThanOrEqual(1);
});
