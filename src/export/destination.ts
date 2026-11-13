/** An explicit host save action; the ordinary web build leaves this unset. */
export type DownloadDestination = (blob: Blob, filename: string) => Promise<void>;

export class SaveCanceled extends Error {
  constructor() { super("Save canceled."); this.name = "SaveCanceled"; }
}

/** The user canceled a PDF export before its save was handed off (never a failure). */
export class ExportCanceled extends Error {
  constructor() { super("PDF export canceled."); this.name = "ExportCanceled"; }
}

let destination: DownloadDestination | null = null;

export function setDownloadDestination(next: DownloadDestination | null): void {
  destination = next;
}

export function getDownloadDestination(): DownloadDestination | null {
  return destination;
}
