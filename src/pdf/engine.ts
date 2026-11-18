/**
 * The only module that calls PDFium (docs/design/PDF_WORKBENCH.md, ADR-P0). Everything else in
 * src/pdf uses the small typed API below. Coordinates are CSS pixels at scale 1 (one PDF point)
 * in the page's displayed orientation, origin top-left.
 */
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";

export interface Rect { x: number; y: number; width: number; height: number }
export interface TextRun extends Rect { text: string }
export interface OutlineItem { title: string; page: number | null; children: OutlineItem[] }
/** Only `page` and http(s) `uri` targets act (design, security rule 2); every other kind is shown, never followed. */
export type LinkTarget =
  | { kind: "page"; page: number }
  | { kind: "uri"; uri: string }
  | { kind: "blocked"; reason: string };
export interface PageLink { rect: Rect; target: LinkTarget }

/** Why a document did not open; `password` means a (correct) password is needed. */
export class PdfOpenError extends Error {
  constructor(readonly code: "password" | "format" | "file" | "security" | "memory" | "unknown") {
    super(OPEN_MESSAGES[code]);
    this.name = "PdfOpenError";
  }
}
const OPEN_MESSAGES: Record<PdfOpenError["code"], string> = {
  password: "This PDF needs a password.",
  format: "This file is not a readable PDF.",
  file: "This PDF could not be read.",
  security: "This PDF uses an unsupported security handler.",
  memory: "This PDF is too large to open here.",
  unknown: "This PDF could not be opened.",
};
const ERROR_CODES: Record<number, PdfOpenError["code"]> = { 2: "file", 3: "format", 4: "password", 5: "security" };

/** Bitmap caps (design, "Caps"). */
export const MAX_BITMAP_SIDE = 16_384;
export const MAX_BITMAP_PIXELS = 32_000_000;
const URI_SCHEMES = /^https?:/i;
const ACTION_NAMES: Record<number, string> = { 2: "a link to another file", 4: "a launch action", 5: "an embedded-file link" };
const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;

let engine: Promise<WrappedPdfiumModule> | null = null;
/** Documents open on the current engine instance. */
let openDocuments = 0;

/**
 * Drop the engine when no document is open, so its WASM memory (which a running instance can never
 * shrink) becomes garbage and the next PDF starts a fresh, small instance (PDF_WORKBENCH.md, weight).
 * Returns whether it was dropped.
 */
export function unloadEngine(): boolean {
  if (openDocuments > 0 || !engine) return false;
  engine = null;
  return true;
}

/** The module's byte view of WASM memory (present at runtime, missing from the package's types). */
export function heap(P: WrappedPdfiumModule): Uint8Array {
  return (P.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

/** Load PDFium once. `wasmBinary` is for tests (Node); the app fetches the wasm from its own origin. */
export function loadEngine(wasmBinary?: ArrayBuffer): Promise<WrappedPdfiumModule> {
  engine ??= (async () => {
    const binary = wasmBinary ?? await fetchWasm();
    const module = await init({ wasmBinary: binary });
    module.PDFiumExt_Init();
    return module;
  })();
  engine.catch(() => { engine = null; });
  return engine;
}

async function fetchWasm(): Promise<ArrayBuffer> {
  const { default: url } = await import("@embedpdf/pdfium/pdfium.wasm?url");
  const response = await fetch(url);
  if (!response.ok) throw new Error("The PDF engine could not be loaded.");
  return response.arrayBuffer();
}

export async function openPdf(bytes: Uint8Array, password = ""): Promise<PdfDocument> {
  return new PdfDocument(await loadEngine(), bytes, password);
}

export class PdfDocument {
  readonly pageCount: number;
  private readonly memory: number;
  private doc: number;
  private readonly pages = new Map<number, number>();
  private readonly texts = new Map<number, number>();

  constructor(private readonly P: WrappedPdfiumModule, bytes: Uint8Array, password: string) {
    const M = P.pdfium;
    this.memory = M.wasmExports.malloc(Math.max(1, bytes.length));
    if (!this.memory) throw new PdfOpenError("memory");
    heap(P).set(bytes, this.memory);
    this.doc = P.FPDF_LoadMemDocument(this.memory, bytes.length, password);
    if (!this.doc) {
      const code = ERROR_CODES[P.FPDF_GetLastError()] ?? "unknown";
      M.wasmExports.free(this.memory);
      throw new PdfOpenError(code);
    }
    this.pageCount = P.FPDF_GetPageCount(this.doc);
    openDocuments += 1;
  }

  /** Displayed page size in points (the page's own rotation applied). */
  pageSize(index: number): { width: number; height: number } {
    this.check(index);
    const out = this.scratch(16);
    try {
      if (!this.P.FPDF_GetPageSizeByIndexF(this.doc, index, out)) throw new Error(`Page ${index + 1} has no size.`);
      const M = this.P.pdfium;
      return { width: M.getValue(out, "float"), height: M.getValue(out + 4, "float") };
    } finally { this.free(out); }
  }

  /** RGBA pixels of one page at `scale` device pixels per point, clamped to the bitmap caps. */
  render(index: number, scale: number): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } {
    const { width, height } = this.pageSize(index);
    const fit = Math.min(scale, MAX_BITMAP_SIDE / width, MAX_BITMAP_SIDE / height, Math.sqrt(MAX_BITMAP_PIXELS / (width * height)));
    const w = Math.max(1, Math.floor(width * fit)), h = Math.max(1, Math.floor(height * fit));
    const P = this.P;
    const bitmap = P.FPDFBitmap_Create(w, h, 1);
    if (!bitmap) throw new Error("Not enough memory to draw this page.");
    try {
      P.FPDFBitmap_FillRect(bitmap, 0, 0, w, h, 0xffffffff);
      P.FPDF_RenderPageBitmap(bitmap, this.page(index), 0, 0, w, h, 0, FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER);
      const stride = P.FPDFBitmap_GetStride(bitmap), buffer = P.FPDFBitmap_GetBuffer(bitmap);
      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) pixels.set(heap(P).subarray(buffer + row * stride, buffer + row * stride + w * 4), row * w * 4);
      return { width: w, height: h, data: pixels };
    } finally { P.FPDFBitmap_Destroy(bitmap); }
  }

  /** Text runs (one per line segment) for the selection layer, find and copy. */
  textRuns(index: number): TextRun[] {
    const P = this.P, tp = this.text(index);
    const count = P.FPDFText_CountRects(tp, 0, -1);
    const runs: TextRun[] = [];
    const box = this.scratch(32);
    try {
      for (let i = 0; i < count; i++) {
        if (!P.FPDFText_GetRect(tp, i, box, box + 8, box + 16, box + 24)) continue;
        const [left, top, right, bottom] = this.doubles(box);
        const text = this.wide((buf, len) => P.FPDFText_GetBoundedText(tp, left, top, right, bottom, buf, len / 2) * 2);
        if (!text.trim()) continue;
        runs.push({ text, ...this.toView(index, left, top, right, bottom) });
      }
    } finally { this.free(box); }
    return runs;
  }

  /**
   * Run `use` on a page's text handle. A page the view already holds stays cached; any other page is
   * closed again afterwards, so a whole-document find does not keep every page parsed in WASM memory.
   */
  private withText<T>(index: number, use: (tp: number) => T): T {
    const cached = this.texts.has(index);
    const hadPage = this.pages.has(index);
    try { return use(this.text(index)); } finally { if (!cached && !hadPage) this.releasePage(index); }
  }

  /** All of a page's text, in reading order as PDFium extracts it. */
  pageText(index: number): string {
    return this.withText(index, tp => this.pageTextOf(tp));
  }

  private pageTextOf(tp: number): string {
    const P = this.P;
    const n = P.FPDFText_CountChars(tp);
    if (n <= 0) return "";
    return this.wide((buf, len) => P.FPDFText_GetText(tp, 0, Math.min(n, len / 2 - 1), buf) * 2, (n + 1) * 2);
  }

  /** Every match of `query` on a page, each as its rectangles. Case-insensitive. */
  find(index: number, query: string): Rect[][] {
    if (!query) return [];
    return this.withText(index, tp => this.findIn(index, tp, query));
  }

  private findIn(index: number, tp: number, query: string): Rect[][] {
    const P = this.P, M = P.pdfium;
    const needle = this.wstr(query);
    const handle = P.FPDFText_FindStart(tp, needle, 0, 0);
    const matches: Rect[][] = [];
    const box = this.scratch(32);
    try {
      while (handle && P.FPDFText_FindNext(handle) && matches.length < 1000) {
        const start = P.FPDFText_GetSchResultIndex(handle), length = P.FPDFText_GetSchCount(handle);
        const rects: Rect[] = [];
        const n = P.FPDFText_CountRects(tp, start, length);
        for (let i = 0; i < n; i++) {
          if (!P.FPDFText_GetRect(tp, i, box, box + 8, box + 16, box + 24)) continue;
          const [l, t, r, b] = this.doubles(box);
          rects.push(this.toView(index, l, t, r, b));
        }
        matches.push(rects);
      }
    } finally {
      if (handle) P.FPDFText_FindClose(handle);
      M.wasmExports.free(needle);
      this.free(box);
    }
    return matches;
  }

  outline(): OutlineItem[] {
    const P = this.P;
    let budget = 10_000;
    const walk = (parent: number, depth: number): OutlineItem[] => {
      const items: OutlineItem[] = [];
      const seen = new Set<number>();
      for (let mark = P.FPDFBookmark_GetFirstChild(this.doc, parent); mark && budget-- > 0 && !seen.has(mark); mark = P.FPDFBookmark_GetNextSibling(this.doc, mark)) {
        seen.add(mark);
        const title = this.wide((buf, len) => P.FPDFBookmark_GetTitle(mark, buf, len)).trim() || "Untitled";
        let dest = P.FPDFBookmark_GetDest(this.doc, mark);
        if (!dest) {
          const action = P.FPDFBookmark_GetAction(mark);
          if (action && P.FPDFAction_GetType(action) === 1) dest = P.FPDFAction_GetDest(this.doc, action);
        }
        const page = dest ? P.FPDFDest_GetDestPageIndex(this.doc, dest) : -1;
        items.push({ title, page: page >= 0 && page < this.pageCount ? page : null, children: depth < 16 ? walk(mark, depth + 1) : [] });
      }
      return items;
    };
    return walk(0, 0);
  }

  links(index: number): PageLink[] {
    const P = this.P, M = P.pdfium, page = this.page(index);
    const links: PageLink[] = [];
    const pos = this.scratch(4), link = this.scratch(4), rect = this.scratch(16);
    try {
      M.setValue(pos, 0, "i32");
      while (links.length < 5000 && P.FPDFLink_Enumerate(page, pos, link)) {
        const handle = M.getValue(link, "i32");
        if (!P.FPDFLink_GetAnnotRect(handle, rect)) continue;
        const [l, t, r, b] = [0, 1, 2, 3].map(i => M.getValue(rect + 4 * i, "float")) as [number, number, number, number];
        // FS_RECTF is left, top, right, bottom; some writers swap top and bottom.
        links.push({ rect: this.toView(index, l, Math.max(t, b), r, Math.min(t, b)), target: this.linkTarget(handle) });
      }
    } finally { this.free(pos); this.free(link); this.free(rect); }
    return links;
  }

  close(): void {
    if (!this.doc) return;
    const P = this.P;
    for (const tp of this.texts.values()) P.FPDFText_ClosePage(tp);
    for (const page of this.pages.values()) P.FPDF_ClosePage(page);
    this.texts.clear();
    this.pages.clear();
    P.FPDF_CloseDocument(this.doc);
    P.pdfium.wasmExports.free(this.memory);
    this.doc = 0;
    openDocuments -= 1;
  }

  /** Release a page's handles (the view calls this for pages scrolled far away). */
  releasePage(index: number): void {
    const tp = this.texts.get(index);
    if (tp) { this.P.FPDFText_ClosePage(tp); this.texts.delete(index); }
    const page = this.pages.get(index);
    if (page) { this.P.FPDF_ClosePage(page); this.pages.delete(index); }
  }

  private linkTarget(link: number): LinkTarget {
    const P = this.P;
    const action = P.FPDFLink_GetAction(link);
    // Decide by the action's type first: remote and embedded GoTo actions also carry a /D that
    // FPDFLink_GetDest would resolve against this document.
    if (!action) {
      const dest = P.FPDFLink_GetDest(this.doc, link);
      const page = dest ? P.FPDFDest_GetDestPageIndex(this.doc, dest) : -1;
      return page >= 0 && page < this.pageCount ? { kind: "page", page } : { kind: "blocked", reason: "a link with no action" };
    }
    const type = P.FPDFAction_GetType(action);
    if (type === 1) {
      const target = P.FPDFAction_GetDest(this.doc, action);
      const page = target ? P.FPDFDest_GetDestPageIndex(this.doc, target) : -1;
      return page >= 0 && page < this.pageCount ? { kind: "page", page } : { kind: "blocked", reason: "a link to a missing page" };
    }
    if (type === 3) {
      const uri = this.ascii((buf, len) => P.FPDFAction_GetURIPath(this.doc, action, buf, len)).trim();
      return URI_SCHEMES.test(uri) ? { kind: "uri", uri } : { kind: "blocked", reason: "a link with an unsupported address" };
    }
    return { kind: "blocked", reason: ACTION_NAMES[type] ?? "an unsupported action" };
  }

  /** Page space (points, bottom-left origin) to view space (top-left origin, rotation applied). */
  private toView(index: number, left: number, top: number, right: number, bottom: number): Rect {
    const P = this.P, M = P.pdfium, page = this.page(index);
    const { width, height } = this.pageSize(index);
    // Device units at 64 px per point keep rounding error under 1/64 pt.
    const k = 64, out = this.scratch(16);
    try {
      P.FPDF_PageToDevice(page, 0, 0, Math.round(width * k), Math.round(height * k), 0, left, top, out, out + 4);
      P.FPDF_PageToDevice(page, 0, 0, Math.round(width * k), Math.round(height * k), 0, right, bottom, out + 8, out + 12);
      const [x1, y1, x2, y2] = [0, 1, 2, 3].map(i => M.getValue(out + 4 * i, "i32") / k) as [number, number, number, number];
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    } finally { this.free(out); }
  }

  private check(index: number): void {
    if (!this.doc) throw new Error("This PDF is closed.");
    if (!Number.isInteger(index) || index < 0 || index >= this.pageCount) throw new RangeError(`No page ${index + 1}.`);
  }

  private page(index: number): number {
    this.check(index);
    let page = this.pages.get(index);
    if (!page) {
      page = this.P.FPDF_LoadPage(this.doc, index);
      if (!page) throw new Error(`Page ${index + 1} could not be read.`);
      this.pages.set(index, page);
    }
    return page;
  }

  private text(index: number): number {
    let tp = this.texts.get(index);
    if (!tp) {
      tp = this.P.FPDFText_LoadPage(this.page(index));
      if (!tp) throw new Error(`The text of page ${index + 1} could not be read.`);
      this.texts.set(index, tp);
    }
    return tp;
  }

  private scratch(bytes: number): number {
    const p = this.P.pdfium.wasmExports.malloc(bytes);
    if (!p) throw new Error("The PDF engine is out of memory.");
    return p;
  }
  private free(p: number): void { this.P.pdfium.wasmExports.free(p); }
  /** Four doubles: left, top, right, bottom. */
  private doubles(p: number): [number, number, number, number] {
    const at = (i: number): number => this.P.pdfium.getValue(p + 8 * i, "double");
    return [at(0), at(1), at(2), at(3)];
  }
  private wstr(s: string): number {
    const n = (s.length + 1) * 2, p = this.scratch(n);
    this.P.pdfium.stringToUTF16(s, p, n);
    return p;
  }
  /** Call a PDFium getter that fills a UTF-16LE buffer; `fill(buf, byteLength)` returns bytes needed. */
  private wide(fill: (buf: number, bytes: number) => number, size?: number): string {
    const bytes = size ?? fill(0, 0);
    if (bytes <= 0) return "";
    const p = this.scratch(bytes + 2);
    try {
      heap(this.P).fill(0, p, p + bytes + 2);
      fill(p, bytes);
      return this.P.pdfium.UTF16ToString(p);
    } finally { this.free(p); }
  }
  private ascii(fill: (buf: number, bytes: number) => number): string {
    const bytes = fill(0, 0);
    if (bytes <= 1) return "";
    const p = this.scratch(bytes + 1);
    try {
      heap(this.P).fill(0, p, p + bytes + 1);
      fill(p, bytes);
      return this.P.pdfium.UTF8ToString(p);
    } finally { this.free(p); }
  }
}
