import { test, expect, type Page } from "@playwright/test";

/**
 * The embedded <mdviewer-reader> (Actionable Markdown A5), loaded from the built bundle into a
 * plain page that knows nothing of MDviewer. The host below does what any host must: record the
 * change events, apply the line patches itself and hand the new text back.
 */
const HOST = `<!doctype html><meta charset="utf-8"><title>Plain host</title>
<script type="module" src="/mdviewer-reader.js"></script>
<mdviewer-reader id="a"></mdviewer-reader>
<mdviewer-reader id="b"></mdviewer-reader>
<script>
  window.events = [];
  window.apply = (id, patches) => {
    const el = document.getElementById(id);
    const lines = el.markdown.split(String.fromCharCode(10));
    for (const patch of patches) {
      if (lines[patch.line - 1] !== patch.expect) throw new Error("stale patch");
      lines[patch.line - 1] = patch.replace;
    }
    el.markdown = lines.join(String.fromCharCode(10));
  };
  for (const id of ["a", "b"]) {
    document.getElementById(id).addEventListener("change", event => window.events.push({ id, detail: JSON.parse(JSON.stringify(event.detail)) }));
  }
</script>`;

const DOC_A = "# Plan\n\n- [ ] first\n- [ ] second\n\n- ( ) small\n- ( ) large\n";
const DOC_B = "# Other\n\n- [ ] only\n\n- ( ) one\n- ( ) two\n";

async function load(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const seen = { external: [] as string[], errors: [] as string[] };
  const origin = "127.0.0.1";
  page.on("pageerror", error => seen.errors.push(error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.hostname !== origin) seen.external.push(request.url());
  });
  await page.route("**/host.html", route => route.fulfill({ contentType: "text/html", body: HOST }));
  await page.goto("/host.html");
  await page.evaluate(([a, b]) => {
    (document.getElementById("a") as HTMLElement & { markdown: string }).markdown = a!;
    (document.getElementById("b") as HTMLElement & { markdown: string }).markdown = b!;
  }, [DOC_A, DOC_B]);
  return seen;
}

const events = (page: Page): Promise<Array<{ id: string; detail: { patches: unknown[] } }>> => page.evaluate(() => (window as never as { events: never[] }).events);

test("a click gives one change event with the exact patches; the host applies them and the element re-renders", async ({ page }) => {
  const seen = await load(page);
  const marks = page.locator("#a").getByRole("checkbox");
  await expect(marks).toHaveCount(2);
  await expect(marks.first()).toHaveAttribute("aria-checked", "false");

  await marks.first().click();
  await expect.poll(async () => (await events(page)).length).toBe(1);
  expect(await events(page)).toEqual([{
    id: "a",
    detail: { patches: [{ line: 3, expect: "- [ ] first", replace: "- [x] first" }] },
  }]);
  // The element never writes: its text and its view are unchanged until the host acts.
  expect(await page.evaluate(() => (document.getElementById("a") as HTMLElement & { markdown: string }).markdown)).toBe(DOC_A);
  await expect(marks.first()).toHaveAttribute("aria-checked", "false");

  await page.evaluate(() => (window as never as { apply(id: string, patches: unknown[]): void }).apply("a",
    (window as never as { events: Array<{ detail: { patches: unknown[] } }> }).events[0]!.detail.patches));
  await expect(marks.first()).toHaveAttribute("aria-checked", "true");
  await expect(marks.nth(1)).toHaveAttribute("aria-checked", "false");
  expect(await events(page)).toHaveLength(1); // re-rendering from the host's text is not a change

  expect(seen.errors).toEqual([]);
  expect(seen.external).toEqual([]);
});

test("code, math and diagrams render inside the shadow root and nothing leaves the origin", async ({ page }) => {
  const seen = await load(page);
  const rich = ["# Rich", "", "```ts", "const x: number = 1;", "```", "", "Square: $x^2$", "", "```mermaid", "graph TD; A-->B;", "```", ""].join(String.fromCharCode(10));
  await page.evaluate(text => { (document.getElementById("b") as HTMLElement & { markdown: string }).markdown = text; }, rich);
  const b = page.locator("#b");
  await expect(b.locator("pre.shiki:not(.reader-pending)")).toHaveCount(1);
  await expect(b.locator(".katex")).toHaveCount(1);
  await expect(b.locator("figure.mermaid-figure svg")).toHaveCount(1);
  // The reader's own stylesheet applies inside the shadow root (paper and text colour from its tokens).
  expect(await b.locator("article").evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await page.evaluate(() => document.querySelectorAll("link[data-mdviewer-reader]").length)).toBe(1);
  expect(seen.errors).toEqual([]);
  expect(seen.external).toEqual([]);
});

test("document HTML cannot cover the host page: fixed positioning stays inside the element", async ({ page }) => {
  await load(page);
  const cover = "<div style=\"position:fixed;top:0;left:0;width:100vw;height:100vh;background:red\">cover</div>";
  await page.evaluate(text => { (document.getElementById("b") as HTMLElement & { markdown: string }).markdown = text; }, cover);
  const b = page.locator("#b");
  // The sanitizer drops fixed positioning (#347); the element's contain: paint stays as a second wall.
  await expect(b.getByText("cover")).toHaveCount(1);
  await expect(b.locator("[style*='fixed']")).toHaveCount(0);
  expect(await page.evaluate(() => document.elementFromPoint(5, 5)?.id ?? "")).not.toBe("b");
});

test("markdown set by the host before the module loads still renders (Codex on #318)", async ({ page }) => {
  const early = `<!doctype html><meta charset="utf-8"><title>Early host</title>
<script type="module" src="/mdviewer-reader.js"></script>
<mdviewer-reader id="early"></mdviewer-reader>
<script>document.getElementById("early").markdown = "# Set early";</script>`;
  await page.route("**/early.html", route => route.fulfill({ contentType: "text/html", body: early }));
  await page.goto("/early.html");
  await expect(page.locator("#early h1")).toHaveText("Set early");
  await page.evaluate(() => { (document.getElementById("early") as HTMLElement & { markdown: string }).markdown = "# Then later"; });
  await expect(page.locator("#early h1")).toHaveText("Then later");
});

test("data-app-theme on the element selects the dark and sepia palettes (Codex on #318)", async ({ page }) => {
  await load(page);
  const article = page.locator("#a article");
  await expect(article.locator("h1")).toHaveText("Plan");
  const paper = (): Promise<string> => article.evaluate(node => getComputedStyle(node).backgroundColor);
  expect(await paper()).toBe("rgb(255, 255, 255)");
  await page.evaluate(() => document.getElementById("a")!.setAttribute("data-app-theme", "dark"));
  expect(await paper()).toBe("rgb(32, 38, 48)");
  await page.evaluate(() => document.getElementById("a")!.setAttribute("data-app-theme", "sepia"));
  expect(await paper()).toBe("rgb(250, 245, 233)");
});

test("a script cannot write: an untrusted click gives no event", async ({ page }) => {
  await load(page);
  const mark = page.locator("#a").getByRole("checkbox").first();
  await expect(mark).toBeVisible();
  await mark.evaluate(node => (node as HTMLElement).click());
  await page.locator("#a").getByRole("checkbox").first().dispatchEvent("contextmenu");
  await page.waitForTimeout(200);
  expect(await events(page)).toEqual([]);
  await expect(page.locator("#a .am-menu")).toHaveCount(0);
});

test("two elements do not cross-talk: events, menus and keyboard groups stay in their own element", async ({ page }) => {
  await load(page);
  const a = page.locator("#a");
  const b = page.locator("#b");
  await expect(a.getByRole("checkbox")).toHaveCount(2);
  await expect(b.getByRole("checkbox")).toHaveCount(1);

  // A menu opens inside the shadow root of the element that asked for it, and nowhere else.
  await a.getByRole("checkbox").nth(1).click({ button: "right" });
  await expect(a.getByRole("menu")).toHaveCount(1);
  await expect(b.getByRole("menu")).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelectorAll(".am-menu").length)).toBe(0);
  await page.keyboard.press("3"); // the key press itself picks: In progress
  await expect(a.getByRole("menu")).toHaveCount(0);
  expect(await events(page)).toEqual([{
    id: "a",
    detail: { patches: [{ line: 4, expect: "- [ ] second", replace: "- [/] second" }] },
  }]);

  // The same choice group number in both: an arrow key in B never lands in A.
  const radiosB = b.getByRole("radio");
  await radiosB.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(radiosB.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(radiosB.first()).toBeFocused(); // wraps inside B
  expect(await page.evaluate(() => (document.getElementById("a")!.shadowRoot!.activeElement as HTMLElement | null)?.className ?? "")).not.toContain("am-choice");

  // A change in B reaches B's listener only, and re-rendering B leaves A alone.
  await radiosB.nth(1).click();
  await expect.poll(async () => (await events(page)).length).toBe(2);
  const all = await events(page);
  expect(all[1]).toEqual({ id: "b", detail: { patches: [{ line: 6, expect: "- ( ) two", replace: "- (x) two" }] } });
  await page.evaluate(() => (window as never as { apply(id: string, patches: unknown[]): void }).apply("b",
    (window as never as { events: Array<{ detail: { patches: unknown[] } }> }).events[1]!.detail.patches));
  await expect(radiosB.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(a.getByRole("radio").nth(1)).toHaveAttribute("aria-checked", "false");
  expect(await events(page)).toHaveLength(2);
});
