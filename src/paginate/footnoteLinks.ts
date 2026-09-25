/** Paged.js replaces a floated note's ID with note-<ref>, retaining it in data-id. */
export function repairFootnoteLinks(host: ParentNode): void {
  const destinations = new Map<string, string>();
  for (const note of host.querySelectorAll<HTMLElement>("[data-footnote-marker][data-id][id]")) {
    const original = note.dataset.id;
    if (original && !destinations.has(original)) destinations.set(original, note.id);
  }
  for (const link of host.querySelectorAll<HTMLAnchorElement>("sup.footnote-ref a[href^='#'], a.footnote-ref[href^='#']")) {
    const original = link.getAttribute("href")!.slice(1);
    const destination = destinations.get(original);
    if (destination) link.setAttribute("href", `#${destination}`);
  }
}
