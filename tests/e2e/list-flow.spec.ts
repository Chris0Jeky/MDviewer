import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { paginateFixture } from "../helpers/pagedDom";

const here = dirname(fileURLToPath(import.meta.url));
const CHECKLIST_MD = readFileSync(join(here, "..", "fixtures", "checklist.md"), "utf8");

/**
 * Trailing-blank cap for every non-last page (percent of the page content
 * height). Calibrated on both sides: the fixture measures 34% worst non-last
 * before the fix and 5% after; the real 610-line, 30-item checklist that
 * motivated this spec measures 76% worst non-last (four pages >= 39%) before
 * and 4% after (shrinking from 20 pages to 16). 20% keeps a double-digit
 * margin on both sides against font-driven break shifts.
 */
const MAX_TRAILING_PCT = 20;

/** Flow blocks whose union measures how far down a page content runs. */
const FLOW_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, pre, figure, table, .callout, hr, nav";

test.describe("checklist documents flow without blank sheets", () => {
  test("long checklist paginates with no mostly-blank page", async ({ page }) => {
    await page.goto("/");
    const snapshot = await paginateFixture(page, CHECKLIST_MD);

    // Sanity: multi-page output with the fixture's items present, or the fill
    // assertions below are vacuous.
    expect(snapshot.pageCount, "fixture should span multiple pages").toBeGreaterThanOrEqual(3);

    const fill = await page.evaluate(
      ({ flowSelector, source }: { flowSelector: string; source: string }) => {
        const host = document.getElementById("paged-output")!;
        const sheets = Array.from(host.querySelectorAll<HTMLElement>(".pagedjs_page"));
        // Document items only: the synthesized TOC nav carries its own short,
        // never-splitting li rows that must not dilute the fragmentation count.
        const docItems = Array.from(host.querySelectorAll(".pagedjs_page li")).filter(
          (el) => !el.closest("nav"),
        ).length;
        const sourceItems = (source.match(/^- \[[ x]\]/gm) ?? []).length;
        const pages = sheets.map((sheet, index) => {
          const content =
            sheet.querySelector<HTMLElement>(".pagedjs_page_content") ??
            sheet.querySelector<HTMLElement>(".pagedjs_area") ??
            sheet;
          const box = content.getBoundingClientRect();
          let maxBottom = box.top;
          for (const el of Array.from(content.querySelectorAll<HTMLElement>(flowSelector))) {
            const r = el.getBoundingClientRect();
            if (r.height < 1 || r.width < 1) continue;
            if (r.bottom > box.bottom + 2 || r.top < box.top - 2) continue;
            if (r.bottom > maxBottom) maxBottom = r.bottom;
          }
          return {
            index,
            trailingPct: ((box.bottom - maxBottom) / box.height) * 100,
          };
        });
        return { pageCount: sheets.length, docItems, sourceItems, pages };
      },
      { flowSelector: FLOW_SELECTOR, source: CHECKLIST_MD },
    );

    expect(fill.pageCount).toBe(snapshot.pageCount);
    expect(fill.sourceItems, "fixture task items").toBeGreaterThan(10);
    // Paged.js duplicates a split item's li shell onto the next page, so a
    // fragmenting checklist paginates MORE document items than the source has.
    // Before the fix this count was exactly equal (keep-whole, nothing split);
    // after the fix the 14-item fixture paginates 18.
    expect(
      fill.docItems,
      `expected split items to duplicate li shells (paged ${fill.docItems} vs source ${fill.sourceItems})`,
    ).toBeGreaterThan(fill.sourceItems);

    const offenders = fill.pages
      .filter((p) => p.index < fill.pageCount - 1 && p.trailingPct >= MAX_TRAILING_PCT)
      .map((p) => `page ${p.index + 1}: trailing blank ${p.trailingPct.toFixed(1)}%`);
    expect(
      offenders,
      `pages with more than ${MAX_TRAILING_PCT}% trailing blank (last page exempt):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  test("list items fragment with clean-split protection; inline code never hyphenates", async ({
    page,
  }) => {
    await page.goto("/");
    await paginateFixture(page, CHECKLIST_MD);

    const styles = await page.evaluate(() => {
      const host = document.getElementById("paged-output")!;
      const lis = Array.from(host.querySelectorAll<HTMLElement>(".pagedjs_page li")).map((li) => {
        const cs = getComputedStyle(li);
        return { breakInside: cs.breakInside, orphans: cs.orphans, widows: cs.widows };
      });
      const codes = Array.from(host.querySelectorAll<HTMLElement>(".pagedjs_page code"))
        .filter((code) => !code.closest("pre"))
        .map((code) => {
          const cs = getComputedStyle(code);
          return { hyphens: cs.hyphens, overflowWrap: cs.overflowWrap };
        });
      return { lis, codes };
    });

    expect(styles.lis.length, "paginated list items").toBeGreaterThan(10);
    for (const [i, li] of styles.lis.entries()) {
      expect(li.breakInside, `li #${i} must fragment (no keep-whole)`).toBe("auto");
      expect(li.orphans, `li #${i} orphans`).toBe("3");
      expect(li.widows, `li #${i} widows`).toBe("3");
    }

    expect(styles.codes.length, "paginated inline code chips").toBeGreaterThan(10);
    for (const [i, code] of styles.codes.entries()) {
      expect(code.hyphens, `code #${i} must never auto-hyphenate`).toBe("none");
      expect(code.overflowWrap, `code #${i} must wrap unbreakable tokens`).toBe("anywhere");
    }
  });

  test("nested code block stays whole and the long token stays inside its page", async ({
    page,
  }) => {
    await page.goto("/");
    await paginateFixture(page, CHECKLIST_MD);

    // The q-12 probe: a short fenced block inside a fragmenting item. The item
    // may split around it; the block itself must appear exactly once, nested
    // in its item, fully inside one page's content box. (Queried directly
    // rather than through the atomic snapshot: the point here is the nesting
    // geometry, which the snapshot's outermost-only rule deliberately skips.)
    const probe = await page.evaluate(() => {
      const host = document.getElementById("paged-output")!;
      const pres = Array.from(host.querySelectorAll<HTMLElement>(".pagedjs_page pre")).filter(
        (el) => (el.textContent ?? "").includes("LaneProbe"),
      );
      if (pres.length === 0) return { count: 0, inLi: false, straddles: true };
      const pre = pres[0]!;
      const sheet = pre.closest<HTMLElement>(".pagedjs_page")!;
      const content =
        sheet.querySelector<HTMLElement>(".pagedjs_page_content") ??
        sheet.querySelector<HTMLElement>(".pagedjs_area") ??
        sheet;
      const r = pre.getBoundingClientRect();
      const box = content.getBoundingClientRect();
      return {
        count: pres.length,
        inLi: pre.closest("li") !== null,
        straddles: r.top < box.top - 2 || r.bottom > box.bottom + 2,
      };
    });
    expect(probe.count, "nested probe block appears exactly once (not cloned)").toBe(1);
    expect(probe.inLi, "probe block stays nested in its list item").toBe(true);
    expect(probe.straddles, "probe block straddles a page boundary").toBe(false);

    // The q-11 token: 64 unbreakable characters that must wrap inside the page
    // column, never escape past its horizontal edge.
    const token = await page.evaluate(() => {
      const host = document.getElementById("paged-output")!;
      const code = Array.from(host.querySelectorAll<HTMLElement>(".pagedjs_page code")).find(
        (el) => !el.closest("pre") && (el.textContent ?? "").includes("a3f9c2e7"),
      );
      if (!code) return null;
      const sheet = code.closest<HTMLElement>(".pagedjs_page")!;
      const content =
        sheet.querySelector<HTMLElement>(".pagedjs_page_content") ??
        sheet.querySelector<HTMLElement>(".pagedjs_area") ??
        sheet;
      const r = code.getBoundingClientRect();
      const box = content.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        boxLeft: box.left,
        boxRight: box.right,
      };
    });
    expect(token, "the long unbreakable token is present in the paged output").not.toBeNull();
    expect(token!.left).toBeGreaterThanOrEqual(token!.boxLeft - 2);
    expect(token!.right).toBeLessThanOrEqual(token!.boxRight + 2);
  });
});
