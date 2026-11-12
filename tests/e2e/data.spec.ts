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

test("a cut-short data view offers the rest in the workspace, and plain text stays literal", async ({ page }) => {
  const records = Array.from({ length: 600 }, (_, index) => JSON.stringify({ n: index })).join("\n");
  const text = "keep this line\n// [!code highlight]\nand this one\n";
  await page.goto("/");
  await page.evaluate(([jsonl, plain]) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([jsonl!], "many.jsonl", { type: "" }));
    transfer.items.add(new File([plain!], "notes.txt", { type: "text/plain" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, [records, text]);
  await waitForPagination(page);
  // Plain text: every line kept, notation directives not applied.
  const picker = page.getByRole("combobox", { name: "Active document" });
  await picker.selectOption({ label: "notes.txt" });
  await waitForPagination(page);
  await expect(page.locator("#paged-output pre")).toContainText("// [!code highlight]");
  await expect(page.locator("#paged-output pre")).toContainText("and this one");
  await expect(page.locator("#paged-output .highlighted")).toHaveCount(0);
  // Switch to the JSON Lines document: its view is cut short and the workspace offers the rest.
  await picker.selectOption({ label: "many.jsonl" });
  await waitForPagination(page);
  const offer = page.locator(".canvas-offer");
  await expect(offer).toContainText("This data view was cut short.");
  await expect(page.locator("#paged-output")).toContainText("Showing 500 of 600 records.");
  await offer.getByRole("button", { name: "Show all", exact: true }).click();
  await expect(page.locator("#paged-output")).toContainText("Record 600", { timeout: 30_000 });
  await expect(offer).toBeHidden();
});
