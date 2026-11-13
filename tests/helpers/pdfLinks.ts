/**
 * Read the internal-link structure of a Chromium/Skia print PDF (uncompressed objects, as
 * `page.pdf()` and the real Print path emit): which named destination each Link annotation
 * jumps to, on which sheet that destination sits, and where each link lives.
 *
 * Skia names a destination with the URL fragment as the browser sees it — the heading id
 * percent-encoded as UTF-8 — and writes that name as a PDF name (`#XX` escapes). The names
 * returned here are decoded back to the heading id. This is not a general PDF reader.
 */
export interface PdfLinks {
  /** Destination id (decoded) -> zero-based sheet index it points at. */
  destinations: Map<string, number>;
  /** Every link annotation, with the sheet it sits on and its decoded destination id. */
  links: Array<{ sheet: number; id: string }>;
}

/** `/caf#25C3#25A9` -> `café`: undo PDF name escapes, then the fragment's percent-encoding. */
function decodeName(name: string): string {
  const percentEncoded = name.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return decodeURIComponent(percentEncoded);
}

export function readPdfLinks(pdf: Buffer): PdfLinks {
  const source = pdf.toString("latin1");
  const objects = new Map<number, string>();
  for (const match of source.matchAll(/\n(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) objects.set(Number(match[1]), match[2]!);

  const catalog = [...objects.values()].find((body) => /\/Type \/Catalog/.test(body));
  const pagesRef = /\/Pages (\d+) 0 R/.exec(catalog ?? "");
  const kids = /\/Kids \[([^\]]*)\]/.exec(objects.get(Number(pagesRef?.[1])) ?? "");
  if (!kids) throw new Error("PDF has no page tree");
  const pageRefs = [...kids[1]!.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));

  const destinations = new Map<string, number>();
  const destsRef = /\/Dests (\d+) 0 R/.exec(catalog ?? "");
  for (const entry of (objects.get(Number(destsRef?.[1])) ?? "").matchAll(/\/(\S+) \[(\d+) 0 R \/XYZ/g)) {
    destinations.set(decodeName(entry[1]!), pageRefs.indexOf(Number(entry[2])));
  }

  const links: PdfLinks["links"] = [];
  pageRefs.forEach((ref, sheet) => {
    const annots = /\/Annots \[([^\]]*)\]/.exec(objects.get(ref) ?? "")?.[1] ?? "";
    for (const annot of annots.matchAll(/(\d+) 0 R/g)) {
      const dest = /\/Subtype \/Link[\s\S]*?\/Dest \/(\S+?)>>/.exec(objects.get(Number(annot[1])) ?? "");
      if (dest) links.push({ sheet, id: decodeName(dest[1]!) });
    }
  });
  return { destinations, links };
}
