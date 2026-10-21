// @vitest-environment node
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pluginRequire = createRequire(require.resolve("@vscode/markdown-it-katex"));
const pluginKatex = pluginRequire("katex") as typeof import("katex");
const uri = require("fast-uri") as typeof import("fast-uri");

it("ignores inherited trust in the KaTeX copy resolved by the Markdown plugin", () => {
  // Exercise the wrapper's installed fallback, not only the renderer explicitly
  // injected by src/render/math.ts. Do not mutate Object.prototype in this test.
  const expression = String.raw`\href{https://example.test}{untrusted link}`;
  expect(pluginKatex.renderToString(expression, { trust: true, output: "html" })).toContain("<a ");

  const inheritedTrust = Object.assign(Object.create({ trust: true }), {
    strict: "ignore" as const,
    output: "html" as const,
  });
  expect(pluginKatex.renderToString(expression, inheritedTrust)).not.toContain("<a ");
});

it("canonicalizes encoded scheme-relative hosts in a single pass", () => {
  const encoded = "//%41.example/private";
  const canonical = "//a.example/private";
  expect(uri.normalize(encoded)).toBe(canonical);
  expect(uri.normalize(uri.normalize(encoded))).toBe(canonical);
  expect(uri.equal(encoded, canonical)).toBe(true);
  // Reserved separators must remain encoded so normalization cannot change the host boundary.
  expect(uri.normalize("//example.test%2fprivate")).toBe("//example.test%2Fprivate");
});
