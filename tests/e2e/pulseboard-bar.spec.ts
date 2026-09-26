import { test, expect } from "@playwright/test";

/**
 * The documented content-blocker opt-out (README "How to turn it off") must leave
 * MDviewer working unchanged: when /pulseboard.js never loads, the SDK can't run
 * its own placeholder release, so the script's onerror fallback releases it and
 * #app keeps the full viewport height instead of a dead 2.5rem strip.
 */
test("a blocked SDK releases the bar placeholder and keeps full-height #app", async ({
  page,
}) => {
  await page.route("**/pulseboard.js", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("[data-pulseboard-bar]")).toBeHidden();
  await expect(page.locator("#empty-state")).toBeVisible();
  const viewport = page.viewportSize()!;
  const appHeight = await page
    .locator("#app")
    .evaluate((el) => (el as HTMLElement).offsetHeight);
  expect(appHeight).toBeGreaterThanOrEqual(viewport.height - 1);
});
