// @vitest-environment node
import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openPdf, type PdfDocument } from "../src/pdf/engine";
import { Journal } from "../src/pdf/journal";
import { encrypted, engine, linkedDocument, longDocument, tinyPng } from "./helpers/pdfCorpus";

beforeAll(async () => { await engine(); });

/** Every page's text in order, read by PDFium. */
const texts = (doc: PdfDocument): string[] => Array.from({ length: doc.pageCount }, (_, i) => doc.pageText(i));
/** The first line of each page of a `longDocument` ("Page N line 1 ..."), as page numbers. */
const order = (doc: PdfDocument): number[] => texts(doc).map(text => Number(/Page (\d+) line 1 /.exec(text)?.[1] ?? 0));

/** The same, read by the second parser. */
async function secondParser(bytes: Uint8Array, password?: string): Promise<{ pages: number; texts: string[] }> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0, ...(password ? { password } : {}) });
  try {
    const pdf = await task.promise;
    const all: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) all.push((await (await pdf.getPage(i)).getTextContent()).items.map(item => ("str" in item ? item.str : "")).join(" "));
    return { pages: pdf.numPages, texts: all };
  } finally { await task.destroy(); }
}

/**
 * True when `needle` occurs in the raw bytes or in any Flate stream of the file, as a literal or
 * as a hex string (PDFium writes text operands as `<50616765...>`).
 */
function containsAnywhere(bytes: Uint8Array, needle: string): boolean {
  const hex = Buffer.from(needle, "latin1").toString("hex");
  const found = (haystack: string): boolean => haystack.includes(needle) || haystack.toLowerCase().includes(hex);
  const text = Buffer.from(bytes).toString("latin1");
  if (found(text)) return true;
  const stream = /stream\r?\n/g;
  for (let match = stream.exec(text); match; match = stream.exec(text)) {
    const end = text.indexOf("endstream", match.index);
    try { if (found(inflateSync(Buffer.from(bytes.subarray(match.index + match[0].length, end))).toString("latin1"))) return true; } catch { /* not Flate */ }
  }
  return false;
}

const prefixOf = (prefix: Uint8Array, bytes: Uint8Array): boolean => bytes.length > prefix.length && prefix.every((value, i) => bytes[i] === value);

describe("PDF pages (P2, lossless)", () => {
  it("moves, rotates, duplicates and inserts pages, saved incrementally over an untouched original", async () => {
    const original = await longDocument(4, 2);
    const doc = await openPdf(original);
    try {
      doc.movePages([3], 0);
      expect(order(doc)).toEqual([4, 1, 2, 3]);
      doc.rotatePage(1, 1);
      expect(doc.pageSize(1)).toEqual({ width: 792, height: 612 });
      doc.duplicatePages([0]);
      expect(order(doc)).toEqual([4, 4, 1, 2, 3]);
      doc.insertBlank(5, 300, 400);
      doc.insertPdf(linkedDocument(), 0);
      expect(doc.pageCount).toBe(8);
      expect(doc.pageText(0)).toContain("Hello PDF world");
      const saved = doc.save("incremental");
      expect(prefixOf(original, saved)).toBe(true);
      const reopened = await openPdf(saved);
      try {
        expect(reopened.pageCount).toBe(8);
        expect(order(reopened).slice(2, 7)).toEqual([4, 4, 1, 2, 3]);
        expect(reopened.pageSize(4)).toEqual({ width: 792, height: 612 }); // the rotated page, after the two inserted
        expect(reopened.pageSize(7)).toEqual({ width: 300, height: 400 });
      } finally { reopened.close(); }
      const second = await secondParser(saved);
      expect(second.pages).toBe(8);
      expect(second.texts[0]).toContain("Hello PDF world");
      expect(second.texts[2]).toContain("Page 4 line 1");
    } finally { doc.close(); }
  });

  it("deletes pages; after a full rewrite the deleted text is gone from the bytes, which an incremental save would keep", async () => {
    const doc = await openPdf(await longDocument(3, 2));
    try {
      doc.deletePages([1]);
      expect(order(doc)).toEqual([1, 3]);
      expect(containsAnywhere(doc.save("incremental"), "Page 2 line 1")).toBe(true);
      const full = doc.save("full");
      expect(containsAnywhere(full, "Page 2 line 1")).toBe(false);
      expect(containsAnywhere(full, "Page 3 line 1")).toBe(true);
      expect((await secondParser(full)).pages).toBe(2);
      expect(() => doc.deletePages([0, 1])).toThrow("at least one page");
    } finally { doc.close(); }
  });

  it("inserts a PNG as a page of its own size and extracts pages to a new PDF", async () => {
    const doc = await openPdf(await longDocument(3, 2));
    try {
      doc.insertImage(1, tinyPng(), "png", 40, 20);
      expect(doc.pageSize(1)).toEqual({ width: 30, height: 15 });
      const image = doc.render(1, 1);
      expect([image.data[0], image.data[1], image.data[2]]).toEqual([255, 0, 0]);
      expect(() => doc.insertImage(0, new Uint8Array([1, 2, 3]), "png", 10, 10)).toThrow("could not be read");
      expect(doc.pageCount).toBe(4);
      const extracted = await openPdf(doc.extract([3, 0]));
      try { expect(order(extracted)).toEqual([3, 1]); } finally { extracted.close(); }
    } finally { doc.close(); }
  });

  it("keeps a file's encryption in both save modes", async () => {
    const locked = await encrypted(await longDocument(2, 1), "s3cret");
    const doc = await openPdf(locked, "s3cret");
    try {
      doc.rotatePage(0, 1);
      for (const bytes of [doc.save("incremental"), doc.save("full")]) {
        await expect(openPdf(bytes)).rejects.toMatchObject({ code: "password" });
        const again = await openPdf(bytes, "s3cret");
        try { expect(again.pageSize(0)).toEqual({ width: 792, height: 612 }); } finally { again.close(); }
        expect((await secondParser(bytes, "s3cret")).pages).toBe(2);
      }
    } finally { doc.close(); }
  });

  it("journal: undo and redo replay from the original; a delete marks the save as removing", async () => {
    const original = await longDocument(3, 1);
    const journal = new Journal(original);
    let doc = await openPdf(original);
    journal.record(doc, { op: "move", pages: [2], to: 0 });
    journal.record(doc, { op: "delete", pages: [1] });
    expect(order(doc)).toEqual([3, 2]);
    expect(journal.removes).toBe(true);
    doc.close();
    doc = await journal.undo();
    expect(order(doc)).toEqual([3, 1, 2]);
    expect(journal.removes).toBe(false);
    doc.close();
    doc = await journal.redo();
    expect(order(doc)).toEqual([3, 2]);
    doc.close();
    doc = await journal.undo();
    journal.record(doc, { op: "rotate", pages: [0], quarterTurns: -1 });
    expect(journal.canRedo).toBe(false);
    expect(journal.applied.map(edit => edit.op)).toEqual(["move", "rotate"]);
    doc.close();
  });

  it("a failed edit records nothing", async () => {
    const original = await longDocument(2, 1);
    const journal = new Journal(original);
    const doc = await openPdf(original);
    try {
      expect(() => journal.record(doc, { op: "move", pages: [5], to: 0 })).toThrow(RangeError);
      expect(journal.canUndo).toBe(false);
    } finally { doc.close(); }
  });
});
