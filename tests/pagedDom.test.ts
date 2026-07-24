import { describe, expect, it } from "vitest";
import type { BlockRect, PagedSnapshot, Rect } from "./helpers/pagedDom";
import { splitAtomicOffenders } from "./helpers/pagedDom";

const rect = (top: number, bottom: number): Rect => ({
  top,
  right: 100,
  bottom,
  left: 0,
  width: 100,
  height: bottom - top,
});

const block = (pageIndex: number, sourceHeight: number): BlockRect => ({
  tag: "pre.shiki",
  rect: rect(0, 60),
  pageIndex,
  atomicId: "atomic-1",
  sourceHeight,
});

const snapshot = (blocks: BlockRect[]): PagedSnapshot => ({
  pageCount: 2,
  pages: [0, 1].map((index) => ({ index, outer: rect(0, 100), content: rect(0, 100) })),
  blocks,
});

describe("splitAtomicOffenders", () => {
  it("rejects a duplicated short block even when fragment heights sum above one page", () => {
    const offenders = splitAtomicOffenders(snapshot([block(0, 60), block(1, 60)]));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain("60.0px source height fitting");
  });

  it("allows a genuinely over-tall splittable block on consecutive pages", () => {
    expect(splitAtomicOffenders(snapshot([block(0, 120), block(1, 120)]))).toEqual([]);
  });
});
