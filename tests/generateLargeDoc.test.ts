import { describe, expect, it } from "vitest";
import { generateLargeDoc, mulberry32 } from "./perf/generateLargeDoc";

describe("generateLargeDoc", () => {
  it("is deterministic for the same seed and target", () => {
    expect(generateLargeDoc(50_000, 7)).toBe(generateLargeDoc(50_000, 7));
  });

  it("differs across seeds", () => {
    expect(generateLargeDoc(50_000, 7)).not.toBe(generateLargeDoc(50_000, 8));
  });

  it("meets the target size with bounded overshoot", () => {
    const doc = generateLargeDoc(100_000, 7);
    const bytes = Buffer.byteLength(doc, "utf8");
    expect(bytes).toBeGreaterThanOrEqual(100_000);
    expect(bytes).toBeLessThan(100_000 + 8_192);
  });

  it("contains the representative block mix", () => {
    const doc = generateLargeDoc(60_000, 7);
    expect(doc).toContain("[[toc]]");
    expect(doc).toContain("```ts");
    expect(doc).toContain("```mermaid");
    expect(doc).toContain("| Block | Width | Keep whole |");
    expect(doc).toMatch(/\[!(note|tip|warning|danger)\]/);
    expect(doc).toContain("- [ ]");
    expect(doc).toContain("$$");
    expect(doc).toMatch(/\[\^fn\d+\]/);
  });

  it("rejects non-positive targets", () => {
    expect(() => generateLargeDoc(0)).toThrow();
    expect(() => generateLargeDoc(-5)).toThrow();
  });

  it("mulberry32 is stable", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(Array.from({ length: 5 }, () => a())).toEqual(
      Array.from({ length: 5 }, () => b()),
    );
  });
});
