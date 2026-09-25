# Raster capture must not inherit preview zoom

PR #89's baseline production Chromium run 36188857712 reproduced a 794-pixel width shortfall at 50% preview zoom; the 79 pre-existing browser tests passed. The existing export tests observed a successful file download but did not verify image resolution.

html2canvas-pro v1.6.7 measures its cloned reference element after awaiting DocumentCloner.toIFrame, which invokes onclone. A transformed preview ancestor therefore changes the captured bounds even though the requested capture scale remains 2.

The private prepareRasterClone callback in src/export/download.ts removes only the copied stack's screen transform/transition and the copied host's preview sizing/clipping. It reveals the copied sheet for capture from Markdown-only mode. Live preview styles, scroll, view mode and all transforms inside the document sheet remain untouched. No extra pagination, new public API, dependency or persistence is introduced.

The production raster-resolution regression checks real canvas dimensions at 100%, 50% and Fit. Unit coverage checks clone-only changes and retains internal document transforms. Full hosted CI and independent review remain merge gates. The second-engine and live-PWA operator gates are unaffected; this is not a deployment receipt.
