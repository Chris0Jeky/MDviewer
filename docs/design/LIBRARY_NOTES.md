# Current library integration notes

Read [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md) and the owning source at the checked-out commit before changing an integration. `package.json` and `package-lock.json` own current versions. This page does not assert that every dependency was installed or independently revalidated locally.

The full former recipes are retained byte-for-byte in [LIBRARY_NOTES_20260808.md](LIBRARY_NOTES_20260808.md). Their August version inventory and illustrative code are historical, not current copy-paste instructions. In particular, do not copy the old Mermaid example without the current SVG sanitizer, or the old flush-only export orchestration. The similarly retained [IMPLEMENTATION_FOUNDATION.md](IMPLEMENTATION_FOUNDATION.md) is explicitly historical for dependency versions under canonical specification section 2. Its 1.6.7 entry is not the current renderer assertion and should not be rewritten as a new verification receipt.

## Raster renderer: html2canvas-pro 2.4.4

`src/export/download.ts` retains the default import, one canvas per already-paginated sheet, configured capture scale, white background, disabled library logging, progress callback and jsPDF page/image/save flow. No additional pagination or document upload is introduced.

The private `prepareRasterClone(Document, HTMLElement): void` callback runs before the renderer measures the copied target. It removes only copied preview-stack transforms and host sizing/clipping. It never changes transforms inside a sheet or modifies the live preview.

The cloner materializes CSS pseudos into `html2canvaspseudoelement` nodes and marks parents with `___html2canvas___pseudoelement_before` / `___html2canvas___pseudoelement_after`. Version 1.6.7 surrounds ordinary children with these nodes; 2.4.4 creates both before ordinary children. Match their relative order among a complete set of direct generated children, not first/last ordinary-child position. Recompute originating pseudo visibility in the revealed clone; do not blanket-unhide author content. This private convention is vendor-coupled and requires revalidation on future upgrades.

### Evidence and required checks

The dependency-only head `01601fef501ce039fbb7012f12fc2cde619743e1` failed run `36192138939`: its hidden-preview capture omitted a TOC page number, while 82 other browser tests passed. The compatibility correction at `8a14f62a5ec50c2fed0fd16c898c7638b5676971` passed all required jobs in `36192660640`, including the unchanged same-run raster image equality assertion. This is source/hosted-CI evidence, not a local install or live deployment claim. Later heads still need their own CI and review.

Keep `tests/raster-clone.test.ts`, `tests/raster-pseudo-visibility.test.ts`, `tests/raster-pseudo-order.test.ts` and `tests/e2e/raster-resolution.spec.ts`. The latter checks actual dimensions, content, unchanged live preview and identical first-page captures across 100%, 50%, Fit and dark Markdown-only mode within the same browser run. It does not compare old-version golden images. See [RASTER_CAPTURE.md](RASTER_CAPTURE.md) and [RASTER_RENDERER_2.md](RASTER_RENDERER_2.md) for root-cause details.

## Other integrations

Unchanged render sequencing, strict TypeScript requirements and no-slice behavior remain governed by the canonical specification. Follow current `src/render/{markdown,math,highlight,mermaid,sanitize}.ts` and `src/paginate/*` rather than a dated illustrative recipe. In particular, sanitization precedes DOM insertion, height-affecting preparation precedes pagination, and PDF export consumes a captured input under the render-host lease.

Mermaid 12 is a separate unmerged migration in #74; this renderer upgrade does not imply acceptance of changed diagram layout/look or browser support. AI-6 second-engine/manual-feel and AI-7 live/PWA checks remain open.
