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

/**
 * The Beta pill renders inline in the session strip ([data-pulseboard-slot]) instead of
 * floating bottom-left over the editor and the page chip. The SDK is inert off-origin, so
 * this simulates its pill and panel exactly as it appends them (element.style, no classes
 * of ours) and checks the host CSS places them in the strip, in view, and out of print.
 */
test("the Beta pill and panel render inside the session strip, never over the canvas", async ({ page }) => {
  await page.goto("/");
  const slot = page.locator(".workspace-session [data-pulseboard-slot]");
  await expect(slot).toHaveCount(1);
  expect(await slot.evaluate((el) => el.childElementCount)).toBe(0);
  await slot.evaluate((el) => {
    const pill = document.createElement("button");
    pill.className = "pb-pill";
    pill.type = "button";
    pill.textContent = "Beta";
    const panel = document.createElement("div");
    panel.className = "pb-panel";
    Object.assign(panel.style, { maxWidth: "320px", marginTop: "6px", padding: "10px 12px" });
    panel.textContent = "Beta — choose what MDviewer may collect.";
    el.append(pill, panel);
  });
  const strip = await page.locator(".workspace-session").boundingBox();
  const pill = await page.locator(".pb-pill").boundingBox();
  const panel = await page.locator(".pb-panel").boundingBox();
  const canvas = await page.locator("#canvas").boundingBox();
  expect(pill && strip && pill.y >= strip.y && pill.y + pill.height <= strip.y + strip.height).toBe(true);
  // The panel wraps onto its own row inside the strip, below the pill, above the canvas.
  expect(panel && pill && panel.y >= pill.y + pill.height).toBe(true);
  expect(panel && strip && panel.y + panel.height <= strip.y + strip.height + 0.5).toBe(true);
  expect(panel && canvas && panel.y + panel.height <= canvas.y + 0.5).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".pb-pill")).toBeHidden();
  await expect(page.locator(".pb-panel")).toBeHidden();
});
