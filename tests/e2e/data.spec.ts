import { test, expect } from "@playwright/test";
import { waitForPagination } from "../helpers/pagedDom";

// Readable data in the web build (D3): a dropped JSON file paginates its readable view and
// the editor keeps the raw text. The fixture is invented.
test("a dropped JSON file shows its readable view and keeps its raw source", async ({ page }) => {
  const raw = JSON.stringify({ name: "demo-service", port: 8080, owners: [{ name: "Ada" }, { name: "Lin" }] }, null, 2);
  await page.goto("/");
  await page.evaluate(text => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "service.json", { type: "application/json" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, raw);
  await waitForPagination(page);
  const output = page.locator("#paged-output");
  await expect(output.locator("h1")).toHaveText("service.json");
  await expect(output.locator("table").first()).toContainText("demo-service");
  await expect(output).toContainText("owners");
  await expect(page.locator("#editor-input")).toHaveValue(raw);
  await expect(page.locator("#warning-banner")).toBeHidden();
});
