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

/**
 * The skip link is the first child of <body>, so the first Tab exposes the bypass
 * control even when the production bar inserts focusable buttons into the
 * placeholder. The SDK is inert off-origin, so this simulates its buttons.
 */
test("skip link precedes simulated bar buttons in tab order", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-pulseboard-bar]").evaluate((el) => {
    el.removeAttribute("hidden");
    (el as HTMLElement).style.minHeight = "2.5rem";
    el.innerHTML = `<button type="button">Choose</button><button type="button">OK</button>`;
  });
  // Start from a known unfocused state: the app may focus a control after boot.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-pulseboard-bar] button").first()).toBeFocused();
});
