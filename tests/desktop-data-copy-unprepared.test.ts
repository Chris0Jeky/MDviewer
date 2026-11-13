import { describe, expect, it } from "vitest";
import { dataViewOf, readableCopy } from "../src/desktop/reader/dataCopy";

// The YAML parser loads lazily; menus ask about the active document before (or without) that load.
describe("data copy before the YAML parser has loaded", () => {
  it("answers no data instead of throwing", () => {
    const doc = { name: "notes.yaml", text: "a: 1\n" };
    expect(() => dataViewOf(doc)).not.toThrow();
    expect(dataViewOf(doc)).toBeNull();
    expect(readableCopy(doc)).toBeNull();
  });
});
