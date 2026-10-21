import { describe, expect, it } from "vitest";
import { ReaderSession, decodeMarkdown, drainSerially } from "../src/desktop/session";

describe("desktop reader session", () => {
  it("preserves multiple documents and refuses a session beyond its memory bound", () => {
    const session = new ReaderSession(10, 2);
    expect(session.append([{ name: "a.md", text: "first" }])).toEqual([]);
    expect(session.append([{ name: "b.md", text: "123456" }])[0]).toContain("memory limit");
    expect(session.documents.map(d => d.name)).toEqual(["a.md"]);
    session.append([{ name: "b.md", text: "two" }]);
    expect(session.append([{ name: "c.md", text: "x" }])[0]).toContain("2 documents");
    session.close(session.documents[0]!.id);
    expect(session.append([{ name: "c.md", text: "x" }])).toEqual([]);
  });

  it("measures UTF-8 bytes and preserves existing selection on a passive import", () => {
    const session = new ReaderSession(5, 4);
    session.append([{ name: "a.md", text: "é" }]);
    const first = session.activeId;
    session.append([{ name: "b.md", text: "é" }], false);
    expect(session.activeId).toBe(first);
    expect(session.append([{ name: "c.md", text: "é" }])).toHaveLength(1);
  });

  it("keeps a document selected when closing the active tab", () => {
    const session = new ReaderSession();
    session.append([{ name: "a.md", text: "a" }, { name: "b.md", text: "b" }]);
    session.close(session.activeId!);
    expect(session.active?.name).toBe("b.md");
  });

  it("decodes BOM encodings and refuses malformed bytes", () => {
    expect(decodeMarkdown(new Uint8Array([0xef, 0xbb, 0xbf, 65]))).toBe("A");
    expect(decodeMarkdown(new Uint8Array([0xff, 0xfe, 65, 0]))).toBe("A");
    expect(decodeMarkdown(new Uint8Array([0xfe, 0xff, 0, 65]))).toBe("A");
    expect(() => decodeMarkdown(new Uint8Array([0xff, 65]))).toThrow();
  });

  it("drains again when another native launch arrives during an outstanding drain", async () => {
    const resolvers: Array<() => void> = [];
    let active = 0, maximum = 0, calls = 0;
    const drain = drainSerially(async () => {
      calls += 1; active += 1; maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => resolvers.push(resolve));
      active -= 1;
    });
    const first = drain();
    void drain(); void drain();
    expect(calls).toBe(1);
    resolvers.shift()!();
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toBe(2);
    resolvers.shift()!();
    await first;
    expect(maximum).toBe(1);
  });
});
