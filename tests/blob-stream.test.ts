import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

describe("jsdom Blob streaming with native Web Streams", () => {
  it("preserves File bytes for both real gzip decompression and DOM FileReader", async () => {
    const source = Uint8Array.of(0, 255, ...new TextEncoder().encode("Unicode: café → λ"));
    const compressed = new Uint8Array(gzipSync(source));
    const file = new File([compressed], "fixture.gz", { type: "application/gzip" });
    const decoded = await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).bytes();
    expect(decoded).toEqual(source);

    const reader = new FileReader();
    const read = new Promise<ArrayBuffer>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
    });
    reader.readAsArrayBuffer(file);
    expect(new Uint8Array(await read)).toEqual(compressed);
  });

  it("keeps malformed compressed bytes observable as a real decoder failure", async () => {
    const corrupt = new Blob(["not a gzip stream"]);
    const decoded = new Response(corrupt.stream().pipeThrough(new DecompressionStream("gzip"))).bytes();
    await expect(decoded).rejects.toThrow();
  });
});
