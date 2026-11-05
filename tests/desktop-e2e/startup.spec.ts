import { test, expect, openFiles, readyReader } from "./helpers";

const grammarAsset = /\/assets\/(?:wasm|github-light|github-dark|typescript|csharp)-[^/]+\.js$/;

test("plain reading requests no code engine assets, then highlights nested code on demand", async ({ page, audit }) => {
  await openFiles(page, [{ name: "notes.md", text: "# Plain notes\n\nA **local** note with $x^2$." }]);
  await readyReader(page, "Plain notes");
  await expect(page.locator("#reader-document .katex-html")).toBeVisible();
  expect(audit.requests.filter(url => grammarAsset.test(url))).toEqual([]);
  expect(audit.requests.filter(url => /\/assets\/workspace-/.test(url))).toEqual([]);

  await openFiles(page, [{ name: "code.md", text: "# Quoted code\n\n> ```cs\n> public record Person(string Name);\n> ```" }]);
  await page.getByRole("combobox", { name: "Open documents" }).selectOption({ label: "code.md" });
  await readyReader(page, "Quoted code");
  const code = page.locator("#reader-document blockquote pre.shiki code");
  await expect(code).toContainText("public record Person(string Name);");
  const colors = await code.locator("span[style]").evaluateAll(spans => [...new Set(spans.map(span => getComputedStyle(span).color))]);
  expect(colors.length).toBeGreaterThan(1);
  expect(audit.requests.some(url => /\/assets\/csharp-[^/]+\.js$/.test(url))).toBe(true);
  expect(audit.requests.some(url => /\/assets\/wasm-[^/]+\.js$/.test(url))).toBe(true);
  await page.screenshot({ path: test.info().outputPath("reader-lazy-code.png"), fullPage: true });
});

test("Mermaid, literal fence examples and unknown quoted code do not load Shiki", async ({ page, audit }) => {
  const text = "# No syntax engine\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n````text\n```cs\nrecord Literal;\n```\n````\n\n> ```unbundled-example\n> Keep the source\n> ```";
  await openFiles(page, [{ name: "diagrams.md", text }]);
  await readyReader(page, "No syntax engine");
  await expect(page.locator("#reader-document figure svg")).toBeVisible();
  await expect(page.locator("#reader-document blockquote pre code")).toHaveText("Keep the source\n");
  expect(audit.requests.filter(url => grammarAsset.test(url))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("reader-no-engine.png"), fullPage: true });
});
