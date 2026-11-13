/**
 * Open PDF tabs (PDF_WORKBENCH.md, P1). PDFs are kept apart from the text documents in
 * ReaderSession: they have no text, no Edit, no Markdown save and no session restore yet. The
 * shell shows a PDF when one is active and no reader document is (see main.ts `pdfShown`).
 * This module stays tiny and eager; the engine and view load lazily through `import("../pdf")`.
 */
export const MAX_PDF_BYTES = 200_000_000;
export const MAX_HELD_PDF_BYTES = 400_000_000;
export const MAX_PDF_TABS = 16;

/** `token` is the host's PDF capability for a natively opened file (released on close). */
export interface PdfTab { id: string; name: string; bytes: Uint8Array; token?: string }

export function isPdfFile(name: string, mime = ""): boolean {
  return /\.pdf$/i.test(name) || mime === "application/pdf";
}

/** A PDF starts with `%PDF-` within its first 1,024 bytes (ISO 32000-2, 7.5.2, with leading junk tolerated). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

export class PdfTabs {
  readonly tabs: PdfTab[] = [];
  activeId: string | null = null;
  private sequence = 0;

  get active(): PdfTab | undefined { return this.tabs.find(tab => tab.id === this.activeId); }

  /** Add an opened PDF and make it the active PDF; returns an error message instead when a cap is hit. */
  add(name: string, bytes: Uint8Array, token?: string): string | null {
    if (this.tabs.length >= MAX_PDF_TABS) return `Close a PDF first — at most ${MAX_PDF_TABS} PDFs can be open.`;
    if (bytes.length > MAX_PDF_BYTES) return `PDFs larger than 200 MB cannot be opened.`;
    const held = this.tabs.reduce((total, tab) => total + tab.bytes.length, 0);
    if (held + bytes.length > MAX_HELD_PDF_BYTES) return `The open PDFs would exceed 400 MB. Close a PDF first.`;
    if (!hasPdfSignature(bytes)) return "This file is not a PDF.";
    const id = `pdf-${++this.sequence}`;
    this.tabs.push({ id, name, bytes, ...(token ? { token } : {}) });
    this.activeId = id;
    return null;
  }

  /** Remove a tab; the active PDF moves to its neighbour. */
  close(id: string): void {
    const index = this.tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    if (this.activeId === id) this.activeId = this.tabs[Math.max(0, index - 1)]?.id ?? null;
  }
}
