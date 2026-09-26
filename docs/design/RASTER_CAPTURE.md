# Raster capture must not inherit preview state

PR #89's baseline production Chromium run 36188857712 reproduced a 794-pixel width shortfall at 50% preview zoom; the 79 pre-existing browser tests passed. Existing export tests observed a successful file download but did not verify image resolution.

html2canvas-pro measures its cloned reference element after awaiting DocumentCloner.toIFrame, which invokes onclone. A transformed preview ancestor therefore changes the captured bounds even though the requested capture scale remains 2. This callback sequence was inspected in v1.6.7 and is covered again by the 2.4.x migration tests (revalidated for 2.4.5 by PR #97).

The private prepareRasterClone callback in src/export/download.ts removes only the copied stack's screen transform/transition and the copied host's preview sizing/clipping. It reveals the copied sheet for capture from Markdown-only mode. Live preview styles, scroll, view mode and all transforms inside the document sheet remain untouched. No extra pagination, public API or persistence is introduced.

## Generated content in a parked preview

Run 36190089245 tightened the image check and exposed a separate repeatable omission in Markdown-only mode: the TOC's leader and page number disappeared. All 82 other production-browser tests passed. The prior artifact's image difference is confined to the TOC row, not general font antialiasing.

The library materializes ::before/::after into html2canvaspseudoelement nodes before onclone and copies computed visibility inline. A parked preview therefore freezes hidden visibility on those nodes. Revealing their ancestor cannot undo it. The callback re-reads recognized generated pseudos' visibility from their originating parent/pseudo in the revealed clone. Explicitly hidden author pseudos and ordinary hidden content remain hidden. Unrelated pages and the live DOM are unchanged.

The current adapter handles both 1.6.7 and 2.4.x clone orderings: it requires a complete set of direct generated children matching the parent's before/after marker classes, then maps their relative order. Do not rely on an after node being the final child, because 2.4.x inserts ordinary children after both generated pseudos. Unknown structures remain untouched. This vendor coupling is deliberate and must be revalidated on renderer upgrades. See [RASTER_RENDERER_2.md](RASTER_RENDERER_2.md) for the reproduced migration failure and [LIBRARY_NOTES.md](LIBRARY_NOTES.md) for current evidence.

The production regression compares the captured first-page PNG within one browser run at 100%, 50%, Fit and dark Markdown-only mode. It also checks every page's dimensions/content and the unchanged live preview transform. Unit tests pin clone isolation and both generated-content orderings, including explicitly hidden and unrelated content. Hosted final-head CI and independent review remain merge gates. Second-engine and live-PWA operator gates are unaffected; this document is not a deployment receipt.
