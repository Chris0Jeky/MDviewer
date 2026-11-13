import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";
import { readPdfLinks } from "../helpers/pdfLinks";

/** Invented fixture: every heading family from #204, with duplicates, spread over several sheets. */
const HEADINGS = [
  { md: "# 日本語の見出し", id: "日本語の見出し" },
  { md: "## Café", id: "café" },
  { md: "## Café", id: "café-1" }, // decomposed form of the same heading
  { md: "## مرحبا بالعالم", id: "مرحبا-بالعالم" },
  { md: "## 🎉", id: "sec-" },
  { md: "## ?!", id: "sec--1" },
  { md: "## 日本語の見出し", id: "日本語の見出し-1" },
  { md: "## 1. Numbered", id: "sec-1-numbered" },
];
const FILLER = Array.from({ length: 9 }, (_, i) => `Filler paragraph ${i} about nothing in particular, long enough to wrap onto a second line of the sheet.`).join("\n\n");
const DOC = HEADINGS.map((h) => `${h.md}\n\n${FILLER}`).join("\n\n");

test.describe("Unicode heading ids, TOC and PDF links (#204)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await loadMarkdownIntoApp(page, DOC);
    await waitForPagination(page);
  });

  test("ids, TOC targets and Paged.js page numbers agree for every heading", async ({ page }) => {
    const snapshot = await page.evaluate(() => {
      const host = document.getElementById("paged-output")!;
      const sheetOf = (el: Element) => Number(el.closest(".pagedjs_page")!.getAttribute("data-page-number"));
      const headings = Array.from(host.querySelectorAll<HTMLElement>("h1[id],h2[id]")).filter((h) => !h.closest("nav"));
      return {
        sheets: host.querySelectorAll(".pagedjs_page").length,
        headings: headings.map((h) => ({ id: h.id, sheet: sheetOf(h), text: h.textContent!.replace("¶", "").trim() })),
        toc: Array.from(host.querySelectorAll<HTMLAnchorElement>("nav.toc a.toc-link"), (a) => ({
          id: decodeURIComponent(a.getAttribute("href")!.slice(1)),
          text: a.querySelector(".toc-text")!.textContent!.trim(),
          page: a.dataset.page ? Number(a.dataset.page) : null,
          // Paged.js stamps data-target-counter-* only once target-counter(attr(href url), page) found its heading.
          resolved: a.getAttributeNames().some((n) => n.startsWith("data-target-counter-")),
        })),
      };
    });

    expect(snapshot.sheets).toBeGreaterThan(3);
    expect(snapshot.headings.map((h) => h.id)).toEqual(HEADINGS.map((h) => h.id));
    expect(snapshot.toc.map((t) => t.id)).toEqual(HEADINGS.map((h) => h.id));
    // Heading text is untouched by slugging.
    expect(snapshot.toc.map((t) => t.text)).toEqual(snapshot.headings.map((h) => h.text));
    expect(snapshot.headings[2]!.text).toBe("Café");
    expect(snapshot.toc.every((t) => t.resolved), "every TOC entry resolved by target-counter").toBe(true);
    expect(snapshot.toc.map((t) => t.page)).toEqual(snapshot.headings.map((h) => h.sheet));
    expect(new Set(snapshot.toc.map((t) => t.page)).size, "headings land on different sheets").toBeGreaterThan(2);
  });

  test("Print PDF links jump to the sheet that holds each Unicode heading", async ({ page }) => {
    const sheets = await page.evaluate(() => {
      const host = document.getElementById("paged-output")!;
      return Object.fromEntries(Array.from(host.querySelectorAll<HTMLElement>("h1[id],h2[id]"))
        .filter((h) => !h.closest("nav"))
        .map((h) => [h.id, Array.from(host.querySelectorAll(".pagedjs_page")).indexOf(h.closest(".pagedjs_page")!)]));
    });

    const { destinations, links } = readPdfLinks(await page.pdf({ printBackground: true, preferCSSPageSize: true }));

    for (const { id } of HEADINGS) {
      expect(destinations.get(id), `destination for ${id}`).toBe(sheets[id]);
      // One link from the TOC and one from the heading's own permalink wrapper.
      expect(links.filter((l) => l.id === id).length, `links to ${id}`).toBeGreaterThanOrEqual(2);
    }
    for (const link of links) expect(destinations.has(link.id), `link target ${link.id} exists`).toBe(true);
  });
});
