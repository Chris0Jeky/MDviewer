import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

test("first and repeated citations retain a paginated note target", async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, "# Footnotes\n\nFirst[^note]. Again[^note].\n\n[^note]: One retained note.");
  await waitForPagination(page);
  const destinations = await page.locator("#paged-output").evaluate((host) => {
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>("sup.footnote-ref a"));
    return links.map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      return Array.from(host.querySelectorAll("[id]")).filter((el) => el.id === id).length;
    });
  });
  expect(destinations).toHaveLength(2);
  expect(destinations).toEqual([1, 1]);
});
