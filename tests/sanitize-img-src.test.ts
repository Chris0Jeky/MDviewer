import { describe, expect, it } from "vitest";
import { sanitizeRenderedHtml } from "../src/render/sanitize";

/** Parse a sanitized fragment into a detached container so we can query it. */
function frag(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

// The <img src> strip is pinned in markdown.test.ts ("blocks remote media..."); this pins
// the sibling branch that strips `src` from every non-img element.
describe("sanitize: non-img src strip", () => {
  it("drops src on a non-img element", () => {
    const result = sanitizeRenderedHtml('<span src="https://evil.test/x.png">x</span>');
    expect(result.html).not.toContain("evil.test");
    const span = frag(result.html).querySelector("span");
    expect(span).not.toBeNull();
    expect(span?.hasAttribute("src")).toBe(false);
    expect(result.removedCount).toBeGreaterThan(0);
  });
});
