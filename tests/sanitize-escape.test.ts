import { describe, expect, it } from "vitest";
import { sanitizeRenderedHtml } from "../src/render/sanitize";

// From the security review of #347: untrusted HTML (an opened .html page, or raw HTML in Markdown).
describe("inline styles that could beacon out or cover the app", () => {
  it("drops a style with an unterminated url( (CSS still fetches it)", () => {
    const { html } = sanitizeRenderedHtml('<div style="background-image:url(https://evil.test/b.gif">x</div>');
    expect(html).not.toContain("evil.test");
  });

  it("drops position: fixed and sticky, which could overlay the app's own controls", () => {
    for (const style of ["position:fixed;inset:0", "POSITION : Fixed", "position: sticky; top: 0"]) {
      const { html } = sanitizeRenderedHtml(`<a href="#x" style="${style};z-index:9">cover</a>`);
      expect(html, style).not.toMatch(/fixed|sticky/i);
    }
  });

  it("keeps fragment url(#id) and ordinary positioning", () => {
    expect(sanitizeRenderedHtml('<div style="mask:url(#m)">a</div>').html).toContain("url(#m)");
    expect(sanitizeRenderedHtml('<div style="mask:url( #m)">a</div>').html).toContain("url( #m)");
    expect(sanitizeRenderedHtml('<div style="position:relative;top:2px">a</div>').html).toContain("position:relative");
  });
});
