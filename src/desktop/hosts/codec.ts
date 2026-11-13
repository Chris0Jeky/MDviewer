/**
 * Text files as the native host reads and writes them (`src-tauri/src/file_policy.rs`): the
 * browser host uses this to keep encodings and line endings byte-for-byte. Keep the two in step;
 * `tests/browser-codec.test.ts` runs the same cases as the Rust tests.
 */
export type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be";
export type Eol = "lf" | "crlf" | "cr" | "mixed" | "none";

export const MAX_FILE_BYTES = 25_000_000;
const ENCODING_ERROR = "This file is not valid UTF-8 or UTF-16 text. Save it as UTF-8 and try again.";

export function detectEncoding(bytes: Uint8Array): Encoding {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8-bom";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return "utf-8";
}

export function detectEol(text: string): Eol {
  const crlf = text.includes("\r\n");
  const cr = /\r(?!\n)/.test(text);
  const lf = /(?<!\r)\n/.test(text);
  const kinds = Number(crlf) + Number(cr) + Number(lf);
  if (kinds === 0) return "none";
  if (kinds > 1) return "mixed";
  return crlf ? "crlf" : cr ? "cr" : "lf";
}

/** Decode exactly as the native read does: no BOM in the text, line endings untouched. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: Encoding; eol: Eol } {
  // UTF-32 BOMs start like UTF-16 ones; refuse them rather than misread.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0)
    || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) throw new Error(ENCODING_ERROR);
  const encoding = detectEncoding(bytes);
  let text: string;
  try {
    if (encoding === "utf-16le" || encoding === "utf-16be") {
      if ((bytes.length - 2) % 2 !== 0) throw new Error(ENCODING_ERROR);
      text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(2));
    } else {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(encoding === "utf-8-bom" ? bytes.subarray(3) : bytes);
    }
  } catch {
    throw new Error(ENCODING_ERROR);
  }
  if (text.includes("\0")) throw new Error(ENCODING_ERROR);
  return { text, encoding, eol: detectEol(text) };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Bytes of `text` in `encoding`, with no line-ending change (a line patch keeps every ending). */
export function encodeRaw(text: string, encoding: Encoding): Uint8Array {
  if (LONE_SURROGATE.test(text)) throw new Error("This document contains an invalid Unicode character and cannot be saved exactly.");
  if (encoding === "utf-8" || encoding === "utf-8-bom") {
    const body = new TextEncoder().encode(text);
    if (encoding === "utf-8") return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const out = new Uint8Array(2 + text.length * 2);
  const view = new DataView(out.buffer);
  const little = encoding === "utf-16le";
  out.set(little ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let index = 0; index < text.length; index++) view.setUint16(2 + index * 2, text.charCodeAt(index), little);
  return out;
}

export type EncodeResult = { bytes: Uint8Array } | { error: "mixed-line-endings" | "too-large" };

/**
 * Editor text back to the file's conventions (`encode_markdown`): endings normalised to LF, then
 * written in the file's uniform style; a trailing newline is kept or omitted exactly as `text`
 * has it. A mixed source needs consent (`acceptLf`) and is then written as LF.
 */
export function encodeText(text: string, encoding: Encoding, eol: Eol, acceptLf: boolean): EncodeResult {
  if (eol === "mixed" && !acceptLf) return { error: "mixed-line-endings" };
  const normalized = text.replace(/\r\n?/g, "\n");
  const ending = eol === "crlf" ? "\r\n" : eol === "cr" ? "\r" : "\n";
  const bytes = encodeRaw(ending === "\n" ? normalized : normalized.replaceAll("\n", ending), encoding);
  return bytes.length > MAX_FILE_BYTES ? { error: "too-large" } : { bytes };
}

/** The lower-case extension when it is one MDviewer opens (`document_extension`), else null. */
export const DOCUMENT_EXTENSIONS = ["md", "markdown", "json", "jsonc", "jsonl", "ndjson", "txt", "log", "yaml", "yml", "toml", "csv", "tsv"] as const;
export function documentExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(extension) ? extension : null;
}

/** SHA-256 of the raw bytes, hex. */
export async function digestOf(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}
