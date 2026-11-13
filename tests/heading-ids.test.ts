import { describe, expect, it } from "vitest";
import { createMarkdown, renderMarkdown, SLUGIFY } from "../src/render/markdown";
import { buildPaginationSource } from "../src/render/buildSource";
import { fillTocPageNumbers } from "../src/paginate/handler";
import { DEFAULT_SETTINGS } from "../src/app/settings";

/** Heading IDs are Unicode letters, marks, numbers, `_` and `-` (NFC); see IMPLEMENTATION_SPEC. */
describe("SLUGIFY: Unicode heading ids (#204)", () => {
  it("keeps every existing ASCII id byte-for-byte", () => {
    expect(SLUGIFY("Hello World")).toBe("hello-world");
    expect(SLUGIFY("  Trim  Me  ")).toBe("trim-me");
    expect(SLUGIFY("Symbols! @ # $ %")).toBe("symbols----");
    expect(SLUGIFY("1. Introduction")).toBe("sec-1-introduction");
    expect(SLUGIFY("_private Notes")).toBe("_private-notes");
    expect(SLUGIFY("What's new in v2.0?")).toBe("whats-new-in-v20");
  });

  it("keeps accented Latin and folds combining forms to one NFC id", () => {
    expect(SLUGIFY("Café Crème")).toBe("café-crème");
    expect(SLUGIFY("Café")).toBe("café");
    expect(SLUGIFY("Café")).toBe(SLUGIFY("Café"));
    expect(SLUGIFY("ÜBER")).toBe("über");
  });

  it("keeps CJK, Cyrillic and Greek, joining words with hyphens", () => {
    expect(SLUGIFY("日本語の見出し")).toBe("日本語の見出し");
    expect(SLUGIFY("日本語 見出し")).toBe("日本語-見出し");
    expect(SLUGIFY("Привет Мир")).toBe("привет-мир");
    expect(SLUGIFY("Ελληνικά")).toBe("ελληνικά");
  });

  it("keeps RTL letters and vowel marks but drops invisible bidi controls", () => {
    expect(SLUGIFY("مرحبا بالعالم")).toBe("مرحبا-بالعالم");
    expect(SLUGIFY("‏שָׁלוֹם‎")).toBe("שָׁלוֹם");
    expect(SLUGIFY("‫مرحبا‬")).toBe("مرحبا");
  });

  it("treats emoji like other symbols: dropped, never an invalid id", () => {
    expect(SLUGIFY("Party 🎉")).toBe("party-");
    expect(SLUGIFY("Ünïcödé Report 🎉")).toBe("ünïcödé-report-");
    expect(SLUGIFY("🎉")).toBe("sec-");
    // Variation selectors and the keycap mark leave with their emoji (#351 review).
    expect(SLUGIFY("⚠️ Warning")).toBe("sec--warning");
    expect(SLUGIFY("⚠️ Warning")).toBe(SLUGIFY("⚠ Warning"));
    expect(SLUGIFY("❤️ Love")).toBe("sec--love");
    expect(SLUGIFY("1️⃣ Step")).toBe("sec-1-step");
  });

  it("gives a heading that is all punctuation a query-safe id", () => {
    expect(SLUGIFY("?!")).toBe("sec-");
    expect(SLUGIFY("")).toBe("sec-");
    expect(SLUGIFY("---")).toBe("sec----");
  });

  it("prefixes a leading digit or combining mark so the id stays a plain selector start", () => {
    expect(SLUGIFY("٣ أسباب")).toBe("sec-٣-أسباب");
    expect(SLUGIFY("́x")).toBe("sec-́x");
  });

  it("never emits an id the browser would have to decode (no percent signs)", () => {
    for (const title of ["日本語", "Café", "a%b", "مرحبا"]) expect(SLUGIFY(title)).not.toContain("%");
  });
});

function html(src: string): string {
  return renderMarkdown(createMarkdown(null, { ...DEFAULT_SETTINGS }), src).html;
}

function render(src: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html(src);
  return root;
}

/** The decoded fragment a link addresses, as the browser and handler.ts both resolve it. */
function target(href: string | null): string {
  return decodeURIComponent((href ?? "").slice(1));
}

describe("rendered heading ids, TOC and permalinks agree (#204)", () => {
  const SRC = [
    "[[toc]]", "",
    "# 日本語", "", "## Café", "", "## Café", "", "## 日本語", "", "### 🎉", "", "### ?!", "", "### مرحبا",
  ].join("\n");

  it("de-duplicates with -N and keeps decomposed and precomposed headings together", () => {
    const ids = Array.from(render(SRC).querySelectorAll("h1[id],h2[id],h3[id]"), (h) => h.id);
    expect(ids).toEqual(["日本語", "café", "café-1", "日本語-1", "sec-", "sec--1", "مرحبا"]);
  });

  it("points every TOC entry and permalink at exactly one heading id", () => {
    const root = render(SRC);
    const ids = Array.from(root.querySelectorAll("h1[id],h2[id],h3[id]"), (h) => h.id);
    const tocTargets = Array.from(root.querySelectorAll("nav.toc a"), (a) => target(a.getAttribute("href")));
    expect(tocTargets).toEqual(ids);
    const permalinks = Array.from(root.querySelectorAll("h1 a.header-anchor,h2 a.header-anchor,h3 a.header-anchor"),
      (a) => target(a.getAttribute("href")));
    expect(permalinks).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps an authored id verbatim and still dedupes against generated ones", () => {
    const root = render("# Intro {#日本語}\n\n## 日本語\n");
    expect(Array.from(root.querySelectorAll("h1,h2"), (h) => h.id)).toEqual(["日本語", "日本語-1"]);
  });

  it("resolves an authored percent-encoded link to the heading id", () => {
    const root = render("# 日本語\n\n[jump](#日本語)\n");
    const link = root.querySelector("p a")!;
    expect(link.getAttribute("href")).toBe("#%E6%97%A5%E6%9C%AC%E8%AA%9E");
    expect(root.querySelector(`[id="${target(link.getAttribute("href"))}"]`)).toBe(root.querySelector("h1"));
  });

  it("changes no heading text and adds no executable or remote URL", () => {
    const root = render(SRC);
    expect(Array.from(root.querySelectorAll("h1,h2,h3"), (h) => h.textContent?.replace("¶", "").trim()))
      .toEqual(["日本語", "Café", "Café", "日本語", "🎉", "?!", "مرحبا"]);
    for (const a of root.querySelectorAll("a[href]")) expect(a.getAttribute("href")).toMatch(/^#/);
  });
});

describe("TOC page numbers for Unicode headings (#204)", () => {
  it("fillTocPageNumbers resolves raw and percent-encoded fragments to the same page", () => {
    const source = buildPaginationSource(
      new XMLSerializer().serializeToString(render("# 日本語\n\n## Café\n\n## 日本語\n")).replace(/^<div[^>]*>|<\/div>$/g, ""),
      { ...DEFAULT_SETTINGS, showToc: true },
    );
    const host = document.createElement("div");
    host.append(source);
    // Move each heading onto its own simulated page, as Paged.js would.
    const headings = Array.from(host.querySelectorAll<HTMLElement>("h1[id],h2[id]")).filter((h) => !h.closest("nav"));
    headings.forEach((h, i) => {
      const page = document.createElement("div");
      page.className = "pagedjs_page";
      page.setAttribute("data-page-number", String(i + 2));
      h.replaceWith(page);
      page.append(h);
    });
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>("nav.toc a.toc-link"));
    expect(links).toHaveLength(3);
    links[1]!.setAttribute("href", `#${encodeURIComponent("café")}`);
    fillTocPageNumbers(host);
    expect(links.map((a) => a.dataset.page)).toEqual(["2", "3", "4"]);
  });
});
