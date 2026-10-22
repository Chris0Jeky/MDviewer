/** An explicit host save action; the ordinary web build leaves this unset. */
export type DownloadDestination = (blob: Blob, filename: string) => Promise<void>;

export class SaveCanceled extends Error {
  constructor() { super("Save canceled."); this.name = "SaveCanceled"; }
}

let destination: DownloadDestination | null = null;

export function setDownloadDestination(next: DownloadDestination | null): void {
  destination = next;
}

export function getDownloadDestination(): DownloadDestination | null {
  return destination;
}
