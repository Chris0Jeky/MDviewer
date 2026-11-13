/**
 * Synthetic PDFs for the PDF workbench tests (PDF_WORKBENCH.md, "Proof per slice"). Every file is
 * built here, from strings or by PDFium itself; nothing is copied from a real document.
 */
import { readFileSync } from "node:fs";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { heap, loadEngine } from "../../src/pdf/engine";

export const wasmBinary = (): ArrayBuffer => {
  const bytes = readFileSync("node_modules/@embedpdf/pdfium/dist/pdfium.wasm");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
export const engine = (): Promise<WrappedPdfiumModule> => loadEngine(wasmBinary());

/** Assemble a PDF from object bodies (object n is `objects[n - 1]`) with a correct xref. */
export function assemble(objects: string[], trailer = "/Root 1 0 R", header = "%PDF-1.7"): Uint8Array {
  let out = `${header}\n%âãÏÓ\n`;
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0));
}

const stream = (content: string): string => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

/**
 * Two pages. Page 1: a title line, a link to page 2, an https link, and four links that must
 * never act (javascript: URI, Launch, JavaScript, SubmitForm). Page 2 is rotated 90°. Two
 * bookmarks. A document OpenAction that is JavaScript.
 */
export function linkedDocument(): Uint8Array {
  const link = (y: number, action: string): string =>
    `<< /Type /Annot /Subtype /Link /Rect [72 ${y} 300 ${y + 20}] /Border [0 0 0] ${action} >>`;
  return assemble([
    "<< /Type /Catalog /Pages 2 0 R /Outlines 11 0 R /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [7 0 R 8 0 R 9 0 R 10 0 R 14 0 R 15 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 /Resources << /Font << /F1 5 0 R >> >> /Contents 16 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream("BT /F1 24 Tf 72 700 Td (Hello PDF world) Tj ET BT /F1 12 Tf 72 600 Td (Go to page two) Tj ET"),
    link(600, "/Dest [4 0 R /XYZ 0 792 0]"),
    link(560, "/A << /S /URI /URI (https://example.org/) >>"),
    link(520, "/A << /S /URI /URI (javascript:alert\\(1\\)) >>"),
    link(480, "/A << /S /Launch /F (calc.exe) >>"),
    "<< /Type /Outlines /First 12 0 R /Last 13 0 R /Count 2 >>",
    "<< /Title (Introduction) /Parent 11 0 R /Next 13 0 R /Dest [3 0 R /Fit] >>",
    "<< /Title (Second page) /Parent 11 0 R /Prev 12 0 R /Dest [4 0 R /Fit] >>",
    link(440, "/A << /S /JavaScript /JS (app.alert\\(2\\)) >>"),
    link(400, "/A << /S /SubmitForm /F << /FS /URL /F (https://example.org/submit) >> >>"),
    stream("BT /F1 18 Tf 72 700 Td (Second page) Tj ET"),
  ]);
}

/** `pages` pages of `lines` text lines each, built by PDFium (the 300-page and 1,000-page cases). */
export async function longDocument(pages: number, lines = 30): Promise<Uint8Array> {
  const P = await engine();
  const M = P.pdfium;
  const doc = P.FPDF_CreateNewDocument();
  for (let i = 0; i < pages; i++) {
    const page = P.FPDFPage_New(doc, i, 612, 792);
    for (let l = 0; l < lines; l++) {
      const text = `Page ${i + 1} line ${l + 1} the quick brown fox jumps over the lazy dog`;
      const object = P.FPDFPageObj_NewTextObj(doc, "Helvetica", 10);
      const n = (text.length + 1) * 2, p = M.wasmExports.malloc(n);
      M.stringToUTF16(text, p, n);
      P.FPDFText_SetText(object, p);
      M.wasmExports.free(p);
      P.FPDFPageObj_Transform(object, 1, 0, 0, 1, 54, 740 - l * 22);
      P.FPDFPage_InsertObject(page, object);
    }
    P.FPDFPage_GenerateContent(page);
    P.FPDF_ClosePage(page);
  }
  try { return save(P, doc); } finally { P.FPDF_CloseDocument(doc); }
}

/** A copy of `bytes` encrypted with a user password. */
export async function encrypted(bytes: Uint8Array, user: string): Promise<Uint8Array> {
  const P = await engine();
  const M = P.pdfium;
  const p = M.wasmExports.malloc(bytes.length);
  heap(P).set(bytes, p);
  const doc = P.FPDF_LoadMemDocument(p, bytes.length, "");
  try {
    if (!P.EPDF_SetEncryption(doc, user, `${user}-owner`, 0xfffffffc)) throw new Error("encryption failed");
    return save(P, doc);
  } finally { P.FPDF_CloseDocument(doc); M.wasmExports.free(p); }
}

/** A copy whose `startxref` points nowhere (PDFium must rebuild the cross-reference table). */
export function damagedXref(bytes: Uint8Array): Uint8Array {
  const text = String.fromCharCode(...bytes);
  const at = text.lastIndexOf("startxref");
  return Uint8Array.from(`${text.slice(0, at)}startxref\n999999\n%%EOF\n`, c => c.charCodeAt(0));
}

function save(P: WrappedPdfiumModule, doc: number): Uint8Array {
  const M = P.pdfium;
  const writer = P.PDFiumExt_OpenFileWriter();
  try {
    if (!P.FPDF_SaveAsCopy(doc, writer, 2)) throw new Error("save failed");
    const n = P.PDFiumExt_GetFileWriterSize(writer), p = M.wasmExports.malloc(n);
    P.PDFiumExt_GetFileWriterData(writer, p, n);
    const out = heap(P).slice(p, p + n);
    M.wasmExports.free(p);
    return out;
  } finally { P.PDFiumExt_CloseFileWriter(writer); }
}
