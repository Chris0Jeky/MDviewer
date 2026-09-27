import { beforeAll, describe, expect, it } from "vitest";
import type { HighlighterCore } from "shiki/core";
import { generateLargeDoc, mulberry32 } from "./perf/generateLargeDoc";
import { createMarkdown, renderMarkdown } from "../src/render/markdown";
import { getHighlighter } from "../src/render/highlight";
import { DEFAULT_SETTINGS } from "../src/app/settings";

let hl: HighlighterCore;

beforeAll(async () => {
  hl = await getHighlighter();
}, 30_000);

describe("generateLargeDoc", () => {
  it("is deterministic for the same seed and target", () => {
    expect(generateLargeDoc(50_000, 7)).toBe(generateLargeDoc(50_000, 7));
  });

  it("differs across seeds", () => {
    expect(generateLargeDoc(50_000, 7)).not.toBe(generateLargeDoc(50_000, 8));
  });

  it("meets the target size with bounded overshoot", () => {
    for (const target of [100_000, 2_000_000]) {
      const doc = generateLargeDoc(target, 7);
      const bytes = Buffer.byteLength(doc, "utf8");
      expect(bytes).toBeGreaterThanOrEqual(target);
      expect(bytes).toBeLessThan(target + 8_192);
    }
  });

  it("contains the representative block mix", () => {
    const doc = generateLargeDoc(60_000, 7);
    expect(doc).toContain("[[toc]]");
    expect(doc).toContain("```ts");
    expect(doc).toContain("```mermaid");
    expect(doc).toContain("| Block | Width | Keep whole |");
    expect(doc).toMatch(/^:::(note|tip|warning|danger) /m);
    expect(doc).toContain("- [ ]");
    expect(doc).toContain("$$");
    expect(doc).toMatch(/\[\^fn\d+\]/);
  });

  it("rejects non-positive targets", () => {
    expect(() => generateLargeDoc(0)).toThrow();
    expect(() => generateLargeDoc(-5)).toThrow();
  });

  it("renders generated callouts as .callout elements, not blockquotes", () => {
    const md = createMarkdown(hl, { ...DEFAULT_SETTINGS });
    const { html } = renderMarkdown(md, generateLargeDoc(20_000, 7));
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.querySelectorAll(".callout").length).toBeGreaterThan(0);
    // A 20 kB Shiki render in jsdom runs 3-5 s under a loaded full-suite run,
    // at or past vitest's 5 s default; match the 30 s budget of the Shiki tests.
  }, 30_000);

  it("mulberry32 is stable", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(Array.from({ length: 5 }, () => a())).toEqual(
      Array.from({ length: 5 }, () => b()),
    );
  });
});
