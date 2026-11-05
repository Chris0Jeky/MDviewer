import { readFile, writeFile } from "node:fs/promises";
import { test, expect, RICH_MARKDOWN, openFiles, dropFiles, readyReader, readyWorkspace } from "./helpers";
import { pdfRegionInk, type PdfRegion } from "./pdfPixels";

test("production reader renders rich Markdown without loading the editing workspace", async ({ page, audit }) => {
  // Prove the delivered policy is enforced, not merely present as a meta string.
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__desktopEvidence.inlineRan = true";
    document.head.append(script);
    script.remove();
  });
  await expect.poll(() => page.evaluate(() => window.__desktopEvidence.violations.length)).toBe(1);
  expect(await page.evaluate(() => window.__desktopEvidence.inlineRan ?? false)).toBe(false);
  await page.evaluate(() => { window.__desktopEvidence.violations = []; });

  await openFiles(page, [{ name: "private-field-notes.md", text: RICH_MARKDOWN }]);
  await readyReader(page, "Desktop field notes");
  const doc = page.locator("#reader-document");
  await expect(doc.locator("pre.shiki code")).toContainText("const answer: number = 42");
  const colors = await doc.locator("pre.shiki span").evaluateAll(spans => [...new Set(spans.map(span => getComputedStyle(span).color))]);
  expect(colors.length, "syntax uses more than one visible color").toBeGreaterThan(1);
  await expect(doc.locator(".katex-html")).toBeVisible();
  await expect(doc.locator(".katex-error, .diagram-error")).toHaveCount(0);
  await expect(doc.locator("figure svg")).toBeVisible();
  expect(await doc.locator("figure svg").evaluate(svg => svg.getBoundingClientRect().width)).toBeGreaterThan(100);
  await expect(doc.locator(".footnotes")).toContainText("This footnote stays with the document");
  const footnote = doc.locator(".footnote-ref a");
  const target = await footnote.getAttribute("href");
  expect(target).toMatch(/^#/);
  await footnote.click();
  expect(new URL(page.url()).hash).toBe(target);
  await expect(page.getByRole("navigation", { name: "Document headings" }).getByRole("link", { name: "Code and mathematics" })).toBeVisible();

  await expect(page.locator("#editor-input, #paged-output, .pagedjs_page")).toHaveCount(0);
  expect(audit.requests.filter(url => /\/assets\/workspace-[^/]+\.(?:js|css)$/.test(url)), "no lazy workspace resources before Edit & PDF").toEqual([]);
  expect(audit.requests.filter(url => /pulseboard|sw\.js|registerSW/i.test(url))).toEqual([]);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(items => items.length))).toBe(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("private-field-notes");

  const before = await doc.evaluate(el => getComputedStyle(el).fontSize);
  await page.getByRole("button", { name: "Larger text" }).click();
  expect(parseFloat(await doc.evaluate(el => getComputedStyle(el).fontSize))).toBeGreaterThan(parseFloat(before));
  await page.getByRole("combobox", { name: "Screen theme" }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", "dark");
  await page.locator("#reader-scroll").evaluate(el => el.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: test.info().outputPath("reader-rich-dark.png"), fullPage: true });

  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, RICH_MARKDOWN);
  expect(audit.requests.some(url => /\/assets\/workspace-[^/]+\.js$/.test(url))).toBe(true);
});

test("hostile HTML cannot execute, navigate or load document resources", async ({ page, audit }) => {
  // Chromium reports attempts to compile hostile inline handler attributes while
  // the sanitizer parses them. These refusals are expected; execution and all
  // other policy violations remain failures.
  audit.allowedCsp.push("script-src-attr:inline");
  const hostile = `# Hostile input stays inert

<script>window.__desktopEvidence.hostileRan = true</script>
<img src="https://example.invalid/private-note.png" onerror="window.__desktopEvidence.hostileRan=true">
<iframe src="https://example.invalid/frame"></iframe>
<object data="https://example.invalid/object"></object>
<style>@import "https://example.invalid/private.css";</style>
<div style="background-image:url(https://example.invalid/background)">Safe visible text</div>
<svg onload="window.__desktopEvidence.hostileRan=true"><image href="https://example.invalid/svg-image" /></svg>
<a href="javascript:window.__desktopEvidence.hostileRan=true">Unsafe link</a>
<form action="https://example.invalid/upload"><button>Submit secret</button></form>
`;
  await openFiles(page, [{ name: "hostile.md", text: hostile }]);
  await readyReader(page, "Hostile input stays inert");
  const doc = page.locator("#reader-document");
  await expect(doc).toContainText("Safe visible text");
  await expect(doc.locator("script, iframe, object, style, form, button, [onerror], [onload]")).toHaveCount(0);
  await expect(doc.locator('[src^="http"], [href^="javascript:"], [style*="url("]')).toHaveCount(0);
  await doc.getByText("Unsafe link", { exact: true }).click();
  expect(await page.evaluate(() => window.__desktopEvidence.hostileRan ?? false)).toBe(false);
  expect(new URL(page.url()).pathname).toBe("/desktop.html");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, hostile);
  await expect(page.locator("#paged-output script, #paged-output iframe, #paged-output [onerror]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__desktopEvidence.hostileRan ?? false)).toBe(false);
});

test("multiple picker files and dropped files keep the selected document distinct", async ({ page }) => {
  await openFiles(page, [{ name: "alpha.md", text: "# Alpha\n\nFirst document." }, { name: "beta.md", text: "# Beta\n\nSecond document." }]);
  await readyReader(page, "Alpha");
  const picker = page.getByRole("combobox", { name: "Open documents" });
  await expect(picker.locator("option")).toHaveText(["alpha.md", "beta.md"]);
  await picker.selectOption({ label: "beta.md" });
  await readyReader(page, "Beta");
  await dropFiles(page, [{ name: "gamma.markdown", text: "# Gamma\n\nDropped document." }]);
  await readyReader(page, "Gamma");
  await expect(picker.locator("option")).toHaveText(["alpha.md", "beta.md", "gamma.markdown"]);
  await picker.selectOption({ label: "alpha.md" });
  await readyReader(page, "Alpha");
  await expect(page.locator("#reader-document")).not.toContainText("Dropped document");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await readyReader(page, "Beta");
  await expect(picker.locator("option")).toHaveText(["beta.md", "gamma.markdown"]);
});

test("repeated edit and reading transitions flush pending edits without stale documents", async ({ page }) => {
  const beta = "# Beta\n\nKeep this second document unchanged.";
  await openFiles(page, [{ name: "alpha.md", text: "# Alpha\n\nOriginal." }, { name: "beta.md", text: beta }]);
  await readyReader(page, "Alpha");
  let edited = "";
  for (let turn = 1; turn <= 3; turn++) {
    await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
    await readyWorkspace(page, turn === 1 ? "# Alpha\n\nOriginal." : edited);
    edited = `# Alpha revision ${turn}\n\nFresh edit ${turn}; retained across transitions.`;
    await page.locator("#editor-input").fill(edited);
    // Return immediately, inside the normal editor debounce.
    await page.getByRole("button", { name: "← Reading view", exact: true }).click();
    await readyReader(page, `Alpha revision ${turn}`);
    await expect(page.locator("#editor-input, #paged-output, .pagedjs_page")).toHaveCount(0);
    const picker = page.getByRole("combobox", { name: "Open documents" });
    await expect(picker.locator("option")).toHaveText(["• alpha.md", "beta.md"]);
    await picker.selectOption({ label: "beta.md" });
    await readyReader(page, "Beta");
    await picker.selectOption({ label: "• alpha.md" });
    await readyReader(page, `Alpha revision ${turn}`);
  }
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await readyReader(page, "Alpha revision 3");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await readyReader(page, "Beta");
  await page.screenshot({ path: test.info().outputPath("reader-after-roundtrips.png"), fullPage: true });
});

test("both PDF exports work under the production CSP and use the latest edit", async ({ page }) => {
  await openFiles(page, [{ name: "export.md", text: RICH_MARKDOWN }]);
  await readyReader(page, "Desktop field notes");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, RICH_MARKDOWN);
  const edited = RICH_MARKDOWN.replace("Desktop field notes", "Latest export revision");
  await page.locator("#editor-input").fill(edited);
  await page.getByRole("button", { name: "Print / Save as PDF", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__desktopEvidence.prints.length)).toBe(1);
  const printed = await page.evaluate(() => window.__desktopEvidence.prints[0]!);
  expect(printed.text).toContain("Latest export revision");
  expect(printed.text).not.toContain("Desktop field notes");
  expect(printed.sheets).toBeGreaterThan(0);
  const vector = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  expect(vector.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(printed.sheets);
  await writeFile(test.info().outputPath("desktop-print.pdf"), vector);

  const regions = await page.locator("#paged-output .pagedjs_page").evaluate((sheet): Record<string, PdfRegion> => {
    const paper = sheet.getBoundingClientRect();
    return Object.fromEntries(Object.entries({ heading: "h1", toc: "nav.toc", math: ".katex-html", code: "pre.shiki code" }).map(([name, selector]) => {
      const target = sheet.querySelector(selector);
      if (!target) throw new Error(`Missing PDF fixture ${name}`);
      const box = target.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) throw new Error(`Empty PDF fixture ${name}`);
      return [name, { x: (box.x - paper.x) / paper.width, y: (box.y - paper.y) / paper.height,
        width: box.width / paper.width, height: box.height / paper.height }];
    }));
  });
  // Reproduce a local WebView stylesheet scheduling delay only in the export
  // clone. The live preview is fully styled; capturing before these complete
  // used to produce an unstyled PDF even though its header/page count were valid.
  const delayedStyles: string[] = [];
  await page.route("**/assets/*.css", async route => {
    if (route.request().frame().parentFrame()) {
      delayedStyles.push(route.request().url());
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    await route.continue();
  });
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const path = test.info().outputPath("desktop-download.pdf");
  await download.saveAs(path);
  const raster = await readFile(path);
  expect(raster.subarray(0, 5).toString()).toBe("%PDF-");
  expect(raster.byteLength).toBeGreaterThan(10_000);
  expect(raster.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(printed.sheets);
  expect(delayedStyles.length, "the regression actually delayed cloned CSS").toBeGreaterThanOrEqual(2);
  const evidence = await pdfRegionInk(page, raster, regions);
  await writeFile(test.info().outputPath("desktop-download.png"), evidence.png);
  await writeFile(test.info().outputPath("desktop-download-ink.json"), JSON.stringify(evidence.ink, null, 2));
  for (const name of ["heading", "toc", "math"]) {
    expect(evidence.ink[name]!.dark, `${name} must retain dark ink at its laid-out paper position`).toBeGreaterThan(100);
  }
  expect(evidence.ink.heading!.colored, "headings must keep the dark document style").toBeLessThan(30);
  expect(evidence.ink.code!.colored, "syntax colors survive the saved PDF").toBeGreaterThan(100);
  await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("desktop-pdf-workspace.png"), fullPage: true });
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Latest export revision");
});

test("failed capture styles save no PDF, release their iframe and permit a retry", async ({ page }) => {
  await openFiles(page, [{ name: "export.md", text: RICH_MARKDOWN }]);
  await readyReader(page, "Desktop field notes");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, RICH_MARKDOWN);
  let downloads = 0;
  let rejectedStyles = 0;
  page.on("download", () => { downloads++; });
  await page.route("**/assets/*.css", async route => {
    if (route.request().frame().parentFrame()) {
      rejectedStyles++;
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.abort("failed");
    } else await route.continue();
  });
  const exportButton = page.getByRole("button", { name: "Download PDF", exact: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    await exportButton.click();
    await expect(page.getByRole("alertdialog", { name: "Rendering failed" })).toContainText("stylesheet could not load. Try Print / Save as PDF.");
    await expect(exportButton).toBeEnabled();
    await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
    await expect(page.locator("#editor-input")).toHaveValue(RICH_MARKDOWN);
    expect(downloads, "a failed stylesheet must not yield a misleading PDF").toBe(0);
  }
  expect(rejectedStyles).toBeGreaterThanOrEqual(4);
  await page.unroute("**/assets/*.css");
  const retry = page.waitForEvent("download");
  await exportButton.click();
  await retry;
  await expect(exportButton).toBeEnabled();
  expect(downloads).toBe(1);
  await expect(page.locator("iframe.html2canvas-container")).toHaveCount(0);
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Desktop field notes");
});

test("the reader enforces the 32-document session limit across batches", async ({ page }) => {
  await openFiles(page, Array.from({ length: 32 }, (_, index) => ({ name: `${index}.md`, text: `# Document ${index}` })));
  await readyReader(page, "Document 0");
  const picker = page.getByRole("combobox", { name: "Open documents" });
  await expect(picker.locator("option")).toHaveCount(32);
  await dropFiles(page, [{ name: "overflow.md", text: "# Should not be opened" }]);
  await expect(page.locator("#reader-notice")).toContainText("at most 32 documents");
  await expect(picker.locator("option")).toHaveCount(32);
  await readyReader(page, "Document 0");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await readyReader(page, "Document 1");
  await dropFiles(page, [{ name: "replacement.md", text: "# Replacement" }]);
  await readyReader(page, "Replacement");
  await expect(picker.locator("option")).toHaveCount(32);
});

test("both reader and workspace bound total session bytes across separate file picks", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  // Comments keep rendering cheap; two individually valid files exceed the
  // 25,000,000-byte aggregate bound. The small first document stays selected.
  const large = `<!--${"x".repeat(12_600_000)}-->`;
  await openFiles(page, [{ name: "small.md", text: "# Small active document" }, { name: "large-a.md", text: large }]);
  await readyReader(page, "Small active document");
  await expect(page.getByRole("combobox", { name: "Open documents" }).locator("option")).toHaveCount(2);
  await openFiles(page, [{ name: "large-b.md", text: large }]);
  await expect(page.locator("#reader-notice")).toContainText("memory limit");
  await expect(page.getByRole("combobox", { name: "Open documents" }).locator("option")).toHaveText(["small.md", "large-a.md"]);
  await readyReader(page, "Small active document");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, "# Small active document");
  await page.locator("#file-input").setInputFiles({ name: "large-c.md", mimeType: "text/markdown", buffer: Buffer.from(large) });
  await expect(page.locator("#workspace-notice")).toContainText("memory limit");
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveText(["small.md", "large-a.md"]);
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Small active document");
});

test("closing an edited workspace tab requires explicit discard", async ({ page }) => {
  await openFiles(page, [{ name: "alpha.md", text: "# Alpha" }, { name: "beta.md", text: "# Beta" }]);
  await readyReader(page, "Alpha");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, "# Alpha");
  await page.locator("#editor-input").fill("# Unsaved Alpha\n\nKeep these edits.");
  const messages: string[] = [];
  let acceptClose = false;
  page.on("dialog", async dialog => {
    messages.push(dialog.message());
    if (acceptClose) await dialog.accept(); else await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Close alpha.md", exact: true }).click();
  expect(messages, "a workspace close must offer the same unsaved-work protection as the reader").toHaveLength(1);
  await expect(page.locator("#editor-input")).toHaveValue("# Unsaved Alpha\n\nKeep these edits.");
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveCount(2);
  acceptClose = true;
  await page.getByRole("button", { name: "Close alpha.md", exact: true }).click();
  expect(messages).toHaveLength(2);
  await readyWorkspace(page, "# Beta");
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Beta");
  await expect(page.getByRole("combobox", { name: "Open documents" }).locator("option")).toHaveText(["beta.md"]);
});

test("opening files in the workspace cannot exceed the desktop session limit", async ({ page }) => {
  await openFiles(page, Array.from({ length: 32 }, (_, index) => ({ name: `${index}.md`, text: `# Document ${index}` })));
  await readyReader(page, "Document 0");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, "# Document 0");
  await page.locator("#file-input").setInputFiles({ name: "overflow.md", mimeType: "text/markdown", buffer: Buffer.from("# Workspace overflow") });
  await expect(page.locator("#workspace-notice")).toContainText(/32|limit/);
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveCount(32);
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Document 0");
  await expect(page.getByRole("combobox", { name: "Open documents" }).locator("option")).toHaveCount(32);
});

test("workspace teardown releases global listeners and later input fires once", async ({ page, context }) => {
  await openFiles(page, [{ name: "one.md", text: "# One" }]);
  await readyReader(page, "One");
  const cdp = await context.newCDPSession(page);
  async function listenerCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const expression of ["window", "document"]) {
      const handle = await cdp.send("Runtime.evaluate", { expression });
      const objectId = handle.result.objectId!;
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId });
      for (const listener of listeners) {
        const key = `${expression}:${listener.type}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      await cdp.send("Runtime.releaseObject", { objectId });
    }
    return counts;
  }
  let baseline: Record<string, number> | undefined;
  for (let turn = 0; turn < 3; turn++) {
    await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
    await readyWorkspace(page, "# One");
    await page.getByRole("button", { name: "← Reading view", exact: true }).click();
    await readyReader(page, "One");
    await expect(page.locator("#app")).toBeEmpty();
    await expect(page.locator("#editor-input, #paged-output, .pagedjs_page")).toHaveCount(0);
    const counts = await listenerCounts();
    if (baseline) expect(counts, "global handlers must not accumulate after the first lazy module load").toEqual(baseline);
    else baseline = counts;
  }
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, "# One");
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+o");
  // Native and File API paths must share BOM-aware decoding in the workspace.
  await (await chooser).setFiles({ name: "two.md", mimeType: "text/markdown", buffer: Buffer.from("\ufeff# Two", "utf16le") });
  await readyWorkspace(page, "# Two");
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveText(["one.md", "two.md"]);
  await dropFiles(page, [{ name: "three.md", text: "# Three" }], "#desktop-workspace");
  await readyWorkspace(page, "# Three");
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveText(["one.md", "two.md", "three.md"]);
  const downloads: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const saved = await download;
  const path = test.info().outputPath("shortcut-saved.md");
  await saved.saveAs(path);
  expect(await readFile(path, "utf8")).toBe("# Three");
  expect(downloads).toEqual(["three.md"]);
  await cdp.detach();
});

test("document-authored IDs cannot intercept the application workspace", async ({ page }) => {
  const markdown = "# Reserved identifiers\n\n<div id=\"app\">User text survives.</div>\n<div id=\"reader-status\">An authored status label.</div>";
  await openFiles(page, [{ name: "identifiers.md", text: markdown }]);
  await readyReader(page, "Reserved identifiers");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await expect(page.locator("#desktop-workspace #editor-input")).toBeVisible();
  await expect(page.locator("#desktop-workspace #editor-input")).toHaveValue(markdown);
  await expect(page.locator("#desktop-workspace #paged-output")).toContainText("User text survives.");
  await page.getByRole("button", { name: "← Reading view", exact: true }).click();
  await readyReader(page, "Reserved identifiers");
  await expect(page.locator("#reader-document")).toContainText("User text survives.");
});

test("document-authored input IDs cannot intercept the workspace file picker", async ({ page }) => {
  const markdown = "# Authored input ID\n\n<div id=\"file-input\">This is document content.</div>";
  await openFiles(page, [{ name: "input-id.md", text: markdown }]);
  await readyReader(page, "Authored input ID");
  await page.getByRole("button", { name: "Edit & PDF", exact: true }).click();
  await readyWorkspace(page, markdown);
  const chooser = page.waitForEvent("filechooser", { timeout: 5_000 });
  await page.getByRole("button", { name: "Open Markdown", exact: true }).click();
  await (await chooser).setFiles({ name: "next.md", mimeType: "text/markdown", buffer: Buffer.from("# Next document") });
  await readyWorkspace(page, "# Next document");
  await expect(page.getByRole("combobox", { name: "Active document" }).locator("option")).toHaveText(["input-id.md", "next.md"]);
});
