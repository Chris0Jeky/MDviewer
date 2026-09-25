import { test, expect } from "@playwright/test";
import { waitForPagination } from "../helpers/pagedDom";

for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 600 }, { width: 844, height: 390 }]) {
  test(`welcome heading and keyboard actions are reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const welcome = page.locator("#empty-state");
    await expect(welcome).toBeVisible();
    const canvasBox = (await page.locator("#canvas").boundingBox())!;
    const heading = (await welcome.locator(".empty-title").boundingBox())!;
    expect(heading.y).toBeGreaterThanOrEqual(canvasBox.y);
    expect(await welcome.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath(`welcome-${viewport.width}-${viewport.height}.png`) });

    // Focus must reveal each action even when the card is taller than its pane.
    const choose = welcome.getByRole("button", { name: "Choose file…", exact: true });
    await choose.focus();
    await expect(choose).toBeFocused();
    const picker = page.waitForEvent("filechooser");
    await choose.press("Enter");
    await picker;

    const sample = welcome.getByRole("button", { name: "Try a sample document", exact: true });
    await sample.focus();
    await expect(sample).toBeFocused();
    const button = (await sample.boundingBox())!;
    expect(button.y).toBeGreaterThanOrEqual(canvasBox.y);
    expect(button.y + button.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height + 1);
    await sample.press("Enter");
    expect(await waitForPagination(page)).toBeGreaterThan(0);
    await expect(welcome).toBeHidden();
    await page.emulateMedia({ media: "print" });
    await expect(welcome).toBeHidden();
  });
}
