// jsdom exposes Blob.arrayBuffer() but not Blob.stream(). Shiki's bundled WASM
// now uses the latter with native Web Streams and gzip decompression. Preserve
// jsdom's Blob/File identity for FileReader and supply only the missing method.
if (typeof Blob.prototype.stream !== "function") {
  Object.defineProperty(Blob.prototype, "stream", {
    configurable: true,
    writable: true,
    value(this: Blob): ReadableStream<Uint8Array<ArrayBuffer>> {
      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        start: async (controller) => {
          try {
            controller.enqueue(new Uint8Array(await this.arrayBuffer()));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
    },
  });
}
