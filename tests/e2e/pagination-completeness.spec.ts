import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  loadMarkdownIntoApp,
  readPagedSnapshot,
  splitAtomicOffenders,
  waitForPagination,
} from "../helpers/pagedDom";
import { readRasterPdf } from "../helpers/rasterPdf";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(here, "..", "fixtures", name), "utf8");
const LONG_PROSE = fixture("long-prose-fences.md");
const NOCUTOFF = fixture("nocutoff.md");

/**
 * Completeness outranks keep-whole. Paged.js 0.4.3 resolves normally even when it stopped
 * early ("Layout repeated" / "Unable to layout item"), and the app used to present the
 * truncated result as complete: long-prose code fences under `##` headings lost hundreds
 * of lines, left blank pages, or parked blocks in hidden overflow columns.
 */

const STALL = /Layout repeated|Unable to layout item/;

function watchStalls(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (message) => {
    if (STALL.test(message.text())) seen.push(message.text().split(":")[0]!);
  });
  return seen;
}

/** Every source line's readable text, in source order (markup stripped). */
function expectedLines(markdown: string): string[] {
  const lines: string[] = [];
  let fence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    let line = raw.replace(/^>\s?/, "");
    if (line.startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (!fence) {
      if (line.startsWith(":::") || /^\|\s*-/.test(line)) continue;
      line = line.replace(/^#+\s+/, "").replace(/\s*\{[^}]*\}\s*$/, "");
      if (line.startsWith("|")) line = line.split("|").map((cell) => cell.trim()).filter(Boolean).join(" ");
    }
    line = line.replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines;
}

/** Source lines that do not appear in the pages' text in source order. */
async function missingInOrder(page: Page, markdown: string): Promise<string[]> {
  const text = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("#paged-output .pagedjs_page_content"))
      .map((content) => content.innerText)
      .join(" ")
      .replace(/\s+/g, " "),
  );
  const missing: string[] = [];
  let cursor = 0;
  for (const line of expectedLines(markdown)) {
    const at = text.indexOf(line, cursor);
    if (at < 0) missing.push(line.slice(0, 24));
    else cursor = at + line.length;
  }
  return missing;
}

/** Empty pages, blocks outside their page content box, and headings stranded at a page foot. */
async function layoutDefects(page: Page): Promise<{ empty: number[]; outside: string[]; stranded: string[] }> {
  return page.evaluate(() => {
    const empty: number[] = [];
    const outside: string[] = [];
    const stranded: string[] = [];
    const pages = Array.from(document.querySelectorAll<HTMLElement>("#paged-output .pagedjs_page"));
    pages.forEach((sheet, index) => {
      const content = sheet.querySelector<HTMLElement>(".pagedjs_page_content")!;
      if (!content.innerText.trim()) empty.push(index + 1);
      const box = content.getBoundingClientRect();
      const blocks = content.querySelectorAll<HTMLElement>(
        "p, pre, table, li, h1, h2, h3, h4, h5, h6, blockquote, figure, img, svg, hr, .callout",
      );
      for (const block of blocks) {
        const rect = block.getBoundingClientRect();
        if (rect.height === 0) continue;
        if (
          rect.top < box.top - 2 ||
          rect.bottom > box.bottom + 2 ||
          rect.left < box.left - 2 ||
          rect.right > box.right + 2
        ) {
          outside.push(`page ${index + 1} ${block.tagName.toLowerCase()}`);
        }
      }
      for (const heading of content.querySelectorAll<HTMLElement>("h2")) {
        if (!heading.nextElementSibling) stranded.push(`page ${index + 1}: ${heading.textContent}`);
      }
    });
    return { empty, outside, stranded };
  });
}

test.describe("pagination never drops or hides content", () => {
  test("long prose fences, an over-tall table, quote and callout paginate completely", async ({ page }) => {
    const stalls = watchStalls(page);
    await page.goto("/");
    await loadMarkdownIntoApp(page, LONG_PROSE, "long-prose-fences.md");
    await waitForPagination(page);

    expect(stalls, "Paged.js must not stall").toEqual([]);
    expect(await missingInOrder(page, LONG_PROSE), "source lines missing from the pages").toEqual([]);

    const defects = await layoutDefects(page);
    expect(defects.empty, "empty pages").toEqual([]);
    expect(defects.outside, "blocks outside their page content box").toEqual([]);
    expect(defects.stranded, "headings stranded at the foot of a page").toEqual([]);

    // Each over-tall family genuinely split (Tier 4), and only with over-tall evidence.
    const snapshot = await readPagedSnapshot(page);
    expect(splitAtomicOffenders(snapshot)).toEqual([]);
    const splitFamilies = new Set<string>();
    const pagesById = new Map<string, Set<number>>();
    for (const block of snapshot.blocks) {
      if (!block.atomicId) continue;
      pagesById.set(block.atomicId, (pagesById.get(block.atomicId) ?? new Set()).add(block.pageIndex));
    }
    for (const block of snapshot.blocks) {
      if ((pagesById.get(block.atomicId ?? "")?.size ?? 0) > 1) splitFamilies.add(block.tag.split(".")[0]!);
    }
    expect([...splitFamilies].sort()).toEqual(["blockquote", "div", "pre", "table"]);
  });

  test("keep-whole heights are measured in page context", async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, NOCUTOFF);
    await waitForPagination(page);
    const snapshot = await readPagedSnapshot(page);

    const fragments = new Map<string, number>();
    for (const block of snapshot.blocks) {
      if (block.atomicId) fragments.set(block.atomicId, (fragments.get(block.atomicId) ?? 0) + 1);
    }
    const whole = snapshot.blocks.filter(
      (block) => block.atomicId && fragments.get(block.atomicId) === 1 && !block.shrunk && block.tag !== "img",
    );
    expect(whole.length, "fixture has whole keep-whole blocks").toBeGreaterThan(5);
    // Rects are zoomed with the on-screen preview; recorded heights are layout px.
    const laidOut = (height: number): number => height / snapshot.scale;
    const off = whole
      .filter((block) => block.sourceHeight === null || Math.abs(laidOut(block.rect.height) - block.sourceHeight) > 2)
      .map((block) => `${block.tag} laid out ${laidOut(block.rect.height).toFixed(1)} recorded ${block.sourceHeight}`);
    expect(off, "recorded source height must match the laid-out height within 2px").toEqual([]);
  });

  test("both export paths keep the preview's page count", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await loadMarkdownIntoApp(page, LONG_PROSE, "long-prose-fences.md");
    const sheets = await waitForPagination(page);
    expect(sheets).toBeGreaterThan(10);

    const printed = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    expect(printed.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).toHaveLength(sheets);

    const downloading = page.waitForEvent("download", { timeout: 200_000 });
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    const path = test.info().outputPath("long-prose-fences.pdf");
    await (await downloading).saveAs(path);
    expect(readRasterPdf(await readFile(path))).toHaveLength(sheets);
  });
});

/**
 * Forcing a stall: an author attribute puts Paged.js's keep-with-next marker on the heading
 * that follows a split code block — the exact state Paged.js's undisplayed-element bug used
 * to create. When the next keep-whole block cannot fit beside the continuation, Paged.js
 * backs up to the code block's start and reports "Layout repeated".
 */
function forcedStall(next: "code" | "image"): string {
  const row = (tag: string): string =>
    `${tag} ${"harbor lantern meadow orchard quarry river summit timber valley willow ".repeat(2).trim()}.`;
  const fence = (prefix: string, count: number): string[] => [
    "```",
    ...Array.from({ length: count }, (_, index) => row(`${prefix}${index + 1}`)),
    "```",
  ];
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return [
    "## Alpha",
    "",
    ...fence("a", 30),
    "",
    "## Beta {data-previous-break-after=avoid}",
    "",
    ...(next === "code" ? fence("b", 20) : [`![tall figure](data:image/png;base64,${png}){width=600}`]),
    "",
    "## Gamma",
    "",
    "Closing paragraph after the forced stall.",
    "",
  ].join("\n");
}

test.describe("a stalled layout is recovered or refused, never truncated", () => {
  test("a stall is retried with the blocking block split, and the reader is told", async ({ page }) => {
    const stalls = watchStalls(page);
    const markdown = forcedStall("code");
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown, "forced-stall.md");
    await waitForPagination(page);

    expect(stalls.length, "the fixture must really stall the first layout").toBeGreaterThan(0);
    await expect(page.locator("#warning-banner")).toContainText(/Layout was retried.*code block under “Beta”/);
    expect(await missingInOrder(page, markdown)).toEqual([]);
    const defects = await layoutDefects(page);
    expect(defects.empty).toEqual([]);
    expect(defects.outside).toEqual([]);
  });

  test("an unrecoverable stall shows the error state and nothing exportable", async ({ page }) => {
    await page.goto("/");
    // A complete render first, so the chip has a stale "Page n / N" to lose.
    await loadMarkdownIntoApp(page, NOCUTOFF);
    await waitForPagination(page);
    await expect(page.locator("#page-chip")).not.toHaveAttribute("data-count", "0");
    // Under a reduced zoom the failing re-render hides the stack while it lays out at scale 1.
    await page.evaluate(() => window.__mdviewer!.updateSettings({ viewMode: "preview", zoom: 0.5 }));
    await expect(page.locator("#canvas")).toHaveAttribute("data-zoom", "0.5");
    await page.evaluate(() => {
      const host = document.getElementById("paged-output")!;
      const seen: string[] = [];
      (window as unknown as { __hostVisibility: string[] }).__hostVisibility = seen;
      new MutationObserver(() => seen.push(host.style.visibility)).observe(host, { attributes: true, attributeFilter: ["style"] });
    });
    await loadMarkdownIntoApp(page, forcedStall("image"), "forced-fatal.md");

    const error = page.locator("#error-card");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText(/could not place the whole document/);
    expect(await page.locator("#paged-output .pagedjs_page").count()).toBe(0);
    await expect(page.locator("#page-chip")).toHaveAttribute("data-count", "0");
    // A failed layout under a reduced zoom must not leave the (empty) stack hidden.
    const seen = await page.evaluate(() => (window as unknown as { __hostVisibility: string[] }).__hostVisibility);
    expect(seen, "the failing layout really ran hidden").toContain("hidden");
    await expect(page.locator("#paged-output")).toHaveCSS("visibility", "visible");

    await page.evaluate(() => window.__mdviewer?.exportPdf());
    await expect(error).toContainText(/No paginated document to export/);
  });
});

/** Page indexes each element matching `selector` spans, keyed by its Paged.js source ref. */
async function pagesByRef(page: Page, selector: string): Promise<Record<string, number[]>> {
  return page.evaluate((sel) => {
    const pages = Array.from(document.querySelectorAll("#paged-output .pagedjs_page"));
    const byRef: Record<string, number[]> = {};
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`#paged-output ${sel}`))) {
      const index = pages.indexOf(el.closest(".pagedjs_page")!);
      const list = (byRef[el.dataset.ref ?? "?"] ??= []);
      if (!list.includes(index)) list.push(index);
    }
    return byRef;
  }, selector);
}

const shortFence = (tag: string): string[] => [
  "```",
  ...Array.from({ length: 8 }, (_, index) => `${tag}${index + 1} quiet harbor lantern meadow orchard`),
  "```",
];

test.describe("keep-whole edges around Tier 3 and Tier 4", () => {
  test("a short fence inside an over-tall quote or callout stays whole", async ({ page }) => {
    // Short fences are spread through each tall container, so page boundaries fall
    // across several of them; each must move whole while its container splits.
    const prose = (tag: string): string =>
      `${tag} the container keeps flowing around its short code samples, line after line.`;
    const quote: string[] = [];
    const callout: string[] = [];
    for (let block = 1; block <= 9; block += 1) {
      quote.push(`> ${prose(`q${block}a`)}`, ">", `> ${prose(`q${block}b`)}`, ">", ...shortFence(`qf${block}l`).map((line) => `> ${line}`), ">");
      callout.push(prose(`c${block}a`), "", prose(`c${block}b`), "", ...shortFence(`cf${block}l`), "");
    }
    const markdown = ["## Tall quote", "", ...quote, "", "## Tall callout", "", "::: note", ...callout, ":::", ""].join("\n");
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown, "nested-fences.md");
    await waitForPagination(page);

    const containers = await pagesByRef(page, "blockquote, div.callout");
    expect(Object.values(containers).filter((pages) => pages.length > 1).length, "both containers split").toBe(2);
    const fences = await pagesByRef(page, "blockquote > pre, div.callout > pre");
    expect(Object.keys(fences).length).toBe(18);
    const sliced = Object.entries(fences).filter(([, pages]) => pages.length > 1);
    expect(sliced, "short nested fences split across pages").toEqual([]);
    expect(await missingInOrder(page, markdown)).toEqual([]);
  });

  test("a tall fence nested in a quote or callout splits at line boundaries and loses nothing", async ({ page }) => {
    const rows = (tag: string): string[] =>
      Array.from({ length: 80 }, (_, index) => `${tag}${index + 1} quiet harbor lantern meadow orchard`);
    const markdown = [
      "## Quote",
      "",
      "> A lead-in sentence for the quote.",
      ">",
      "> ```",
      ...rows("q").map((line) => `> ${line}`),
      "> ```",
      "",
      "## Callout",
      "",
      "::: note",
      "A lead-in sentence for the callout.",
      "",
      "```",
      ...rows("c"),
      "```",
      ":::",
      "",
    ].join("\n");
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown, "tall-nested-fences.md");
    await waitForPagination(page);

    const fences = await pagesByRef(page, "blockquote > pre, div.callout > pre");
    expect(Object.keys(fences).length).toBe(2);
    for (const [, pages] of Object.entries(fences)) expect(pages.length, "each tall fence spans pages").toBeGreaterThan(1);
    expect(await missingInOrder(page, markdown)).toEqual([]);
    const defects = await layoutDefects(page);
    expect(defects.empty).toEqual([]);
    expect(defects.outside).toEqual([]);
  });

  test("a tall code figure splits its own fence instead of stranding the caption", async ({ page }) => {
    const rows = Array.from({ length: 80 }, (_, index) => `f${index + 1} quiet harbor lantern meadow orchard`);
    const markdown = [
      "## Listing",
      "",
      `<figure class="code-figure"><figcaption>Listing 1</figcaption><pre><code>${rows.join("\n")}</code></pre></figure>`,
      "",
      "Closing paragraph.",
      "",
    ].join("\n");
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown, "tall-code-figure.md");
    await waitForPagination(page);

    // Every fragment of the figure carries part of its fence: `break-inside: avoid` on the
    // fence would push it whole past the caption and leave a page holding only the caption.
    const fragments = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#paged-output figure.code-figure")).map(
        (figure) => !!figure.querySelector(":scope > pre"),
      ),
    );
    expect(fragments.length, "the figure is taller than a page").toBeGreaterThan(1);
    expect(fragments.every(Boolean), "no fragment is a bare caption").toBe(true);
    expect(await missingInOrder(page, rows.join("\n"))).toEqual([]);
  });

  test("a heading and a fence that fit a page only without the heading stay together and whole", async ({ page }) => {
    const stalls = watchStalls(page);
    const markdown = [
      "Intro paragraph before the heading.",
      "",
      "## Near page",
      "",
      "```",
      ...Array.from({ length: 48 }, (_, index) => `n${index + 1} quiet harbor lantern meadow`),
      "```",
      "",
      "Closing paragraph.",
      "",
    ].join("\n");
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown, "near-page.md");
    await waitForPagination(page);

    // Precondition: the fence fits a page alone but not under its heading.
    const fit = await page.evaluate(() => {
      const pre = document.querySelector<HTMLElement>("#paged-output pre")!;
      const content = document.querySelector<HTMLElement>("#paged-output .pagedjs_page_content")!;
      return { source: Number(pre.dataset.mdvSourceHeight), page: content.offsetHeight };
    });
    expect(fit.source).toBeLessThanOrEqual(fit.page);
    expect(fit.source).toBeGreaterThan(fit.page - 40);

    const fence = Object.values(await pagesByRef(page, "pre"));
    expect(fence, "the fence is laid out once, on one page").toEqual([[expect.any(Number)]]);
    const heading = Object.values(await pagesByRef(page, "h2"));
    expect(heading).toEqual([fence[0]]);
    expect(stalls).toEqual([]);
    expect((await layoutDefects(page)).outside).toEqual([]);
    await expect(page.locator("#warning-banner")).not.toContainText(/Layout was retried/);
    expect(await missingInOrder(page, markdown)).toEqual([]);
  });

  // Both headings keep with the block, so the room a block has is the page minus BOTH. A fence
  // that fit under the inner heading alone used to skip Tier 3 and split across two pages.
  for (const lines of [45, 47]) {
    test(`a ${lines}-line fence under two stacked headings stays whole, on their page`, async ({ page }) => {
      const stalls = watchStalls(page);
      const markdown = [
        "Intro paragraph before the headings.",
        "",
        "## Outer heading",
        "",
        "### Inner heading",
        "",
        "```",
        ...Array.from({ length: lines }, (_, index) => `n${index + 1} quiet harbor lantern meadow`),
        "```",
        "",
        "Closing paragraph.",
        "",
      ].join("\n");
      await page.goto("/");
      await loadMarkdownIntoApp(page, markdown, "stacked-headings.md");
      await waitForPagination(page);

      // Precondition: the fence fits a page alone, but not under both headings.
      const fit = await page.evaluate(() => {
        const pre = document.querySelector<HTMLElement>("#paged-output pre")!;
        const content = document.querySelector<HTMLElement>("#paged-output .pagedjs_page_content")!;
        const h2 = document.querySelector<HTMLElement>("#paged-output h2")!;
        // Page room the headings take, margins included (heading top to fence top).
        return { source: Number(pre.dataset.mdvSourceHeight), page: content.offsetHeight, lead: pre.offsetTop - h2.offsetTop };
      });
      expect(fit.source).toBeLessThanOrEqual(fit.page);
      expect(fit.source + fit.lead).toBeGreaterThan(fit.page);

      const fence = Object.values(await pagesByRef(page, "pre"));
      expect(fence, "the fence is laid out once, on one page").toEqual([[expect.any(Number)]]);
      expect(Object.values(await pagesByRef(page, "h2"))).toEqual([fence[0]]);
      expect(Object.values(await pagesByRef(page, "h3"))).toEqual([fence[0]]);
      expect(stalls).toEqual([]);
      expect((await layoutDefects(page)).outside).toEqual([]);
      await expect(page.locator("#warning-banner")).not.toContainText(/Layout was retried/);
      expect(await missingInOrder(page, markdown)).toEqual([]);
    });
  }

  test("a table that fits a page only without its heading is Tier 4 and starts under the heading", async ({ page }) => {
    const stalls = watchStalls(page);
    const markdown = [
      "Intro paragraph before the heading.",
      "",
      "## Near page table",
      "",
      "| Row | Station | Note |",
      "| --- | --- | --- |",
      ...Array.from({ length: 27 }, (_, index) => `| r${index + 1} | harbor | quiet lantern meadow |`),
      "",
      "Closing paragraph.",
      "",
    ].join("\n");
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown, "near-page-table.md");
    await waitForPagination(page);

    const fit = await page.evaluate(() => {
      const table = document.querySelector<HTMLElement>("#paged-output table")!;
      const content = document.querySelector<HTMLElement>("#paged-output .pagedjs_page_content")!;
      return {
        source: Number(table.dataset.mdvSourceHeight),
        page: content.offsetHeight,
        tier: table.getAttribute("data-mdv-splittable"),
      };
    });
    expect(fit.source, "precondition: fits a page alone").toBeLessThanOrEqual(fit.page);
    expect(fit.source, "precondition: not under its heading").toBeGreaterThan(fit.page - 40);
    expect(fit.tier).toBe("tier4");

    const table = Object.values(await pagesByRef(page, "table"))[0]!;
    const heading = Object.values(await pagesByRef(page, "h2"))[0]!;
    expect(heading, "the heading stays with the table's first fragment").toEqual([Math.min(...table)]);
    expect(stalls).toEqual([]);
    expect((await layoutDefects(page)).outside).toEqual([]);
    await expect(page.locator("#warning-banner")).not.toContainText(/Layout was retried/);
    expect(await missingInOrder(page, markdown)).toEqual([]);
  });

  test("a last page whose footnotes overflow onto a notes-only page is complete, not empty", async ({ page }) => {
    const note = (n: number): string =>
      `[^n${n}]: Footnote ${n} explains the closing remark at length, so that the notes outgrow the footnote area of the final page and continue on another page.`;
    const markdown = [
      "# Notes",
      "",
      `The closing paragraph cites every note.${Array.from({ length: 80 }, (_, i) => `[^n${i + 1}]`).join("")}`,
      "",
      ...Array.from({ length: 80 }, (_, i) => note(i + 1)),
      "",
    ].join("\n");
    await page.goto("/");
    await loadMarkdownIntoApp(page, markdown, "footnote-overflow.md");
    await waitForPagination(page);

    // Non-vacuous: Paged.js really moved overflowing notes onto a page with no body text.
    const notesOnly = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#paged-output .pagedjs_page")).some(
        (sheet) =>
          !sheet.querySelector<HTMLElement>(".pagedjs_page_content")!.innerText.trim() &&
          !!sheet.querySelector<HTMLElement>(".pagedjs_footnote_area")!.innerText.trim(),
      ),
    );
    expect(notesOnly, "fixture must produce a notes-only page").toBe(true);
    await expect(page.locator("#error-card")).toBeHidden();
    const text = await page.evaluate(() => document.getElementById("paged-output")!.innerText);
    for (let n = 1; n <= 80; n += 1) expect(text).toContain(`Footnote ${n} explains`);
  });

  test("a re-render under a reduced preview zoom leaves no block outside its page", async ({ page }) => {
    // Narrower than a sheet, so "Fit" resolves below 1 once pages exist.
    await page.setViewportSize({ width: 700, height: 900 });
    await page.goto("/");
    await page.evaluate(() => window.__mdviewer!.updateSettings({ viewMode: "preview", zoom: "fit" }));
    await loadMarkdownIntoApp(page, LONG_PROSE, "long-prose-fences.md");
    await waitForPagination(page);
    await page.evaluate(() => window.__mdviewer!.updateSettings({ zoom: 0.5 }));
    await expect(page.locator("#canvas")).toHaveAttribute("data-zoom", "0.5");

    // Any re-render now runs while the stack is scaled; a paper change forces one.
    const before = await page.locator("#paged-output .pagedjs_page").first().evaluate((el) => (el as HTMLElement).offsetWidth);
    // Layout runs at scale 1; the stack must stay hidden meanwhile, not flash full size.
    await page.evaluate(() => {
      const host = document.getElementById("paged-output")!;
      const seen: string[] = [];
      (window as unknown as { __hostVisibility: string[] }).__hostVisibility = seen;
      // Record the stack's visibility each time a new sheet is added to it.
      new MutationObserver((records) => {
        const added = records.some((record) =>
          Array.from(record.addedNodes).some((node) => node instanceof Element && node.matches(".pagedjs_page")),
        );
        if (added) seen.push(getComputedStyle(host).visibility);
      }).observe(host, { childList: true, subtree: true });
    });
    await page.evaluate(() => window.__mdviewer!.updateSettings({ paperSize: "letter" }));
    await expect
      .poll(() => page.locator("#paged-output .pagedjs_page").first().evaluate((el) => (el as HTMLElement).offsetWidth))
      .toBeGreaterThan(before);
    await waitForPagination(page);

    await expect(page.locator("#error-card")).toBeHidden();
    expect(await page.locator("#paged-output .pagedjs_page").count()).toBeGreaterThan(10);
    expect((await layoutDefects(page)).outside).toEqual([]);
    expect(await missingInOrder(page, LONG_PROSE)).toEqual([]);

    const seen = await page.evaluate(() => (window as unknown as { __hostVisibility: string[] }).__hostVisibility);
    expect(seen.length, "the re-render added sheets").toBeGreaterThan(10);
    expect(new Set(seen), "sheets laid out at scale 1 are added while the stack is hidden").toEqual(new Set(["hidden"]));
    await expect(page.locator("#paged-output")).toHaveCSS("visibility", "visible");
  });
});
