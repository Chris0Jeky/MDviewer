import { test, expect } from "@playwright/test";
import { loadMarkdownIntoApp, waitForPagination } from "../helpers/pagedDom";

for (const title of ["Footnotes", "fn1"]) {
 test(`first and repeated citations retain a paginated note target (${title})`, async ({ page }) => {
  await page.goto("/");
  await loadMarkdownIntoApp(page, `# ${title}\n\nFirst[^note]. Again[^note].\n\n[^note]: One retained note.`);
  await waitForPagination(page);
  const destinations = await page.locator("#paged-output").evaluate((host) => {
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>("sup.footnote-ref a"));
    return links.map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      return Array.from(host.querySelectorAll("[id]")).filter((el) => el.id === id && el.hasAttribute("data-footnote-marker")).length;
    });
  });
  expect(destinations).toHaveLength(2);
  expect(destinations).toEqual([1, 1]);
});
}
