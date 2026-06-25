import { describe, it, expect } from "vitest";
import { buildStylesheet } from "../src/paginate/cssBuilder";
import { DEFAULT_SETTINGS, MARGIN_MM, type Settings } from "../src/app/settings";

function css(patch: Partial<Settings> = {}): string {
  return buildStylesheet({ ...DEFAULT_SETTINGS, ...patch });
}

/** Normalize whitespace so assertions are insensitive to formatting choices. */
function squish(s: string): string {
  return s.replace(/\s+/g, " ").toLowerCase();
}

describe("cssBuilder: always-present dynamic scaffolding", () => {
  // Note: buildStylesheet concatenates the raw print.css base with the dynamic @page
  // block. Under Vitest (css:false) the `?raw` CSS import resolves empty, so these
  // assertions target only the DYNAMIC half that buildStylesheet always generates.
  // The static break-rule base (break-inside:avoid …) lives in print.css and is
  // verified to ship by the dom-contract test and exercised for real by the E2E suite.
  it("returns a non-trivial CSS string", () => {
    const out = css();
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(100);
  });

  it("includes an @page block", () => {
    expect(css()).toMatch(/@page\b/);
  });

  it("suppresses header/footer chrome on the first page (@page :first)", () => {
    expect(squish(css())).toContain("@page :first");
  });

  it("sets the doctitle named string from h1/h2 (string-set)", () => {
    const out = squish(css());
    expect(out).toContain("string-set:");
    expect(out).toContain("doctitle");
  });

  it("declares the @footnote area rule", () => {
    expect(squish(css())).toContain("@footnote");
  });
});

describe("cssBuilder: paper size", () => {
  it("emits A4 size when paperSize is a4", () => {
    expect(squish(css({ paperSize: "a4" }))).toMatch(/size:\s*a4/);
  });

  it("emits letter size when paperSize is letter", () => {
    expect(squish(css({ paperSize: "letter" }))).toMatch(/size:\s*letter/);
  });
});

describe("cssBuilder: margins", () => {
  it("emits the millimetre margin for the chosen preset", () => {
    for (const preset of ["narrow", "normal", "wide"] as const) {
      const out = squish(css({ margins: preset }));
      expect(out).toContain(`margin: ${MARGIN_MM[preset]}mm`);
    }
  });

  it("a different preset changes the emitted margin value", () => {
    const narrow = squish(css({ margins: "narrow" }));
    const wide = squish(css({ margins: "wide" }));
    expect(narrow).not.toBe(wide);
    expect(narrow).toContain(`${MARGIN_MM.narrow}mm`);
    expect(wide).toContain(`${MARGIN_MM.wide}mm`);
  });
});

describe("cssBuilder: running header toggle", () => {
  it("includes the running-header content when runningHeader is non-empty", () => {
    const out = css({ runningHeader: "Quarterly Report" });
    expect(out).toContain("Quarterly Report");
    // header content lives in an @top running region
    expect(squish(out)).toMatch(/@top-(left|center|right)/);
  });

  it("omits running-header content when runningHeader is empty", () => {
    const out = css({ runningHeader: "" });
    expect(out).not.toContain("Quarterly Report");
  });

  it("escapes/embeds arbitrary header text without breaking the block", () => {
    const out = css({ runningHeader: "A & B: draft" });
    expect(out).toContain("A & B: draft");
    expect(out).toMatch(/@page\b/);
  });
});

describe("cssBuilder: page numbers toggle", () => {
  it("emits counter(page)/counter(pages) when showPageNumbers is true", () => {
    const out = squish(css({ showPageNumbers: true }));
    expect(out).toContain("counter(page)");
    expect(out).toContain("counter(pages)");
  });

  it("omits the page-number counter when showPageNumbers is false", () => {
    const out = squish(css({ showPageNumbers: false }));
    expect(out).not.toContain("counter(pages)");
  });
});

describe("cssBuilder: TOC target-counter toggle", () => {
  it("emits the nav.toc target-counter leader rule when showToc is true", () => {
    const out = squish(css({ showToc: true }));
    expect(out).toContain("nav.toc");
    expect(out).toContain("target-counter");
  });

  it("omits the toc target-counter rule when showToc is false", () => {
    const out = squish(css({ showToc: false }));
    expect(out).not.toContain("target-counter");
  });
});

describe("cssBuilder: line-numbers toggle", () => {
  it("emits line-number CSS when showLineNumbers is true", () => {
    const out = squish(css({ showLineNumbers: true }));
    expect(out).toContain("with-line-numbers");
  });

  it("omits line-number CSS when showLineNumbers is false", () => {
    const out = squish(css({ showLineNumbers: false }));
    expect(out).not.toContain("with-line-numbers");
  });
});

describe("cssBuilder: determinism", () => {
  it("is a pure function of settings (same input -> identical output)", () => {
    const s: Partial<Settings> = { paperSize: "letter", margins: "wide", showToc: false };
    expect(css(s)).toBe(css(s));
  });
});
