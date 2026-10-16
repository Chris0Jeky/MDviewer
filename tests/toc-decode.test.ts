import { describe, expect, it } from "vitest";
import { fillTocPageNumbers } from "../src/paginate/handler";

/** Build a host with one resolvable TOC link and one lone-percent fragment. */
function buildHost(): { host: HTMLElement; bad: HTMLAnchorElement; good: HTMLAnchorElement } {
  const host = document.createElement("div");

  const page = document.createElement("div");
  page.className = "pagedjs_page";
  page.setAttribute("data-page-number", "3");
  const heading = document.createElement("h1");
  heading.id = "intro";
  heading.textContent = "Intro";
  page.appendChild(heading);
  host.appendChild(page);

  const good = document.createElement("a");
  good.className = "toc-link";
  good.setAttribute("href", "#intro");
  good.textContent = "Intro";
  host.appendChild(good);

  const bad = document.createElement("a");
  bad.className = "toc-link";
  bad.setAttribute("href", "#100%");
  bad.textContent = "Bad";
  host.appendChild(bad);

  return { host, bad, good };
}

describe("fillTocPageNumbers with undecodable fragments", () => {
  it("skips a lone-percent link without throwing and still resolves other links", () => {
    const { host, bad, good } = buildHost();

    expect(() => fillTocPageNumbers(host)).not.toThrow();

    expect(bad.dataset.page).toBeUndefined();
    expect(good.dataset.page).toBe("3");
  });
});
