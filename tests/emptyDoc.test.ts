import { describe, it, expect } from "vitest";
import { withEmptyDocWarning } from "../src/app/App";
import type { RenderWarning } from "../src/render/markdown";

/**
 * UX-12: an empty document paginates to one blank sheet, which is a valid render — so the
 * hint travels as a banner warning rather than as content. It must never reach the
 * paginated output, because that output IS the exported PDF.
 */
describe("withEmptyDocWarning", () => {
  const existing: RenderWarning[] = [{ kind: "lang", message: "unknown language" }];

  it("adds a content warning for a whitespace-only document", () => {
    const out = withEmptyDocWarning([], "   \n\n\t  ");
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("content");
    expect(out[0]?.message).toMatch(/empty/i);
  });

  it("adds a content warning for a completely empty document", () => {
    expect(withEmptyDocWarning([], "")).toHaveLength(1);
  });

  it("adds nothing when the document has any content", () => {
    expect(withEmptyDocWarning([], "# Title")).toEqual([]);
    expect(withEmptyDocWarning(existing, "text")).toBe(existing);
  });

  it("keeps existing warnings and leads with the hint", () => {
    const out = withEmptyDocWarning(existing, "  ");
    expect(out.map((w) => w.kind)).toEqual(["content", "lang"]);
    expect(existing, "the caller's array is not mutated").toHaveLength(1);
  });
});
