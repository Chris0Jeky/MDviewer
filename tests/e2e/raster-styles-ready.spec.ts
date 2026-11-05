import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

for (const viewMode of ["split", "editor"] as const) {
  test(`failed clone styles save no PDF, release their iframe and permit a retry (${viewMode})`, async ({ page }) => {
    test.skip(process.env.E2E_TARGET !== "preview", "This regression requires linked production CSS, not Vite's injected dev styles.");
    const markdown = "# Capture recovery\n\n" + Array.from({ length: 30 }, (_, index) =>
      `Paragraph ${index + 1}. The source survives a failed stylesheet load without losing the reader's place in the Markdown editor.`,
    ).join("\n\n");
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown);
    await waitForPagination(page);
    await page.getByRole("button", { name: viewMode === "editor" ? "Markdown" : "Split", exact: true }).click();
    const workspace = page.locator("#workspace");
    await expect(workspace).toHaveAttribute("data-view-mode", viewMode);
    const canvas = page.locator("#canvas");
    await canvas.evaluate(element => {
      const root = element as HTMLElement;
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      root.scrollTop = root.scrollHeight;
      root.style.scrollBehavior = behavior;
    });
    await expect.poll(() => canvas.evaluate(element => element.scrollTop - element.clientHeight)).toBeGreaterThan(0);
    const editor = page.locator("#editor-input");
    await editor.evaluate(element => {
      const input = element as HTMLTextAreaElement;
      input.setSelectionRange(12, 29, "forward");
      input.scrollTop = 120;
    });
    const readEditorPosition = () => editor.evaluate(element => {
      const input = element as HTMLTextAreaElement;
      return { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection,
        top: input.scrollTop, left: input.scrollLeft };
    });
    const editorPosition = await readEditorPosition();
    expect(editorPosition.top).toBeGreaterThan(0);
    let downloads = 0;
    let rejectedStyles = 0;
    page.on("download", () => { downloads++; });
    await page.route("**/assets/*.css", async route => {
      if (route.request().frame().parentFrame()) {
        rejectedStyles++;
        await new Promise(resolve => setTimeout(resolve, 350));
        await route.abort("failed");
      } else await route.continue();
    });
    const exportButton = page.getByRole("button", { name: "Download PDF", exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await exportButton.click();
      const errorCard = page.getByRole("alertdialog", { name: "Rendering failed" });
      await expect(errorCard).toBeVisible();
      await expect(errorCard).toContainText("stylesheet could not load. Try Print / Save as PDF.");
      const reload = errorCard.getByRole("button", { name: "Reload", exact: true });
      const viewport = await canvas.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      });
      // Check the actual viewport before trial click/focus can scroll the card into view.
      for (const feedback of [errorCard.locator(".error-message"), reload]) {
        const box = await feedback.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
        });
        expect(box.top).toBeGreaterThanOrEqual(viewport.top);
        expect(box.bottom).toBeLessThanOrEqual(viewport.bottom);
        expect(box.left).toBeGreaterThanOrEqual(viewport.left);
        expect(box.right).toBeLessThanOrEqual(viewport.right);
      }
      // Exercise hit testing without activating the destructive reload action.
      await reload.click({ trial: true });
      await reload.focus();
      await expect(reload).toBeFocused();
      await expect(exportButton).toBeEnabled();
      await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
      await expect(page.locator("#editor-input")).toHaveValue(markdown);
      expect(await readEditorPosition()).toEqual(editorPosition);
      await expect(workspace).toHaveAttribute("data-view-mode", viewMode);
      if (viewMode === "editor") {
        // Only the fatal card is revealed; pagination keeps its hidden, measurable host.
        for (const surface of [page.locator("#canvas"), page.locator("#paged-output .pagedjs_pages")]) {
          await expect(surface).toBeHidden();
          const box = await surface.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          });
          expect(box.width).toBeGreaterThan(0);
          expect(box.height).toBeGreaterThan(0);
        }
      }
      expect(downloads, "a failed stylesheet must not yield a misleading PDF").toBe(0);
    }
    expect(rejectedStyles).toBeGreaterThanOrEqual(2);
    await page.unroute("**/assets/*.css");
    const retry = page.waitForEvent("download");
    await exportButton.click();
    await retry;
    await expect(exportButton).toBeEnabled();
    expect(downloads).toBe(1);
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
    await expect(page.locator("#error-card")).toBeHidden();
    await expect(workspace).toHaveAttribute("data-view-mode", viewMode);
    await expect(page.locator("#editor-input")).toHaveValue(markdown);
    expect(await readEditorPosition()).toEqual(editorPosition);
  });
}
