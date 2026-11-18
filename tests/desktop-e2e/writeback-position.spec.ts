import type { Page } from "@playwright/test";
import { installFakeHost } from "./fakeHost";
import { test, expect, openFiles, readyReader } from "./helpers";

/**
 * Actionable Markdown write-back keeps the reader where it is (#334) and makes Undo easy to reach
 * (#335): a toggle in the middle of a long document must not move the scroll offset, the Undo notice
 * must be inside the viewport, and Ctrl+Z in the reader undoes the last write-back. Invented text.
 */
const filler = (from: number, count: number): string =>
  Array.from({ length: count }, (_, i) => `## Section ${from + i}\n\nParagraph ${from + i} of invented text, long enough to wrap once or twice in the reader at its default width.\n`).join("\n");
// A diagram and code above the task: their upgrade after the first paint changes the layout above.
const ABOVE = "```mermaid\ngraph TD\n  A[Start] --> B[Middle]\n  B --> C[End]\n  C --> D[After]\n```\n\n```ts\nconst one = 1;\nconst two = 2;\nconst three = one + two;\n```\n";
const LONG = `# Long\n\n${ABOVE}\n${filler(1, 30)}\n- [ ] middle task\n- ( ) small\n- ( ) large\n\nreviewer::\n\n${filler(31, 30)}`;

const scroller = (page: Page) => page.locator("#reader-scroll");
const offset = (page: Page): Promise<number> => scroller(page).evaluate(node => node.scrollTop);

/** Scroll so the task sits in the middle of the viewport, then let the reader settle. */
async function centreTask(page: Page): Promise<number> {
  await page.getByRole("checkbox", { name: /middle task/ }).evaluate(node => node.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  const top = await offset(page);
  expect(top, "the document is long enough to scroll").toBeGreaterThan(500);
  return top;
}

async function expectStill(page: Page, top: number): Promise<void> {
  await readyReader(page, "Long");
  await page.waitForTimeout(300); // let late upgrades and focus settle
  expect(Math.abs(await offset(page) - top)).toBeLessThanOrEqual(1);
}

test("in memory: a toggle, a choice and a field keep the scroll offset (#334)", async ({ page }) => {
  await page.goto("/desktop.html");
  await openFiles(page, [{ name: "long.md", text: LONG }]);
  await readyReader(page, "Long");
  const top = await centreTask(page);
  await page.getByRole("checkbox", { name: /middle task/ }).click();
  await expectStill(page, top);
  await page.getByRole("radio", { name: /large/i }).click();
  await expectStill(page, top);
  await page.getByRole("button", { name: "Edit reviewer: empty" }).click();
  await page.keyboard.type("Lin");
  await page.keyboard.press("Enter");
  await expectStill(page, top);
});

test.describe("bound file (native line patch)", () => {
  test.beforeEach(async ({ page }) => { await installFakeHost(page, { pending: [["long.md", LONG]] }); });

  test("a toggle and its Undo keep the scroll offset; Undo is in view and Ctrl+Z reverts the bytes (#334, #335)", async ({ page }) => {
    await page.goto("/desktop.html");
    await readyReader(page, "Long");
    const top = await centreTask(page);
    await page.getByRole("checkbox", { name: /middle task/ }).click();
    const undo = page.locator(".am-notice").getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    await expectStill(page, top);
    expect(await page.evaluate(() => Object.values(window.__fake.files)[0])).toContain("- [x] middle task");

    // The notice is inside the viewport and announced.
    const box = (await page.locator(".am-notice").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.locator(".am-notice")).toHaveAttribute("role", "status");

    // Ctrl+Z in the reader undoes the last write-back; the file bytes return exactly.
    await page.keyboard.press("Control+Z");
    await expect.poll(() => page.evaluate(() => Object.values(window.__fake.files)[0])).toBe(LONG);
    await expectStill(page, top);
    await expect(page.getByRole("checkbox", { name: /middle task \(To do\)/ })).toBeVisible();
  });
});
