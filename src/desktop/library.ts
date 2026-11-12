/**
 * The seam between the library panel (shell, Experience lane) and the desktop
 * entry. The panel lists entries with `native.library.*` and opens one by id
 * through `openLibraryEntry`, which the entry wires to the same batch, admission
 * and notice path as the Open picker.
 */
let opener: ((id: string) => Promise<void>) | null = null;

export function setLibraryOpener(next: ((id: string) => Promise<void>) | null): void {
  opener = next;
}

/** Open a recent, pinned or scanned library entry. A no-op without the native host. */
export function openLibraryEntry(id: string): Promise<void> {
  return opener ? opener(id) : Promise.resolve();
}
