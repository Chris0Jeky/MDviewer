import { readFile } from "node:fs/promises";
import { test, expect, documentTabs, openFiles, openPdf, readyWorkspace } from "./helpers";

/** Readable data (D3; docs/design/READABLE_DATA.md). Every fixture here is invented. */
const CONFIG = JSON.stringify({
  name: "demo-service", port: 8080, debug: false,
  owners: [{ name: "Ada", role: "lead" }, { name: "Lin", role: "ops" }],
  limits: { requests: 100, burst: 20 },
}, null, 2) + "\n";

const doc = (page: import("@playwright/test").Page) => page.locator("#reader-document");
async function ready(page: import("@playwright/test").Page): Promise<void> {
  await expect(doc(page)).toHaveAttribute("aria-busy", "false");
}

test("a JSON file opens as its readable view: title, overview, tables and sections", async ({ page }) => {
  await openFiles(page, [{ name: "service.json", text: CONFIG }]);
  await ready(page);
  await expect(doc(page).locator("h1")).toHaveText("service.json");
  await expect(doc(page)).toContainText("object with 5 keys");
  await expect(doc(page).locator("table").first()).toContainText("demo-service");
  await expect(doc(page).locator("table").first()).toContainText("8080");
  await expect(doc(page).getByRole("heading", { name: "owners" })).toBeVisible();
  await expect(doc(page).getByRole("heading", { name: "limits" })).toBeVisible();
  await expect(page.locator("#reader-status")).toContainText("JSON ·");
  // Data cannot create controls: no checkbox, no front matter card.
  await expect(doc(page).getByRole("checkbox")).toHaveCount(0);
  await expect(doc(page).locator(".reader-properties")).toHaveCount(0);
});

test("an invalid JSON file names the problem with line and column, then shows the raw text", async ({ page }) => {
  const broken = '{\n  "name": "demo",\n  "port": 80 80\n}\n';
  await openFiles(page, [{ name: "broken.json", text: broken }]);
  await ready(page);
  await expect(doc(page)).toContainText(/Line 3, column \d+/);
  await expect(doc(page).locator("pre").last()).toContainText('"port": 80 80');
});

test("JSON Lines renders one section per record", async ({ page }) => {
  const lines = ['{"event":"start","at":1}', '{"event":"stop","at":2}', ""].join("\n");
  await openFiles(page, [{ name: "events.jsonl", text: lines }]);
  await ready(page);
  await expect(doc(page)).toContainText("2 records");
  await expect(doc(page).getByRole("heading", { name: /Record 1/ })).toBeVisible();
  await expect(doc(page).getByRole("heading", { name: /Record 2/ })).toBeVisible();
  await expect(page.locator("#reader-status")).toContainText("JSON Lines ·");
});

test("plain text stays literal, never Markdown", async ({ page }) => {
  const text = "# not a heading\n- [ ] not a task\n    indented line\n// [!code highlight]\n";
  await openFiles(page, [{ name: "notes.txt", text }]);
  await ready(page);
  await expect(doc(page).locator("h1")).toHaveText("notes.txt");
  await expect(doc(page).locator("h2, h3")).toHaveCount(0);
  await expect(doc(page).getByRole("checkbox")).toHaveCount(0);
  await expect(doc(page).locator("pre")).toContainText("# not a heading");
  expect(await doc(page).locator("pre").innerText()).toContain("    indented line");
  // Notation directives stay text: nothing is highlighted or removed.
  await expect(doc(page).locator("pre")).toContainText("// [!code highlight]");
  await expect(doc(page).locator(".highlighted")).toHaveCount(0);
  await expect(page.locator("#reader-status")).toContainText("Plain text ·");
});

test("Edit shows the raw text, the preview follows typing, and an unedited save keeps the bytes", async ({ page }) => {
  await openFiles(page, [{ name: "service.json", text: CONFIG }]);
  await ready(page);
  // Saving the untouched data document writes its raw text, byte for byte.
  const saving = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("service.json");
  expect(await readFile((await saved.path())!, "utf8")).toBe(CONFIG);

  await page.keyboard.press("Control+e");
  const edit = page.locator("#reader-edit #editor-input");
  await expect(edit).toBeFocused();
  await expect(edit).toHaveValue(CONFIG);
  await edit.evaluate(input => {
    const area = input as HTMLTextAreaElement;
    const at = area.value.indexOf("demo-service");
    area.setSelectionRange(at, at + "demo-service".length);
  });
  await page.keyboard.insertText("renamed-service");
  await expect(doc(page).locator("table").first()).toContainText("renamed-service");
  await expect(documentTabs(page)).toHaveText(["service.json, unsaved changes"]);
});

test("a cut-short view offers the next part and Show all", async ({ page }) => {
  const records = Array.from({ length: 1200 }, (_, index) => JSON.stringify({ n: index })).join("\n");
  await openFiles(page, [{ name: "many.jsonl", text: records }]);
  await ready(page);
  await expect(doc(page)).toContainText("Showing 500 of 1,200 records.");
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await ready(page);
  await expect(doc(page)).toContainText("Showing 1,000 of 1,200 records.");
  await page.getByRole("button", { name: "Show all", exact: true }).click();
  await ready(page);
  await expect(doc(page).getByRole("heading", { name: /Record 1200/ })).toBeAttached();
  await expect(page.getByRole("button", { name: "Show all", exact: true })).toHaveCount(0);
});

test("Export PDF paginates the readable view", async ({ page }) => {
  await openFiles(page, [{ name: "service.json", text: CONFIG }]);
  await ready(page);
  await openPdf(page);
  await readyWorkspace(page, CONFIG);
  await expect(page.locator("#paged-output .pagedjs_page").first()).toBeVisible();
  await expect(page.locator("#paged-output")).toContainText("demo-service");
  await expect(page.locator("#paged-output table").first()).toBeVisible();
  // The workspace edits the raw source.
  await expect(page.locator("#editor-input")).toHaveValue(CONFIG);
});
