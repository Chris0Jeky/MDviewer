# html2canvas-pro 2 migration evidence

The dependency-only #79 head 01601fef failed production run 36192138939 after #89's new raster checks were included: 82 other browser tests passed. At 1588x2246 the visible/Markdown-only image difference was confined to (1426,285)-(1437,304), the TOC page number. This was an intra-run comparison, not an old-version golden image.

Source inspection at upstream v2.4.4, src/dom/document-cloner.ts, shows that cloneNode now constructs both pseudo-elements before cloning ordinary children. In v1.6.7 the after pseudo followed ordinary children. Consequently a last-child test did not recognize the v2 after node, leaving its inherited hidden visibility inline.

The private export clone adapter now maps the ordered direct generated children using the parent before/after marker classes. It requires exactly the number of recognized pseudo children indicated by those flags; unknown structures are not changed. It re-reads the originating pseudo's computed visibility rather than blanket-revealing content. Both old and new orderings, including an explicitly hidden before pseudo, are unit-tested. No public export API or pagination-order change is introduced.

The full raster resolution, exact first-page image comparison, hidden-preview, no-slice, offline and export regressions must pass on the final upgraded head before merge. This note records the cause and correction, not a premature passing result or deployment approval. See RASTER_CAPTURE.md for the underlying clone-isolation contract. Its old first/last-child matching description is superseded by the ordered-direct-pseudo mapping described here for both supported layouts.
