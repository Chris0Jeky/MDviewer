import { test, expect, openFiles, readyReader, readyWorkspace } from "./helpers";

const grammarAsset = /\/assets\/(?:wasm|github-light|github-dark|typescript|csharp)-[^/]+\.js$/;
const commonGrammarAsset = /\/assets\/(?:typescript|javascript|python|bash|shellscript|json|markdown|html|css|rust|go|java|c|cpp|sql|yaml|diff)-[^/]+\.js$/;

test("reader loads only its grammar before the editing workspace prepares the remaining languages", async ({ page, audit }) => {
  await openFiles(page, [{ name: "notes.md", text: "# Plain notes\n\nA **local** note with $x^2$." }]);
  await readyReader(page, "Plain notes");
  await expect(page.locator("#reader-document .katex-html")).toBeVisible();
  expect(audit.requests.filter(url => grammarAsset.test(url))).toEqual([]);
  expect(audit.requests.filter(url => /\/assets\/workspace-/.test(url))).toEqual([]);

  const source = "# Quoted code\n\n> ```cs\n> public record Person(string Name);\n> ```";
  await openFiles(page, [{ name: "code.md", text: source }]);
  await page.getByRole("combobox", { name: "Open documents" }).selectOption({ label: "code.md" });
  await readyReader(page, "Quoted code");
  const code = page.locator("#reader-document blockquote pre.shiki code");
  await expect(code).toContainText("public record Person(string Name);");
  const colors = await code.locator("span[style]").evaluateAll(spans => [...new Set(spans.map(span => getComputedStyle(span).color))]);
  expect(colors.length).toBeGreaterThan(1);
  expect(audit.requests.some(url => /\/assets\/csharp-[^/]+\.js$/.test(url))).toBe(true);
  expect(audit.requests.some(url => /\/assets\/wasm-[^/]+\.js$/.test(url))).toBe(true);
  expect(audit.requests.filter(url => commonGrammarAsset.test(url))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("reader-lazy-code.png"), fullPage: true });

  const engineRequests = audit.requests.filter(url => /\/assets\/wasm-[^/]+\.js$/.test(url)).length;
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, source);
  expect(audit.requests.some(url => /\/assets\/cpp-[^/]+\.js$/.test(url))).toBe(true);
  expect(audit.requests.some(url => /\/assets\/markdown-[^/]+\.js$/.test(url))).toBe(true);
  expect(audit.requests.filter(url => /\/assets\/wasm-[^/]+\.js$/.test(url))).toHaveLength(engineRequests);
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
