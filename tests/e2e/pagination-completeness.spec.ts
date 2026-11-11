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
    if (raw.startsWith("```")) {
      fence = !fence;
      continue;
    }
    let line = raw;
    if (!fence) {
      if (line.startsWith(":::") || /^\|\s*-/.test(line)) continue;
      line = line.replace(/^#+\s+/, "").replace(/^>\s?/, "").replace(/\s*\{[^}]*\}\s*$/, "");
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
    await loadMarkdownIntoApp(page, forcedStall("image"), "forced-fatal.md");

    const error = page.locator("#error-card");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText(/could not place the whole document/);
    expect(await page.locator("#paged-output .pagedjs_page").count()).toBe(0);

    await page.evaluate(() => window.__mdviewer?.exportPdf());
    await expect(error).toContainText(/No paginated document to export/);
  });
});
