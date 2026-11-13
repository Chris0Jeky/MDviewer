import { readFile } from "node:fs/promises";
import { test, expect, documentTabs, openFiles, openPdf, readyWorkspace, selectDocument } from "./helpers";

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
  // A small object reads inline in the key/value table (D6).
  await expect(doc(page).locator("table").first()).toContainText("requests: 100 · burst: 20");
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

test("JSON Lines of flat records renders as one table, a row per record", async ({ page }) => {
  const lines = ['{"event":"start","at":1}', '{"event":"stop","at":2}', ""].join("\n");
  await openFiles(page, [{ name: "events.jsonl", text: lines }]);
  await ready(page);
  await expect(doc(page)).toContainText("2 records");
  const rows = doc(page).locator("table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("start");
  await expect(rows.nth(1)).toContainText("stop");
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
  // Flat records read as one table (D6): the last record is its last row.
  await expect(doc(page).locator("table tbody tr").last()).toContainText("1199");
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

test("a transcript-shaped JSON Lines file reads as a conversation", async ({ page }) => {
  const chat = [
    JSON.stringify({ role: "user", content: "Please list the files." }),
    JSON.stringify({ role: "assistant", content: "Here are **two** files." }),
  ].join("\n");
  await openFiles(page, [{ name: "chat.jsonl", text: chat }]);
  await ready(page);
  await expect(doc(page)).toContainText("2 turns: 1 user, 1 assistant");
  await expect(doc(page).getByRole("heading", { name: /^User/ })).toBeVisible();
  await expect(doc(page).getByRole("heading", { name: /^Assistant/ })).toBeVisible();
  // Message text is rendered as Markdown.
  await expect(doc(page).locator("strong", { hasText: "two" })).toBeVisible();
});

test("YAML, TOML and CSV open as readable views (D4)", async ({ page }) => {
  await openFiles(page, [
    { name: "config.yaml", text: "name: demo-service\nport: 8080\nowners:\n  - Ada\n  - Lin\n" },
    { name: "app.toml", text: 'title = "demo"\n[server]\nport = 9090\n' },
    { name: "people.csv", text: "name,role\nAda,lead\nLin,ops\n" },
  ]);
  await ready(page);
  await expect(doc(page).locator("h1")).toHaveText("config.yaml");
  await expect(doc(page)).toContainText("demo-service");
  await expect(page.locator("#reader-status")).toContainText("YAML ·");
  await selectDocument(page, "app.toml");
  await ready(page);
  await expect(doc(page)).toContainText("9090");
  await expect(page.locator("#reader-status")).toContainText("TOML ·");
  await selectDocument(page, "people.csv");
  await ready(page);
  await expect(doc(page).locator("table").first()).toContainText("Ada");
  await expect(doc(page).locator("table").first()).toContainText("ops");
  await expect(page.locator("#reader-status")).toContainText("CSV ·");
});

/** Invented wide records: 14 columns, long prose, one 64-character token (#301). */
function wideRecords(): string {
  return Array.from({ length: 6 }, (_, index) => JSON.stringify({
    id: `rec-${1000 + index}`, customer_name: "Maria Gonzalez-Fernandez", email_address: `person${index}@example.test`,
    region: "north-west", status: "pending review", plan_tier: "enterprise", created_at: "2026-01-10T08:30:00Z",
    seats: 3 + index, monthly_total: "19.50", currency: "EUR",
    notes: "Requested an invoice copy and asked about the upcoming change to the billing cycle; follow up next week.",
    checksum: "ab12cd34ef56".repeat(5) + "ab12", tags: ["alpha", "beta"], owner: "ops",
  })).join("\n") + "\n";
}

for (const width of [1280, 600]) {
  test(`a wide record table scrolls inside its own box at ${width} px; the card and the page do not (#301)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFiles(page, [{ name: "wide.jsonl", text: wideRecords() }]);
    await ready(page);
    const box = doc(page).locator(".reader-table").first();
    const measure = await box.evaluate(wrapper => {
      const table = wrapper.querySelector("table")!;
      const card = document.getElementById("reader-document")!.getBoundingClientRect();
      const scroller = document.querySelector<HTMLElement>(".reader-scroll")!;
      const root = document.scrollingElement!;
      return {
        columns: table.querySelectorAll("thead th").length,
        scrolls: wrapper.scrollWidth > wrapper.clientWidth + 1,
        boxRight: wrapper.getBoundingClientRect().right, cardRight: card.right,
        pageOverflow: root.scrollWidth - root.clientWidth,
        readerOverflow: scroller.scrollWidth - scroller.clientWidth,
        narrowestHeader: Math.min(...[...table.querySelectorAll("thead th")].map(cell => cell.getBoundingClientRect().width)),
      };
    });
    expect(measure.columns).toBeGreaterThanOrEqual(14);
    expect(measure.scrolls, "the table is wider than its box, so the box scrolls").toBe(true);
    expect(measure.boxRight).toBeLessThanOrEqual(measure.cardRight);
    expect(measure.pageOverflow).toBeLessThanOrEqual(0);
    expect(measure.readerOverflow).toBeLessThanOrEqual(0);
    // Columns keep a readable width: no header is squeezed into a few letters per line.
    expect(measure.narrowestHeader).toBeGreaterThan(40);
    // Every column can be reached by scrolling the box.
    await box.evaluate(wrapper => { wrapper.scrollLeft = wrapper.scrollWidth; });
    await expect(box.locator("thead th").last()).toBeInViewport();
  });
}

test("a wide record table exports to PDF whole and inside the page width (#301)", async ({ page }) => {
  const text = wideRecords();
  await openFiles(page, [{ name: "wide.jsonl", text }]);
  await ready(page);
  await openPdf(page);
  await readyWorkspace(page, text);
  const fit = await page.locator("#paged-output").evaluate(host => {
    const bad: string[] = [];
    let cells = 0;
    for (const cell of host.querySelectorAll<HTMLElement>("td, th")) {
      const area = cell.closest(".pagedjs_page")!.querySelector(".pagedjs_page_content")!.getBoundingClientRect();
      const rect = cell.getBoundingClientRect();
      cells += 1;
      if (rect.left < area.left - 2 || rect.right > area.right + 2 || cell.scrollWidth > cell.clientWidth + 2) bad.push(cell.textContent ?? "");
    }
    return { bad, cells, rows: host.querySelectorAll("tbody tr").length };
  });
  expect(fit.cells).toBeGreaterThan(14 * 6);
  expect(fit.bad).toEqual([]);
  expect(fit.rows).toBe(6);
});

test("a conversation with collapsed tool calls exports to PDF (#301)", async ({ page }) => {
  // A closed <details> at the foot of the page used to fail the pagination audit.
  const chat = [
    { role: "user", timestamp: "2026-11-10T09:00:00Z", content: "Please summarise the **quarterly** report and list the three biggest risks." },
    { role: "assistant", timestamp: "2026-11-10T09:00:04Z", content: [
      { type: "text", text: "Here is the summary.\n\n| Risk | Likelihood | Impact |\n| --- | --- | --- |\n| Supplier delay | high | medium |\n| Currency swing | medium | high |" },
      { type: "tool_use", id: "t1", name: "read_file", input: { path: "reports/q3.txt", limit: 200 } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Q3 revenue grew by 12 percent; supplier delays were noted in the August review." }] },
    { role: "assistant", content: "Done. Three risks: supply, currency, staffing." },
  ].map(record => JSON.stringify(record)).join("\n") + "\n";
  await openFiles(page, [{ name: "chat.jsonl", text: chat }]);
  await ready(page);
  await openPdf(page);
  await readyWorkspace(page, chat);
  await expect(page.locator("#paged-output")).toContainText("Done. Three risks");
  await expect(page.getByText("Something went wrong")).toBeHidden();
});
