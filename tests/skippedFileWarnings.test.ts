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

  it("keeps the plural type-rejection wording", () => {
    expect(skippedFileWarnings(["a.png", "b.txt"], []).map((w) => w.message)).toEqual([
      "Skipped 2 files (a.png, b.txt) — only .md and .markdown are supported.",
    ]);
  });

  it("returns nothing for an empty batch", () => {
    expect(skippedFileWarnings([], [])).toEqual([]);
  });

  it("keeps all three refusal categories distinct in the same batch", () => {
    const messages = skippedFileWarnings(["image.png"], ["huge.md"], ["broken.md"]).map((w) => w.message);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain("only .md");
    expect(messages[1]).toContain("25 MB");
    expect(messages[2]).toContain("could not be read");
    expect(messages[2]).toContain("broken.md");
  });

  it("counts several unreadable files separately from unsupported types", () => {
    const warnings = skippedFileWarnings([], [], ["one.md", "two.markdown"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe("Skipped 2 files (one.md, two.markdown) — could not be read. Try opening the file again.");
    expect(warnings[0]?.message).not.toContain("only .md");
  });
});
