import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Tauri adds a hash of every inline <style> and <script> in the shipped HTML to the CSP. A hash
 * voids 'unsafe-inline', and the PDF workspace relies on it for the styles Paged.js injects:
 * pagination then yields no pages (#297's native smoke). Keep desktop.html free of inline blocks.
 */
describe("desktop.html under the Tauri CSP", () => {
  const html = readFileSync("desktop.html", "utf8");
  it("has no inline <style> block", () => expect(html).not.toMatch(/<style[\s>]/i));
  it("has no inline <script> block", () => expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i));
});
