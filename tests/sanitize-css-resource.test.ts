/**
 * Regression pin for the second-pass resource strip in src/render/sanitize.ts.
 *
 * DOMPurify (first pass) keeps srcset/poster/background and inline style attributes, so
 * the second pass — the AUTOLOAD_ATTRS loop plus the unsafe-inline-style check — is the
 * boundary that stops remote fetches from rendered Markdown. Every removal case below
 * except `data` must fail if that second pass regresses (DOMPurify already drops `data`,
 * so that case pins output only), and every
 * preservation case pins that fragment-only url(#id) references and plain safe styles
 * are NOT stripped. This file asserts observable output only and changes no behavior.
 */
import { describe, expect, it } from "vitest";
import { sanitizeRenderedHtml } from "../src/render/sanitize";

/** Parse an HTML fragment into a detached container so we can query it. */
function frag(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("sanitize second-pass resource pin (autoload attrs + unsafe inline styles)", () => {
  it("repro: strips background attr, remote style url, srcset, and obfuscated style together", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<table background="https://evil.test/bg.png">` +
        `<tr><td style="background:url(https://evil.test/x.png)">a</td></tr></table>` +
        `<img src="data:image/png;base64,iVBORw0KGgo=" srcset="https://evil.test/a.png 1x" alt="x">` +
        `<div style="background:u\\72l(https://evil.test/hidden.png)">b</div>`,
    );
    expect(html).not.toContain("evil.test");
    const root = frag(html);
    expect(root.querySelector("[background]")).toBeNull();
    expect(root.querySelector("[srcset]")).toBeNull();
    expect(root.querySelector("[style]")).toBeNull();
    expect(removedCount).toBeGreaterThanOrEqual(4);
  });

  it("removes srcset while keeping a safe embedded img src", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<img src="data:image/png;base64,iVBORw0KGgo=" ` +
        `srcset="https://evil.test/a.png 1x, https://evil.test/b.png 2x" alt="pic">`,
    );
    expect(html).not.toContain("evil.test");
    const img = frag(html).querySelector("img");
    expect(img?.hasAttribute("srcset")).toBe(false);
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(removedCount).toBeGreaterThanOrEqual(1);
  });

  it("removes poster while keeping benign attributes", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<div poster="https://evil.test/x.png" title="ok">hi</div>`,
    );
    expect(html).not.toContain("evil.test");
    const root = frag(html);
    expect(root.querySelector("[poster]")).toBeNull();
    expect(root.querySelector("div")?.getAttribute("title")).toBe("ok");
    expect(removedCount).toBeGreaterThanOrEqual(1);
  });

  it("removes background while keeping element content", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<table background="https://evil.test/bg.png"><tr><td>hi</td></tr></table>`,
    );
    expect(html).not.toContain("evil.test");
    const root = frag(html);
    expect(root.querySelector("[background]")).toBeNull();
    expect(root.textContent).toContain("hi");
    expect(removedCount).toBeGreaterThanOrEqual(1);
  });

  it("removes data while keeping user-navigable links", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<a data="https://evil.test/x" href="https://example.test/page">go</a>`,
    );
    expect(html).not.toContain("evil.test");
    const root = frag(html);
    expect(root.querySelector("[data]")).toBeNull();
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.test/page");
    expect(removedCount).toBeGreaterThanOrEqual(1);
  });

  it("removes inline style with a remote url() while keeping text", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<p style="background:url(https://evil.test/x.png)">hi</p>`,
    );
    expect(html).not.toContain("evil.test");
    const root = frag(html);
    expect(root.querySelector("p")?.hasAttribute("style")).toBe(false);
    expect(root.querySelector("p")?.textContent).toBe("hi");
    expect(removedCount).toBeGreaterThanOrEqual(1);
  });

  it("removes inline style with @import", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<p style="@import url(https://evil.test/x.css); color:red">hi</p>`,
    );
    expect(html).not.toContain("evil.test");
    expect(frag(html).querySelector("p")?.hasAttribute("style")).toBe(false);
    expect(removedCount).toBeGreaterThanOrEqual(1);
  });

  it("removes inline style with image-set() including the -webkit- prefix", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<p style="background-image:image-set(url(https://evil.test/a.png) 1x)">a</p>` +
        `<p style="background-image:-webkit-image-set(url(https://evil.test/b.png) 1x)">b</p>`,
    );
    expect(html).not.toContain("evil.test");
    expect(frag(html).querySelector("[style]")).toBeNull();
    expect(removedCount).toBeGreaterThanOrEqual(2);
  });

  it("removes obfuscated styles (escape and comment)", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<div style="background:u\\72l(https://evil.test/hidden.png)">a</div>` +
        `<div style="background:u/**/rl(https://evil.test/hidden2.png)">b</div>`,
    );
    expect(html).not.toContain("evil.test");
    expect(frag(html).querySelector("[style]")).toBeNull();
    expect(removedCount).toBeGreaterThanOrEqual(2);
  });

  it("preserves fragment-only url(#id) inline styles", () => {
    const { html, removedCount } = sanitizeRenderedHtml(
      `<p style="background:url(#thumb)">hi</p>`,
    );
    const p = frag(html).querySelector("p");
    expect(p?.hasAttribute("style")).toBe(true);
    expect(p?.getAttribute("style")).toContain("#thumb");
    expect(removedCount).toBe(0);
  });

  it("preserves safe inline styles without resource references", () => {
    const { html, removedCount } = sanitizeRenderedHtml(`<p style="color:red">hi</p>`);
    const p = frag(html).querySelector("p");
    expect(p?.hasAttribute("style")).toBe(true);
    expect(p?.getAttribute("style")).toContain("red");
    expect(removedCount).toBe(0);
  });
});
