import { describe, expect, it } from "vitest";
import { skippedFileWarnings } from "../src/app/App";

describe("skippedFileWarnings", () => {
  it("keeps a type rejection and a size refusal from one drop side by side", () => {
    const warnings = skippedFileWarnings(["image.png"], ["huge.md"]);
    expect(warnings.map((w) => w.message)).toEqual([
      "Skipped “image.png” — only .md and .markdown files are supported.",
      "Skipped “huge.md” — over the 25 MB limit.",
    ]);
  });

  it("counts several oversized files instead of quoting them as one name", () => {
    expect(skippedFileWarnings([], ["a.md", "b.md"]).map((w) => w.message)).toEqual([
      "Skipped 2 files (a.md, b.md) — over the 25 MB limit.",
    ]);
  });

  it("returns nothing for an empty batch", () => {
    expect(skippedFileWarnings([], [])).toEqual([]);
  });
});
