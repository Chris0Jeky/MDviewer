// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openPdf, PdfOpenError } from "../src/pdf/engine";
import { damagedXref, encrypted, engine, linkedDocument, longDocument } from "./helpers/pdfCorpus";

beforeAll(async () => { await engine(); });

describe("PDF engine (P1 open and read)", () => {
  it("reads pages, sizes, text and the outline of a hand-assembled file", async () => {
    const doc = await openPdf(linkedDocument());
    try {
      expect(doc.pageCount).toBe(2);
      expect(doc.pageSize(0)).toEqual({ width: 612, height: 792 });
      expect(doc.pageSize(1)).toEqual({ width: 792, height: 612 }); // /Rotate 90 swaps the displayed size
      expect(doc.pageText(0)).toContain("Hello PDF world");
      const title = doc.textRuns(0).find(run => run.text.includes("Hello PDF world"))!;
      // 24 pt Helvetica at baseline 700: the run sits about 70-95 pt from the top, 72 pt from the left.
      expect(title.x).toBeGreaterThan(70);
      expect(title.x).toBeLessThan(76);
      expect(title.y).toBeGreaterThan(70);
      expect(title.y + title.height).toBeLessThan(100);
      expect(doc.outline()).toEqual([
        { title: "Introduction", page: 0, children: [] },
        { title: "Second page", page: 1, children: [] },
      ]);
    } finally { doc.close(); }
  });

  it("acts only on page jumps and http(s) links; every other action, remote GoTo included, is blocked", async () => {
    const doc = await openPdf(linkedDocument());
    try {
      const targets = doc.links(0).map(link => link.target);
      expect(targets).toContainEqual({ kind: "page", page: 1 });
      expect(targets).toContainEqual({ kind: "uri", uri: "https://example.org/" });
      const blocked = targets.filter(target => target.kind === "blocked");
      expect(blocked).toHaveLength(5); // javascript: URI, Launch, JavaScript, SubmitForm, GoToR
      expect(targets.some(target => target.kind === "uri" && /javascript/i.test(target.uri))).toBe(false);
    } finally { doc.close(); }
  });

  it("keeps a one-character text run (a page number) in the text layer", async () => {
    const doc = await openPdf(linkedDocument());
    try { expect(doc.textRuns(1).map(run => run.text)).toContain("7"); } finally { doc.close(); }
  });

  it("find and pageText leave no page handles behind on pages the view does not hold", async () => {
    const doc = await openPdf(await longDocument(40, 3));
    try {
      const cached = doc as unknown as { pages: Map<number, number>; texts: Map<number, number> };
      for (let i = 0; i < doc.pageCount; i++) doc.find(i, "fox");
      expect(doc.pageText(5)).toContain("Page 6");
      expect([cached.pages.size, cached.texts.size]).toEqual([0, 0]);
      doc.textRuns(3); // the view's own pages stay cached until released
      expect(cached.texts.size).toBe(1);
    } finally { doc.close(); }
  });

  it("finds text case-insensitively with its rectangles", async () => {
    const doc = await openPdf(linkedDocument());
    try {
      const matches = doc.find(0, "pdf world");
      expect(matches).toHaveLength(1);
      expect(matches[0]![0]!.width).toBeGreaterThan(50);
      expect(doc.find(0, "absent phrase")).toEqual([]);
    } finally { doc.close(); }
  });

  it("renders a page to RGBA pixels with dark text on white", async () => {
    const doc = await openPdf(linkedDocument());
    try {
      const image = doc.render(0, 1);
      expect([image.width, image.height]).toEqual([612, 792]);
      let dark = 0;
      for (let i = 0; i < image.data.length; i += 4) if (image.data[i]! < 80) dark++;
      expect(dark).toBeGreaterThan(200);
      expect(image.data[0]).toBe(255); // top-left corner is paper
    } finally { doc.close(); }
  });

  it("clamps a huge zoom to the bitmap caps", async () => {
    const doc = await openPdf(linkedDocument());
    try {
      const image = doc.render(0, 1000);
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(16_384);
      expect(image.width * image.height).toBeLessThanOrEqual(32_000_000);
    } finally { doc.close(); }
  });

  it("asks for a password, refuses a wrong one and opens with the right one", async () => {
    const locked = await encrypted(linkedDocument(), "s3cret");
    await expect(openPdf(locked)).rejects.toMatchObject({ code: "password" });
    await expect(openPdf(locked, "wrong")).rejects.toBeInstanceOf(PdfOpenError);
    const doc = await openPdf(locked, "s3cret");
    try { expect(doc.pageText(0)).toContain("Hello PDF world"); } finally { doc.close(); }
  });

  it("reports a non-PDF as a format error and recovers a damaged cross-reference table", async () => {
    await expect(openPdf(new TextEncoder().encode("# Not a PDF"))).rejects.toMatchObject({ code: "format" });
    const doc = await openPdf(damagedXref(linkedDocument()));
    try { expect(doc.pageCount).toBe(2); } finally { doc.close(); }
  });

  it("opens 300 pages quickly and keeps text reachable on the last page", async () => {
    const bytes = await longDocument(300);
    const started = performance.now();
    const doc = await openPdf(bytes);
    try {
      expect(doc.pageCount).toBe(300);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(doc.pageText(299)).toContain("Page 300 line 30");
      doc.releasePage(299);
      expect(doc.pageText(299)).toContain("Page 300 line 1 ");
    } finally { doc.close(); }
  }, 60_000);

  it("produces corpus files a second parser (pdf.js) accepts", async () => {
    for (const bytes of [linkedDocument(), await longDocument(3)]) {
      const task = getDocument({ data: bytes.slice(), verbosity: 0 });
      expect((await task.promise).numPages).toBeGreaterThan(1);
      await task.destroy();
    }
  });

  it("rejects page indices outside the document", async () => {
    const doc = await openPdf(linkedDocument());
    try { expect(() => doc.pageText(2)).toThrow(RangeError); } finally { doc.close(); }
  });
});
