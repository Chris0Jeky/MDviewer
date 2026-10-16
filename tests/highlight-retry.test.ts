import { describe, expect, it, vi } from "vitest";
import type { HighlighterCore } from "shiki/core";

const stub = vi.hoisted(() => ({
  calls: 0,
  impl: null as null | (() => Promise<HighlighterCore>),
}));

vi.mock("shiki/core", () => ({
  createHighlighterCore: () => {
    stub.calls += 1;
    if (!stub.impl) return Promise.reject(new Error("no stub impl"));
    return stub.impl();
  },
}));

vi.mock("shiki/engine/oniguruma", () => ({
  createOnigurumaEngine: () => ({}),
}));

async function freshModule() {
  vi.resetModules();
  stub.calls = 0;
  return import("../src/render/highlight");
}

describe("getHighlighter retry", () => {
  it("retries creation after a first failure", async () => {
    const mod = await freshModule();
    const fake = {} as HighlighterCore;
    let n = 0;
    stub.impl = () => {
      n += 1;
      if (n === 1) return Promise.reject(new Error("first creation failed"));
      return Promise.resolve(fake);
    };

    await expect(mod.getHighlighter()).rejects.toThrow("first creation failed");
    const hl = await mod.getHighlighter();
    expect(hl).toBe(fake);
    expect(n).toBe(2);
    expect(stub.calls).toBe(2);
  });

  it("shares one in-flight creation across concurrent callers", async () => {
    const mod = await freshModule();
    const fake = {} as HighlighterCore;
    let resolveGate!: (value: HighlighterCore) => void;
    const gate = new Promise<HighlighterCore>((resolve) => {
      resolveGate = resolve;
    });
    stub.impl = () => gate;

    const p1 = mod.getHighlighter();
    const p2 = mod.getHighlighter();
    expect(p1).toBe(p2);

    resolveGate(fake);
    await expect(p1).resolves.toBe(fake);
    await expect(p2).resolves.toBe(fake);
    expect(stub.calls).toBe(1);

    await expect(mod.getHighlighter()).resolves.toBe(fake);
    expect(stub.calls).toBe(1);
  });
});
