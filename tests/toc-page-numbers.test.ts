import { describe, expect, it } from "vitest";
import { CLASSES, PAGEDJS } from "../src/app/dom";
import { fillTocPageNumbers } from "../src/paginate/handler";

/**
 * Pinning test for the decoded-id lookup in fillTocPageNumbers: TOC hrefs carry
 * the percent-encoded fragment while the heading ids hold the decoded value, so
 * the lookup must decodeURIComponent before resolving. A link with no target
 * must be skipped without touching dataset.page.
 */
describe("fillTocPageNumbers", () => {
  it("fills dataset.page from stamped page and skips missing", () => {
    const idOnPage1 = "caf\u00E9";
    const idOnPage2 = "sec:tion/2";

    const host = document.createElement("div");
    host.innerHTML = [
      `<nav class="${CLASSES.toc}">`,
      `<a class="${CLASSES.tocLink}" href="#${encodeURIComponent(idOnPage1)}">one</a>`,
      `<a class="${CLASSES.tocLink}" href="#${encodeURIComponent(idOnPage2)}">two</a>`,
      `<a class="${CLASSES.tocLink}" href="#no-such-heading">dangling</a>`,
      `</nav>`,
      `<div class="${PAGEDJS.pageClass}" ${PAGEDJS.pageNumberAttr}="1"><h1 id="${idOnPage1}">one</h1></div>`,
      `<div class="${PAGEDJS.pageClass}" ${PAGEDJS.pageNumberAttr}="2"><h2 id="${idOnPage2}">two</h2></div>`,
    ].join("");

    fillTocPageNumbers(host);

    const links = host.querySelectorAll<HTMLAnchorElement>(`a.${CLASSES.tocLink}`);
    expect(links).toHaveLength(3);
    expect(links[0]?.getAttribute("href")).toBe(`#${encodeURIComponent(idOnPage1)}`);
    expect(links[0]?.dataset.page).toBe("1");
    expect(links[1]?.dataset.page).toBe("2");
    expect(links[2]?.dataset.page).toBeUndefined();
  });
});
