/**
 * The edit journal (PDF_WORKBENCH.md, "Document, journal and save model"). Every change is a
 * plain-data entry applied to the live document. Undo reopens the original bytes and replays
 * the entries before the cursor in order (page edits shift indices, so there is no partial
 * replay). The journal lives in memory only.
 */
import { openPdf, type PdfDocument } from "./engine";

export type PdfEdit =
  | { op: "move"; pages: number[]; to: number }
  | { op: "rotate"; pages: number[]; quarterTurns: number }
  | { op: "delete"; pages: number[] }
  | { op: "duplicate"; pages: number[] }
  | { op: "insertBlank"; at: number; width: number; height: number }
  | { op: "insertPdf"; at: number; bytes: Uint8Array; name: string }
  | { op: "insertImage"; at: number; bytes: Uint8Array; kind: "png" | "jpeg"; width: number; height: number; name: string };

export const MAX_JOURNAL = 500;
/** Bytes held by insert entries (other PDFs, images) across the journal. */
export const MAX_JOURNAL_BYTES = 400_000_000;

/** Edits that remove content: a save that contains one defaults to a full rewrite. */
const REMOVING: ReadonlySet<PdfEdit["op"]> = new Set(["delete"]);

export function apply(doc: PdfDocument, edit: PdfEdit): void {
  switch (edit.op) {
    case "move": doc.movePages(edit.pages, edit.to); return;
    case "rotate": for (const page of edit.pages) doc.rotatePage(page, edit.quarterTurns); return;
    case "delete": doc.deletePages(edit.pages); return;
    case "duplicate": doc.duplicatePages(edit.pages); return;
    case "insertBlank": doc.insertBlank(edit.at, edit.width, edit.height); return;
    case "insertPdf": doc.insertPdf(edit.bytes, edit.at); return;
    case "insertImage": doc.insertImage(edit.at, edit.bytes, edit.kind, edit.width, edit.height); return;
  }
}

/** A short past-tense description for status lines and the Undo button's name. */
export function describe(edit: PdfEdit): string {
  const n = "pages" in edit ? edit.pages.length : 1;
  const pages = n === 1 ? "a page" : `${n} pages`;
  switch (edit.op) {
    case "move": return `Moved ${pages}`;
    case "rotate": return `Rotated ${pages}`;
    case "delete": return `Deleted ${pages}`;
    case "duplicate": return `Duplicated ${pages}`;
    case "insertBlank": return "Inserted a blank page";
    case "insertPdf": return `Inserted ${edit.name}`;
    case "insertImage": return `Inserted ${edit.name}`;
  }
}

export class Journal {
  private entries: PdfEdit[] = [];
  private cursor = 0;

  constructor(readonly original: Uint8Array, private readonly password = "") {}

  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.entries.length; }
  /** The edits currently applied, oldest first. */
  get applied(): readonly PdfEdit[] { return this.entries.slice(0, this.cursor); }
  get dirty(): boolean { return this.cursor > 0; }
  /** True when the applied edits remove content, so only a full rewrite drops it from the file. */
  get removes(): boolean { return this.applied.some(edit => REMOVING.has(edit.op)); }

  /** Apply `edit` to `doc` and record it; the redo tail is dropped. Throws, recording nothing, on failure. */
  record(doc: PdfDocument, edit: PdfEdit): void {
    const held = this.entries.slice(0, this.cursor).reduce((sum, e) => sum + ("bytes" in e ? e.bytes.length : 0), 0);
    if ("bytes" in edit && held + edit.bytes.length > MAX_JOURNAL_BYTES) throw new Error("The inserted files would exceed 400 MB. Save a copy first.");
    if (this.cursor >= MAX_JOURNAL) throw new Error(`At most ${MAX_JOURNAL} changes can be undone. Save a copy to continue.`);
    apply(doc, edit);
    this.entries.length = this.cursor;
    this.entries.push(edit);
    this.cursor += 1;
  }

  /** Reopen the original and replay up to the new cursor; the caller closes the old document. */
  async undo(): Promise<PdfDocument> {
    if (!this.canUndo) throw new Error("Nothing to undo.");
    return this.rebuild(this.cursor - 1);
  }

  async redo(): Promise<PdfDocument> {
    if (!this.canRedo) throw new Error("Nothing to redo.");
    return this.rebuild(this.cursor + 1);
  }

  private async rebuild(cursor: number): Promise<PdfDocument> {
    const doc = await openPdf(this.original, this.password);
    try {
      for (const edit of this.entries.slice(0, cursor)) apply(doc, edit);
    } catch (error) {
      doc.close();
      throw error;
    }
    this.cursor = cursor;
    return doc;
  }
}
