# Current library integration notes

Read [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md) and the owning source at the checked-out commit before changing an integration. `package.json` and `package-lock.json` own current versions. This page does not assert that every dependency was installed or independently revalidated locally.

The full former recipes are retained byte-for-byte in [LIBRARY_NOTES_20260808.md](LIBRARY_NOTES_20260808.md). Their August version inventory and illustrative code are historical, not current copy-paste instructions. In particular, do not copy the old Mermaid example without the current SVG sanitizer, or the old flush-only export orchestration. The similarly retained [IMPLEMENTATION_FOUNDATION.md](IMPLEMENTATION_FOUNDATION.md) is explicitly historical for dependency versions under canonical specification section 2. Its 1.6.7 entry is not the current renderer assertion and should not be rewritten as a new verification receipt.

## Raster renderer: html2canvas-pro 2.4.5

`src/export/download.ts` retains the default import, one canvas per already-paginated sheet, configured capture scale, white background, disabled library logging, progress callback and jsPDF page/image/save flow. No additional pagination or document upload is introduced.

The private `prepareRasterClone(Document, HTMLElement): void` callback runs before the renderer measures the copied target. It removes only copied preview-stack transforms and host sizing/clipping. It never changes transforms inside a sheet or modifies the live preview.

The cloner materializes CSS pseudos into `html2canvaspseudoelement` nodes and marks parents with `___html2canvas___pseudoelement_before` / `___html2canvas___pseudoelement_after`. Version 1.6.7 surrounds ordinary children with these nodes; 2.4.x creates both before ordinary children (ordering unchanged by the 2.4.4→2.4.5 patch — the pseudo-order unit tests pin it). Match their relative order among a complete set of direct generated children, not first/last ordinary-child position. Recompute originating pseudo visibility in the revealed clone; do not blanket-unhide author content. This private convention is vendor-coupled and requires revalidation on future upgrades.

### Evidence and required checks

The dependency-only head `01601fef501ce039fbb7012f12fc2cde619743e1` failed run `36192138939`: its hidden-preview capture omitted a TOC page number, while 82 other browser tests passed. The compatibility correction at `8a14f62a5ec50c2fed0fd16c898c7638b5676971` passed all required jobs in `36192660640`, including the unchanged same-run raster image equality assertion. The 2.4.4→2.4.5 patch bump revalidated the same suite through PR #97's exact-head CI (all three jobs green, including raster-resolution and the pseudo-order/visibility unit tests). This is source/hosted-CI evidence, not a local install or live deployment claim. Later heads still need their own CI and review.

Keep `tests/raster-clone.test.ts`, `tests/raster-pseudo-visibility.test.ts`, `tests/raster-pseudo-order.test.ts` and `tests/e2e/raster-resolution.spec.ts`. The latter checks actual dimensions, content, unchanged live preview and identical first-page captures across 100%, 50%, Fit and dark Markdown-only mode within the same browser run. It does not compare old-version golden images. See [RASTER_CAPTURE.md](RASTER_CAPTURE.md) and [RASTER_RENDERER_2.md](RASTER_RENDERER_2.md) for root-cause details.

## Mermaid 12 migration (supersedes #74)

`src/render/mermaid.ts` pins the preserved v11 rendering explicitly because Mermaid 12 changed its own defaults: ELK layout and the `neo` look replaced dagre/classic, flowchart `wrappingWidth` narrowed 200→120, and a new `minNodeWidth` floor of 120 appeared (both new on state diagrams too). The shipped config is root `layout: "dagre"`, `look: "classic"`, `theme: "default"`, plus `flowchart`/`state` sections restoring `wrappingWidth: 200` and `minNodeWidth: 0`. Sequence/class need no section: their v12 defaults only add theme/look, which the root pins already beat. A future visual migration must change these lines deliberately, never by upgrade.

`package.json` carries an `overrides` pin, `lodash-es: ^4.18.1`: mermaid 12 pulls chevrotain 11, whose lodash-es range admits only vulnerable releases (5 high advisories without the override; `npm audit` is 0 with it). Drop the override once mermaid or chevrotain ships a fixed lodash-es floor.

### Evidence and required checks

Identical input renders identical output under 11.17.2 and 12.0.0 with these pins: a real-Chromium matrix compared label text, label row counts, node widths, node fills, filters and SVG viewBoxes for representative flowchart, state, class and sequence diagrams — all equal, including single-line `Markdown source` and the 70px `x` node. `tests/e2e/golden-path.spec.ts` covers all four diagram types through the sanitizer in the production bundle, and both no-cutoff tests re-prove page breaking against the new engine. `tests/mermaid.test.ts` asserts the pinned init config so a later edit cannot silently drop a pin.

Browser floor: mermaid 12 requires ES2024 / Safari 17.4+ / Node 22.12+. The Node floor is inside `engines` (`^22.22.2`); the Safari floor is accepted as stated. AI-6 second-engine/manual-feel and AI-7 live/PWA checks remain open.

## Other integrations

Unchanged render sequencing, strict TypeScript requirements and no-slice behavior remain governed by the canonical specification. Follow current `src/render/{markdown,math,highlight,mermaid,sanitize}.ts` and `src/paginate/*` rather than a dated illustrative recipe. In particular, sanitization precedes DOM insertion, height-affecting preparation precedes pagination, and PDF export consumes a captured input under the render-host lease.
