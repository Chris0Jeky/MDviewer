import { expect, test, type Page } from "@playwright/test";
import { loadFilesIntoApp } from "../helpers/pagedDom";

// The first lazy Mermaid request is the deterministic preparation gate. A PWA
// precache must not fulfill it before the test owns that request.
test.use({ serviceWorkers: "block" });

async function ready(page: Page, heading: string): Promise<void> {
  await page.waitForFunction(name =>
    document.querySelector("#paged-output .doc h1")?.textContent === name &&
    !document.querySelector(".is-paginating"), heading, { timeout: 30_000 });
}

for (const outcome of ["completed", "failed"] as const) {
  test(`visible preview position survives a ${outcome} held preparation and document switch`, async ({ page }) => {
    await page.goto("/");
    const source = "# Long preview\n\n" + Array.from({ length: 24 }, (_, index) =>
      `## Section ${index}\n\n${"A paragraph for a document position. ".repeat(24)}\n\n`).join("");
    await loadFilesIntoApp(page, [
      { name: "a.md", content: source }, { name: "b.md", content: "# B\n\nSecond document." },
    ]);
    await ready(page, "Long preview");
    const canvas = page.locator("#canvas");
    await canvas.evaluate(el => { el.style.scrollBehavior = "auto"; el.scrollTop = 2000; });
    expect(await canvas.evaluate(el => el.scrollTop)).toBeGreaterThan(1500);
    const oldSheet = await page.locator("#paged-output .pagedjs_page").first().elementHandle();
    let requested = false;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(url => /\/(?:mermaid\.core[^/]*|mermaid)\.js$/.test(url.pathname), async route => {
      requested = true;
      await held;
      if (outcome === "failed") await route.abort("failed");
      else await route.continue();
    });
    try {
      const input = page.locator("#editor-input");
      const edited = source + "\n```mermaid\ngraph TD; A-->B;\n```";
      await input.fill(edited);
      await expect.poll(() => requested, { timeout: 15_000 }).toBe(true);
      expect(await oldSheet!.evaluate(el => el.isConnected)).toBe(true);
      // Capture movement during preparation, not just the coordinates at its start.
      await canvas.evaluate(el => { el.scrollTop = 2400; });
      let saved = await canvas.evaluate(el => el.scrollTop);
      if (outcome === "failed") {
        release();
        await expect(page.locator("#error-card")).toContainText("Render failed:");
        expect(await oldSheet!.evaluate(el => el.isConnected)).toBe(true);
        // Fatal feedback intentionally reveals its card at the canvas origin.
        // Scroll the retained pages afterwards to verify failed-render ownership.
        await expect.poll(() => canvas.evaluate(el => el.scrollTop)).toBe(0);
        await canvas.evaluate(el => { el.scrollTop = 2600; });
        saved = await canvas.evaluate(el => el.scrollTop);
        expect(saved).toBeGreaterThan(2500);
      }
      const picker = page.getByRole("combobox", { name: "Active document", exact: true });
      await picker.selectOption({ label: "b.md" });
      release();
      await ready(page, "B");
      await expect(input).toHaveValue("# B\n\nSecond document.");
      await picker.selectOption({ label: "a.md" });
      await expect(input).toHaveValue(edited);
      // A rejected module stays rejected for this page. Remove the failed diagram
      // before the content debounce to exercise ordinary preparation recovery.
      if (outcome === "failed") await input.fill(source);
      await ready(page, "Long preview");
      await expect.poll(async () => Math.abs(await canvas.evaluate(el => el.scrollTop) - saved)).toBeLessThan(2);
      await expect(input).toHaveValue(outcome === "failed" ? source : edited);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}
