import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

/**
 * Running-header truth, pinned against the real Paged.js engine (UX-10 / BUG-9).
 *
 * `@top-right` reads `string(doctitle, start)` so content pushed onto a new page by
 * the no-slice guarantee keeps its OWN section's header instead of the heading that
 * happens to start there — and `titlePage` blanks the page-1 chrome only. Both were
 * unit-asserted (cssBuilder) but never proven in a paginated engine until now.
 *
 * Paged.js renders margin text as generated `::after` content on
 * `.pagedjs_margin-content`, so these assertions read computed pseudo-content rather
 * than DOM text. `counter(page)` expressions stay unresolved at computed-value time,
 * so page numbers are asserted as chrome presence, never as "1 / n" strings.
 */

const PARA = "A paragraph of research notes. ".repeat(25);
const CODE = (lines: number, tag: string): string =>
  ["```ts", ...Array.from({ length: lines }, (_, i) => `// ${tag} line ${i};`), "```"].join(
    "\n",
  );

// Three sections, each with a tall keep-whole block: across font metrics at least one
// pushed block must share its page with the next section's heading (the test fails
// loudly if the fixture ever stops producing that discriminating shape).
const DOC = [
  "# Alpha",
  "",
  PARA,
  PARA,
  CODE(70, "alpha"),
  "",
  "# Beta",
  "",
  PARA,
  PARA,
  CODE(70, "beta"),
  "",
  "# Gamma",
  "",
  PARA,
  PARA,
  CODE(40, "gamma"),
  "",
].join("\n");

interface PageHeader {
  topLeft: string;
  topRight: string;
  bottom: string;
  /** h1/h2 texts on this page, in flow order (margin boxes excluded). */
  heads: string[];
  /** True when the page's first flow content is its first heading. */
  firstHeadingOpensPage: boolean;
}

async function readHeaders(page: Page): Promise<PageHeader[]> {
  return page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll("#paged-output .pagedjs_page"));
    const strip = (raw: string): string =>
      raw === "none" ? "" : raw.replace(/^"|"$/g, "");
    const readBox = (sheet: Element, box: string): string => {
      const inner = sheet.querySelector(`.pagedjs_margin-${box} .pagedjs_margin-content`);
      if (!inner) return "";
      return strip(getComputedStyle(inner, "::after").content);
    };
    // A heading opens the page only when nothing precedes it at any wrapper level:
    // Paged.js nests flow content, so a bare previousElementSibling check can lie.
    const opensPage = (heading: Element): boolean => {
      let el: Element | null = heading;
      while (el && !el.classList.contains("pagedjs_page_content")) {
        if (el.previousElementSibling) return false;
        el = el.parentElement;
      }
      return el !== null;
    };
    return pages.map((sheet) => {
      const heads = Array.from(sheet.querySelectorAll("h1, h2"))
        .filter((h) => !h.closest(".pagedjs_margin"))
        .map((h) => (h.textContent ?? "").trim());
      const first = Array.from(sheet.querySelectorAll("h1, h2")).find(
        (h) => !h.closest(".pagedjs_margin"),
      );
      return {
        topLeft: readBox(sheet, "top-left"),
        topRight: readBox(sheet, "top-right"),
        bottom: readBox(sheet, "bottom-center"),
        heads,
        firstHeadingOpensPage: first ? opensPage(first) : false,
      };
    });
  });
}

test("pushed content keeps its own section header (string start, not first)", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => window.__mdviewer!.updateSettings({ titlePage: false }));
  await loadMarkdownIntoApp(page, DOC, "headers.md");
  expect(await waitForPagination(page)).toBeGreaterThanOrEqual(3);

  // `start` resolves to the section in effect where the page begins: the running
  // section, unless the page's own first heading opens it.
  let running = "";
  let discriminating = 0;
  for (const header of await readHeaders(page)) {
    const expected =
      header.heads.length > 0 && header.firstHeadingOpensPage ? header.heads[0]! : running;
    expect(header.topRight).toBe(expected);
    if (header.heads.length > 0 && !header.firstHeadingOpensPage) {
      // The UX-10 shape: pushed content above a new heading must NOT take its name.
      expect(header.topRight).not.toBe(header.heads[0]);
      discriminating += 1;
    }
    if (header.heads.length > 0) running = header.heads[header.heads.length - 1]!;
  }
  expect(discriminating).toBeGreaterThanOrEqual(1);
});

test("titlePage blanks page-1 chrome only; off shows it", async ({ page }) => {
  // Each half loads fresh with explicit settings so no shared localStorage leaks
  // between the two halves of the toggle.
  await page.goto("/");
  await page.evaluate(() =>
    window.__mdviewer!.updateSettings({ titlePage: true, runningHeader: "Probe Header" }),
  );
  await loadMarkdownIntoApp(page, DOC, "headers.md");
  expect(await waitForPagination(page)).toBeGreaterThanOrEqual(2);
  const blanked = await readHeaders(page);
  expect(blanked[0]!.topLeft).toBe("");
  expect(blanked[0]!.topRight).toBe("");
  expect(blanked[0]!.bottom).toBe("");
  // …but later pages keep chrome, proving the blanking is :first-scoped, not global.
  expect(blanked[1]!.topLeft).toBe("Probe Header");
  expect(blanked[1]!.topRight).not.toBe("");
  expect(blanked[1]!.bottom).not.toBe("");

  await page.goto("/");
  await page.evaluate(() =>
    window.__mdviewer!.updateSettings({ titlePage: false, runningHeader: "Probe Header" }),
  );
  await loadMarkdownIntoApp(page, DOC, "headers.md");
  expect(await waitForPagination(page)).toBeGreaterThanOrEqual(2);
  const chromed = await readHeaders(page);
  expect(chromed[0]!.topLeft).toBe("Probe Header");
  expect(chromed[0]!.topRight).toBe(chromed[0]!.heads[0]);
  expect(chromed[0]!.bottom).not.toBe("");
});
