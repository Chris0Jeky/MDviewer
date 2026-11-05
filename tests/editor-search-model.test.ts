import { describe, expect, it } from "vitest";
import { findMatches, MAX_SEARCH_MATCHES, nextMatch, replaceMatches, replacementByteLength } from "../src/ui/EditorSearchModel";

describe("source search: literal matching", () => {
  it("finds punctuation literally, without interpreting a regular expression", () => {
    expect(findMatches("a.*[x] aZZx a.*[x]", "a.*[x]").matches).toEqual([
      { start: 0, end: 6 }, { start: 12, end: 18 },
    ]);
  });

  it("supports case matching without changing native UTF-16 offsets", () => {
    expect(findMatches("İ😀 Foo foo FOO", "foo").matches).toEqual([
      { start: 4, end: 7 }, { start: 8, end: 11 }, { start: 12, end: 15 },
    ]);
    expect(findMatches("İ😀 Foo foo FOO", "foo", true).matches).toEqual([{ start: 8, end: 11 }]);
  });

  it("uses non-overlapping matches and never creates empty-query matches", () => {
    expect(findMatches("aaaaa", "aa").matches).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
    expect(findMatches("hello", "")).toEqual({ matches: [], limited: false });
  });

  it("rejects oversized regex compilation before it can strand search", () => {
    expect(() => findMatches("small", "a".repeat(100_000))).toThrow("maximum 2,000 characters");
  });

  it("bounds stored ranges and distinguishes exactly-at-limit from truncation", () => {
    const exact = findMatches("a".repeat(MAX_SEARCH_MATCHES), "a");
    expect(exact.matches).toHaveLength(MAX_SEARCH_MATCHES);
    expect(exact.limited).toBe(false);
    const truncated = findMatches("a".repeat(MAX_SEARCH_MATCHES + 1), "a");
    expect(truncated.matches).toHaveLength(MAX_SEARCH_MATCHES);
    expect(truncated.limited).toBe(true);
    expect(truncated.matches.at(-1)).toEqual({ start: MAX_SEARCH_MATCHES - 1, end: MAX_SEARCH_MATCHES });
  });
});

describe("source search: navigation", () => {
  const matches = [{ start: 2, end: 4 }, { start: 8, end: 10 }, { start: 14, end: 16 }];

  it("uses the caret or selection, then wraps in either direction", () => {
    expect(nextMatch(matches, { start: 0, end: 0 }, 1)).toBe(0);
    expect(nextMatch(matches, { start: 5, end: 5 }, 1)).toBe(1);
    expect(nextMatch(matches, { start: 5, end: 5 }, -1)).toBe(0);
    expect(nextMatch(matches, matches[2]!, 1)).toBe(0);
    expect(nextMatch(matches, matches[0]!, -1)).toBe(2);
  });

  it("handles missing results without inventing an index", () => {
    expect(nextMatch([], { start: 0, end: 0 }, 1)).toBe(-1);
  });
});

describe("source search: replacement construction", () => {
  it("preflights multiplied UTF-8 size without constructing the replacement result", () => {
    const source = "x".repeat(10_000);
    expect(replacementByteLength(source, findMatches(source, "x").matches, "é".repeat(10_000)))
      .toBe(200_000_000);
    expect(replacementByteLength("Kk", findMatches("Kk", "k").matches, "😀")).toBe(8);
  });

  it("counts surrogate pairs formed at a replacement boundary exactly", () => {
    expect(replacementByteLength("x\udc00", [{ start: 0, end: 1 }], "\ud800")).toBe(4);
    expect(replacementByteLength("\ud800x", [{ start: 1, end: 2 }], "\udc00")).toBe(4);
  });
  it("treats replacement dollars and markup as ordinary source text", () => {
    const source = "cat and cat";
    expect(replaceMatches(source, findMatches(source, "cat").matches, "$&<b>"))
      .toBe("$&<b> and $&<b>");
  });

  it("supports deletion and preserves unmatched Unicode source exactly", () => {
    const source = "😀aİ a尾";
    expect(replaceMatches(source, findMatches(source, "a").matches, "")).toBe("😀İ 尾");
    expect(replaceMatches(source, [], "unused")).toBe(source);
  });
});
