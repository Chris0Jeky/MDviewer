/**
 * Paged.js uses a custom native ::marker for floated footnote numerals.
 * html2canvas-pro preserves its layout space but does not paint its content.
 * Add out-of-flow text in that existing space, only in the disposable clone.
 */
export function paintFootnoteMarkers(sheet: HTMLElement, sourceSheet: HTMLElement): void {
  const document = sheet.ownerDocument;
  const view = document.defaultView;
  if (!view) return;
  const references = sourceSheet.closest(".pagedjs_pages") ?? sourceSheet;
  const labels = new Map<string, string>();
  for (const link of references.querySelectorAll<HTMLAnchorElement>("sup.footnote-ref a, a.footnote-ref")) {
    const href = link.getAttribute("href") ?? "";
    const label = /^\[(\d+)(?::\d+)?\]$/.exec(link.textContent?.trim() ?? "");
    if (href.startsWith("#") && label && !labels.has(href.slice(1))) labels.set(href.slice(1), label[1]!);
  }

  for (const note of sheet.querySelectorAll<HTMLElement>(".pagedjs_footnote_inner_content .footnote[data-footnote-marker]:not([data-split-from])")) {
    const marker = view.getComputedStyle(note, "::marker");
    // Only normalize Paged.js's default decimal marker. Explicitly hidden or
    // custom authored marker content must not be replaced with an invented one.
    if (marker.content !== 'counter(footnote-marker) ". "') continue;
    const style = view.getComputedStyle(note);
    if (style.display === "none" || marker.visibility === "hidden") continue;
    const label = labels.get(note.id);
    if (!label) throw new Error("The PDF capture could not resolve a footnote marker. Try Print / Save as PDF.");
    const box = note.getBoundingClientRect();
    const first = note.firstChild;
    const last = note.lastChild;
    const range = document.createRange();
    const geometry = () => {
      const rects = [note.getBoundingClientRect()];
      if (first && last) {
        range.setStartBefore(first);
        range.setEndAfter(last);
        rects.push(...range.getClientRects());
      }
      return rects.flatMap(rect => [rect.x, rect.y, rect.width, rect.height]);
    };
    const before = geometry();
    const unchanged = () => {
      const after = geometry();
      return before.length === after.length && before.every((value, index) => value === after[index]);
    };
    const paint = document.createElement("span");
    paint.dataset.rasterFootnoteMarker = "";
    paint.setAttribute("aria-hidden", "true");
    paint.textContent = `${label}. `;
    paint.style.cssText = "position:absolute;display:block;width:max-content;margin:0;padding:0;border:0;white-space:pre;text-indent:0;";
    for (const property of ["font-family", "font-size", "font-style", "font-weight", "font-stretch", "font-variant",
      "font-variant-numeric", "font-feature-settings", "font-variation-settings", "font-kerning",
      "line-height", "letter-spacing", "word-spacing", "color", "text-transform", "direction", "unicode-bidi"]) {
      paint.style.setProperty(property, marker.getPropertyValue(property));
    }
    // A tall inline image or fraction raises the first line's ascent. Its native
    // marker follows that baseline, not the note's top edge. Measure the actual
    // baseline with a zero-size inline box, then remove it before capture.
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;margin:0;padding:0;border:0;line-height:0;vertical-align:baseline;";
    note.prepend(probe);
    const baseline = probe.getBoundingClientRect().top;
    const stableBaseline = unchanged();
    probe.remove();
    if (!stableBaseline) throw new Error("The PDF capture could not align a footnote marker without changing its layout. Try Print / Save as PDF.");
    // Keeping the paint inside the note retains inherited visibility and parent
    // opacity. Absolute positioning changes neither the line nor float geometry.
    paint.append(probe);
    note.append(paint);
    const baselineOffset = probe.getBoundingClientRect().top - paint.getBoundingClientRect().top;
    probe.remove();
    const anchor = paint.offsetParent as HTMLElement | null;
    if (!anchor) throw new Error("The PDF capture could not position a footnote marker. Try Print / Save as PDF.");
    const origin = anchor.getBoundingClientRect();
    const left = style.direction === "rtl"
      ? box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) - paint.getBoundingClientRect().width
      : box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    paint.style.left = `${left - origin.left - anchor.clientLeft + anchor.scrollLeft}px`;
    paint.style.top = `${baseline - baselineOffset - origin.top - anchor.clientTop + anchor.scrollTop}px`;
    if (!unchanged()) throw new Error("The PDF capture changed a footnote's layout. Try Print / Save as PDF.");
  }
}
