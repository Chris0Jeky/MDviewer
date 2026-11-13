import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, decodeText, detectEol, documentExtension, encodeRaw, encodeText, type Encoding } from "../src/desktop/hosts/codec";

/** The same cases as the native tests in `src-tauri/src/file_policy.rs`; the two must agree. */
const ENCODINGS: Encoding[] = ["utf-8", "utf-8-bom", "utf-16le", "utf-16be"];
const TEXTS = ["", "café \u{1f4c4}", "a\nb\n", "a\r\nb\r\n", "a\rb\r", "a\nb", "a\r\nb", "\r\n"];
const bytes = (result: ReturnType<typeof encodeText>): Uint8Array => {
  if (!("bytes" in result)) throw new Error(result.error);
  return result.bytes;
};

describe("browser host codec (mirrors file_policy.rs)", () => {
  it("round-trips every encoding and uniform line ending byte for byte", () => {
    for (const encoding of ENCODINGS) {
      for (const text of TEXTS) {
        const source = bytes(encodeText(text, encoding, detectEol(text), false));
        const doc = decodeText(source);
        expect([doc.encoding, doc.eol]).toEqual([encoding, detectEol(text)]);
        expect(doc.text).toBe(text); // line endings are not normalised on read
        // A textarea edit yields LF; saving restores the original bytes.
        expect(bytes(encodeText(doc.text.replace(/\r\n?/g, "\n"), doc.encoding, doc.eol, false))).toEqual(source);
        expect(bytes(encodeText(doc.text, doc.encoding, doc.eol, false))).toEqual(source);
      }
    }
  });

  it("detects line endings as the native host does", () => {
    expect(["", "a", "a\nb", "a\r\nb", "a\rb", "a\r\nb\n", "a\r\r\n", "a\n\r"].map(detectEol))
      .toEqual(["none", "none", "lf", "crlf", "cr", "mixed", "mixed", "mixed"]);
  });

  it("needs consent for mixed line endings, then writes LF, and refuses oversize output", () => {
    expect(encodeText("a\r\nb\n", "utf-8", "mixed", false)).toEqual({ error: "mixed-line-endings" });
    expect(bytes(encodeText("a\r\nb\nc\r", "utf-8-bom", "mixed", true))).toEqual(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0a, 0x62, 0x0a, 0x63, 0x0a]));
    expect(encodeText("x".repeat(MAX_FILE_BYTES + 1), "utf-8", "none", false)).toEqual({ error: "too-large" });
  });

  it("decodes UTF-16 only with an explicit BOM", () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x23, 0, 0x20, 0, 0xe9, 0])).text).toBe("# é");
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0, 0x23, 0, 0x20, 0, 0xe9])).text).toBe("# é");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x3d, 0xd8, 0, 0xde])).text).toBe("😀");
  });

  it("refuses invalid text instead of replacing bytes", () => {
    for (const input of [[0xff], [0xc3, 0x28], [0xff, 0xfe, 0x23], [0xfe, 0xff, 0xd8, 0], [0xff, 0xfe, 0, 0, 0x23, 0, 0, 0], [0x23, 0, 0x78]]) {
      expect(() => decodeText(new Uint8Array(input)), String(input)).toThrow("not valid UTF-8 or UTF-16");
    }
  });

  it("never writes a replacement character for a lone surrogate", () => {
    for (const encoding of ENCODINGS) expect(() => encodeRaw("a\ud800b", encoding)).toThrow("invalid Unicode character");
  });

  it("keeps a line patch's endings exactly (encodeRaw does not touch them)", () => {
    expect(encodeRaw("a\r\nb\nc", "utf-16le")).toEqual(new Uint8Array([0xff, 0xfe, 0x61, 0, 0x0d, 0, 0x0a, 0, 0x62, 0, 0x0a, 0, 0x63, 0]));
  });

  it("opens the native document extensions only", () => {
    expect(["a.md", "B.MARKDOWN", "c.jsonl", "d.TSV", "e.log"].map(documentExtension)).toEqual(["md", "markdown", "jsonl", "tsv", "log"]);
    expect(["a.html", "md", "a.md.exe", ".bashrc"].map(documentExtension)).toEqual([null, null, null, null]);
  });
});
