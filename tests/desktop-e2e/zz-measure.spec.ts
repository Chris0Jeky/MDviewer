import { test, expect, openFiles, selectDocument } from "./helpers";

/** S9 measurement harness (not a gate): prints numbers for the report. Run alone, one worker. */
const OUT: Record<string, number | string> = {};
const md1mb = (() => {
  const block = ["## Section", "", "Some **bold** text with a [link](https://example.com) and `code`.", "", "```ts", "const x: number = 42;", "console.log(x);", "```", "", "| a | b |", "| - | - |", "| 1 | 2 |", "", "- item one", "- item two", ""].join("\n");
  let text = "# Big document\n\n";
  let index = 0;
  while (text.length < 1_000_000) text += block.replace("## Section", `## Section ${++index}`);
  return text;
})();
const jsonl5mb = (() => {
  const lines: string[] = [];
  let size = 0;
  for (let index = 0; size < 5_000_000; index++) {
    const line = JSON.stringify({ id: index, event: "request", path: `/api/items/${index}`, status: 200, ms: index % 97, tags: ["a", "b"] });
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join("\n");
})();

async function busyDone(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator("#reader-document")).toHaveAttribute("aria-busy", "false", { timeout: 120_000 });
}

test("measure", async ({ page }) => {
  test.setTimeout(600_000);
  // Cold start: navigation start to the sample's first text frame.
  await page.goto("/desktop.html");
  OUT.coldDomContentLoadedMs = await page.evaluate(() => Math.round((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).domContentLoadedEventEnd));
  const firstText = await page.evaluate(async () => {
    performance.clearMarks();
    const started = performance.now();
    document.getElementById("reader-sample")!.click();
    while (!performance.getEntriesByName("mdv:reader-text").length) await new Promise(resolve => setTimeout(resolve, 5));
    return performance.getEntriesByName("mdv:reader-text")[0]!.startTime - started;
  });
  OUT.sampleFirstTextMs = Math.round(firstText);
  await busyDone(page);

  // 1 MB Markdown: open to first text, and to fully upgraded.
  const t0 = Date.now();
  await page.evaluate(() => performance.clearMarks());
  await openFiles(page, [{ name: "big.md", text: md1mb }]);
  await page.waitForFunction(() => performance.getEntriesByName("mdv:reader-text").length > 0, undefined, { timeout: 120_000 });
  OUT.md1mbFirstTextMs = Date.now() - t0;
  await busyDone(page);
  OUT.md1mbReadyMs = Date.now() - t0;

  // 5 MB JSON Lines.
  const t1 = Date.now();
  await openFiles(page, [{ name: "events.jsonl", text: jsonl5mb }]);
  await busyDone(page);
  OUT.jsonl5mbReadyMs = Date.now() - t1;

  // Tab switch between two rendered documents.
  const t2 = Date.now();
  await selectDocument(page, "big.md");
  await busyDone(page);
  OUT.tabSwitchTo1mbMs = Date.now() - t2;
  const t3 = Date.now();
  await selectDocument(page, "Sample.md");
  await busyDone(page);
  OUT.tabSwitchToSampleMs = Date.now() - t3;

  // Ten tabs: memory (JS heap of the page) after opening ten mid-size documents.
  const ten = Array.from({ length: 10 }, (_, index) => ({ name: `doc-${index}.md`, text: md1mb.slice(0, 100_000) }));
  await openFiles(page, ten);
  await busyDone(page);
  const client = await page.context().newCDPSession(page);
  await client.send("HeapProfiler.collectGarbage");
  const metrics = await client.send("Performance.getMetrics").catch(async () => { await client.send("Performance.enable"); return client.send("Performance.getMetrics"); });
  const heap = metrics.metrics.find(metric => metric.name === "JSHeapUsedSize")?.value ?? 0;
  OUT.heapAfter13DocsMB = Math.round(heap / 1e5) / 10;
  OUT.domNodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  console.log("MEASURE " + JSON.stringify(OUT));
});
