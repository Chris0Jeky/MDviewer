import { describe, expect, it } from "vitest";
import { sanitizeMermaidSvg } from "../src/render/sanitize";

/** Parse a sanitized fragment into a detached container so we can query it. */
function frag(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("sanitizeMermaidSvg narrower policy", () => {
  it("keeps local url(#x) fragment references", () => {
    const { html } = sanitizeMermaidSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:url(#x)}</style>' +
        '<rect fill="url(#x)" width="10" height="10"/></svg>',
    );
    const root = frag(html);
    expect(root.querySelector("style")?.textContent).toContain("url(#x)");
    expect(root.querySelector("rect")?.getAttribute("fill")).toBe("url(#x)");
  });

});
