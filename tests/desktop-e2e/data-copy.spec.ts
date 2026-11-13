import { readFile } from "node:fs/promises";
import { test, expect, documentTabs, moreMenu, openFiles, readyReader, saveCopy } from "./helpers";

/** Readable data D5: copy a value, a path or a subtree, and save the readable view. Invented fixtures. */
const SERVICE = JSON.stringify({
  name: "demo-service", "odd key": "v1",
  owners: [{ name: "Ada", role: "lead" }, { name: "Lin", role: "ops" }],
}, null, 2) + "\n";
const EVENTS = '{"event":"start","at":1}\n{"event":"stop","at":2}\n';
const APP_YAML = "name: demo\nports:\n  - 80\n  - 443\n";
const PEOPLE = "name,age\nAda,36\nLin,41\n";

declare global { interface Window { __copied: string[] } }

// Assert what the app writes, not the OS clipboard (machine-wide state on a Windows host).
test.beforeEach(async ({ page }) => {
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = async text => { window.__copied.push(text); };
  });
});

const written = (page: import("@playwright/test").Page): Promise<string[]> => page.evaluate(() => window.__copied);
const doc = (page: import("@playwright/test").Page) => page.locator("#reader-document");

/** Click a cell as a reader does: the selection lands there. */
async function pick(page: import("@playwright/test").Page, text: string): Promise<void> {
  await doc(page).getByRole("cell", { name: text, exact: true }).first().click();
}

test("JSON: value, both path forms and a subtree, from the More menu", async ({ page }) => {
  await openFiles(page, [{ name: "service.json", text: SERVICE }]);
  await readyReader(page, "service.json");

  await pick(page, "demo-service");
  await moreMenu(page, "Copy value");
  await pick(page, "odd key");
  await moreMenu(page, "Copy path (JSONPath)");
  await moreMenu(page, "Copy path (jq)");
  // A cell of a flattened table names its row.
  await pick(page, "Lin");
  await moreMenu(page, "Copy path (JSONPath)");
  await moreMenu(page, "Copy path (jq)");
  await moreMenu(page, "Copy subtree as JSON");
  await moreMenu(page, "Copy value");
  expect(await written(page)).toEqual([
    "demo-service",
    '$["odd key"]', '.["odd key"]',
    "$.owners[1]", ".owners[1]",
    '{\n  "name": "Lin",\n  "role": "ops"\n}', '{\n  "name": "Lin",\n  "role": "ops"\n}',
  ]);
  // Copying never makes the open document differ from its file.
  await expect(documentTabs(page)).toHaveText(["service.json"]);
  await expect(doc(page).getByRole("checkbox")).toHaveCount(0);
  await expect(doc(page).locator(".reader-properties")).toHaveCount(0);
});

test("the copy items are commands: the palette copies, and a copied reference names the value path", async ({ page }) => {
  await openFiles(page, [{ name: "service.json", text: SERVICE }]);
  await readyReader(page, "service.json");
  await pick(page, "Ada");
  const palette = async (title: string): Promise<void> => {
    await page.keyboard.press("Control+k");
    const input = page.getByRole("combobox", { name: "Search commands and files" });
    await input.fill(title);
    await page.keyboard.press("Enter");
    await expect(input).toHaveCount(0);
  };
  await palette("Copy path (jq)");
  await palette("Copy reference");
  expect(await written(page)).toEqual([".owners[0]", "service.json#$.owners[0]"]);
});

test("JSON Lines: a record's path, and jq reads the slurped array", async ({ page }) => {
  await openFiles(page, [{ name: "events.jsonl", text: EVENTS }]);
  await readyReader(page, "events.jsonl");
  await pick(page, "stop");
  await moreMenu(page, "Copy path (JSONPath)");
  await moreMenu(page, "Copy path (jq)");
  await expect(page.locator("#reader-notice")).toContainText("jq -s");
  await moreMenu(page, "Copy subtree as JSON");
  expect(await written(page)).toEqual(["$[1]", ".[1]", '{\n  "event": "stop",\n  "at": 2\n}']);
});

test("YAML: a key row copies its list", async ({ page }) => {
  await openFiles(page, [{ name: "app.yaml", text: APP_YAML }]);
  await readyReader(page, "app.yaml");
  await pick(page, "ports");
  await moreMenu(page, "Copy path (JSONPath)");
  await moreMenu(page, "Copy subtree as JSON");
  await moreMenu(page, "Copy value");
  expect(await written(page)).toEqual(["$.ports", "[\n  80,\n  443\n]", "[\n  80,\n  443\n]"]);
});

test("CSV: a cell copies its row", async ({ page }) => {
  await openFiles(page, [{ name: "people.csv", text: PEOPLE }]);
  await readyReader(page, "people.csv");
  await pick(page, "41");
  await moreMenu(page, "Copy path (JSONPath)");
  await moreMenu(page, "Copy subtree as JSON");
  expect(await written(page)).toEqual(["$[1]", '{\n  "name": "Lin",\n  "age": "41"\n}']);
});

test("the copy items belong to data documents only", async ({ page }) => {
  await openFiles(page, [{ name: "service.json", text: SERVICE }, { name: "note.md", text: "# Note\n\nText.\n" }]);
  await readyReader(page, "service.json");
  await page.getByRole("button", { name: "More", exact: true }).click();
  const menu = page.getByRole("menu", { name: "More" });
  for (const title of ["Copy value", "Copy path (JSONPath)", "Copy path (jq)", "Copy subtree as JSON", "Save readable view as Markdown…"]) {
    await expect(menu.getByRole("menuitem", { name: title })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await page.locator("#shell-tabs").getByText("note.md", { exact: true }).click();
  await readyReader(page, "Note");
  await page.getByRole("button", { name: "More", exact: true }).click();
  for (const title of ["Copy value", "Copy path (JSONPath)", "Copy path (jq)", "Copy subtree as JSON", "Save readable view as Markdown…"]) {
    await expect(menu.getByRole("menuitem", { name: title })).toBeHidden();
  }
  await expect(menu.getByRole("menuitem", { name: "Save a copy…" })).toBeVisible();
});

test("Save readable view as Markdown writes the render text and leaves the document alone", async ({ page }) => {
  await openFiles(page, [{ name: "people.csv", text: PEOPLE }]);
  await readyReader(page, "people.csv");
  const saving = page.waitForEvent("download");
  await moreMenu(page, "Save readable view as Markdown…");
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("people.readable.md");
  expect(await readFile((await saved.path())!, "utf8")).toBe(
    "# people\\.csv\nCSV · 23 B · 2 rows, 2 columns\n\n| name | age |\n| --- | ---: |\n| Ada | 36 |\n| Lin | 41 |\n");
  // The open document is unchanged: not dirty, and Save still writes the raw CSV under its own name.
  await expect(documentTabs(page)).toHaveText(["people.csv"]);
  const raw = page.waitForEvent("download");
  await saveCopy(page, page.locator("body"));
  const rawSaved = await raw;
  expect(rawSaved.suggestedFilename()).toBe("people.csv");
  expect(await readFile((await rawSaved.path())!, "utf8")).toBe(PEOPLE);
});

test("the readable view of JSON saves as Markdown with its tables", async ({ page }) => {
  await openFiles(page, [{ name: "service.json", text: SERVICE }]);
  await readyReader(page, "service.json");
  const saving = page.waitForEvent("download");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands and files" }).fill("Save readable view");
  await page.keyboard.press("Enter");
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("service.readable.md");
  const text = await readFile((await saved.path())!, "utf8");
  expect(text).toContain("# service\\.json\n");
  expect(text).toContain("| name | demo\\-service |");
  expect(text).not.toContain('"owners"');
});
