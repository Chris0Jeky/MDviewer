# Current library integration notes

Read [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md) and the owning source at the checked-out commit before changing an integration. `package.json` and `package-lock.json` own current versions. This page does not assert that every dependency was installed or independently revalidated locally.

The full former recipes are retained byte-for-byte in [LIBRARY_NOTES_20260808.md](LIBRARY_NOTES_20260808.md). Their August version inventory and illustrative code are historical, not current copy-paste instructions. In particular, do not copy the old Mermaid example without the current SVG sanitizer, or the old flush-only export orchestration. The similarly retained [IMPLEMENTATION_FOUNDATION.md](IMPLEMENTATION_FOUNDATION.md) is explicitly historical for dependency versions under canonical specification section 2. Its 1.6.7 entry is not the current renderer assertion and should not be rewritten as a new verification receipt.

## Raster renderer: html2canvas-pro 2.6.0

`src/export/download.ts` retains the default import, one canvas per already-paginated sheet, configured capture scale, white background, disabled library logging, progress callback and jsPDF page/image/save flow. No additional pagination or document upload is introduced.

The private `prepareRasterClone(Document, HTMLElement, HTMLElement): void` callback runs before the renderer measures the copied target. Its third argument is the source sheet used to preserve authored SVG visibility. Normalization removes copied preview-stack transforms and host sizing/clipping, restores recognized generated content, and preserves the live preview and transforms inside each sheet. Clone-only task-checkbox and footnote-marker paint are covered by the actual saved-PDF visual tests.

The 2.6 adapter observes actual stylesheet load/error events from the owned capture document before `onclone`, then requires successful CSS and fonts before rendering. A non-null stylesheet or fulfilled `fonts.ready` alone is not proof of success. Errors save no PDF and release the owned capture container; the existing retry remains available. See [PDF_VISUAL_REGRESSION.md](../PDF_VISUAL_REGRESSION.md) for the readiness contract and failure controls.

For an offline source with an accessible service-worker controller, `offlineCapture.ts` prepares a controlled `srcdoc` destination before cloning. The adapter adopts the cloned nodes and restores the app's same-origin head stylesheet links in cascade order. Online and packaged-desktop capture keep their existing route. Controller inheritance, CSS ordering and renderer node ownership are compatibility assumptions that must be checked on upgrades. [RASTER_OFFLINE_CAPTURE.md](RASTER_OFFLINE_CAPTURE.md) records the scoped contract, passing integration at `a9664f9b`, and final-main `203c0979` qualification.

The cloner materializes CSS pseudos into `html2canvaspseudoelement` nodes and marks parents with `___html2canvas___pseudoelement_before` / `___html2canvas___pseudoelement_after`. Version 1.6.7 surrounds ordinary children with these nodes; 2.4.x creates both before ordinary children (ordering unchanged by the 2.4.4→2.4.5 patch — the pseudo-order unit tests pin it). Match their relative order among a complete set of direct generated children, not first/last ordinary-child position. Recompute originating pseudo visibility in the revealed clone; do not blanket-unhide author content. This private convention is vendor-coupled and requires revalidation on future upgrades.

### Historical migration evidence and required checks

The dependency-only head `01601fef501ce039fbb7012f12fc2cde619743e1` failed run `36192138939`: its hidden-preview capture omitted a TOC page number, while 82 other browser tests passed. The compatibility correction at `8a14f62a5ec50c2fed0fd16c898c7638b5676971` passed all required jobs in `36192660640`, including the unchanged same-run raster image equality assertion. The 2.4.4→2.4.5 patch bump revalidated the same suite through PR #97's exact-head CI (all three jobs green, including raster-resolution and the pseudo-order/visibility unit tests). This is source/hosted-CI evidence, not a local install or live deployment claim. Later heads still need their own CI and review.

Keep `tests/raster-clone.test.ts`, `tests/raster-pseudo-visibility.test.ts`, `tests/raster-pseudo-order.test.ts` and `tests/e2e/raster-resolution.spec.ts`. The latter checks actual dimensions, content, unchanged live preview and identical first-page captures across 100%, 50%, Fit and dark Markdown-only mode within the same browser run. It does not compare old-version golden images. See [RASTER_CAPTURE.md](RASTER_CAPTURE.md) and [RASTER_RENDERER_2.md](RASTER_RENDERER_2.md) for root-cause details.

Current qualification also requires the online/offline saved-PDF pixels and damaged controls, delayed/failed CSS, real cached-CSS/font loss with no-save cleanup and restored-cache retry, and footnote numeral checks. These are the `raster-visual`, `raster-styles-ready`, `raster-fonts-ready`, `raster-offline-frame` and `raster-footnotes` browser suites, with the corresponding unit contracts. Whole-export cancellation and bounds remain tracked in [#201](https://github.com/Chris0Jeky/MDviewer/issues/201); individual readiness deadlines do not bound all upstream work.

## Mermaid 12 migration (supersedes #74)

`src/render/mermaid.ts` pins the preserved v11 rendering explicitly because Mermaid 12 changed its own defaults: ELK layout and the `neo` look replaced dagre/classic, flowchart `wrappingWidth` narrowed 200→120, and a new `minNodeWidth` floor of 120 appeared (both new on state diagrams too). The shipped config is root `layout: "dagre"`, `look: "classic"`, `theme: "default"`, plus `flowchart`/`state` sections restoring `wrappingWidth: 200` and `minNodeWidth: 0`. Sequence/class need no section: their v12 defaults only add theme/look, which the root pins already beat. A future visual migration must change these lines deliberately, never by upgrade.

`package.json` carries an `overrides` pin, `lodash-es: ^4.18.1`: mermaid 12 pulls chevrotain 11, whose lodash-es range admits only vulnerable releases (5 high advisories without the override; `npm audit` is 0 with it). Drop the override once mermaid or chevrotain ships a fixed lodash-es floor.

### Evidence and required checks

Identical input renders identical output under 11.17.2 and 12.0.0 with these pins: a real-Chromium matrix compared label text, label row counts, node widths, node fills, filters and SVG viewBoxes for representative flowchart, state, class and sequence diagrams — all equal, including single-line `Markdown source` and the 70px `x` node. `tests/e2e/golden-path.spec.ts` covers all four diagram types through the sanitizer in the production bundle, and both no-cutoff tests re-prove page breaking against the new engine. `tests/mermaid.test.ts` asserts the pinned init config so a later edit cannot silently drop a pin.

Browser floor: mermaid 12 requires ES2024 / Safari 17.4+ / Node 22.12+. The application's supported Node range is `^24.15.0 || >=26`; production builds use Node 24. The retained Node 22 CI job is a legacy compatibility probe, not a supported installation target; see canonical specification section 2. The Safari floor is accepted as stated. AI-6 second-engine/manual-feel and AI-7 live/PWA checks remain open.

## PDF engine: @embedpdf/pdfium 2.15.1 (runtime) and pdfjs-dist 6.5.438 (tests only)

Decision and evidence: [PDF_WORKBENCH.md](PDF_WORKBENCH.md) (ADR-P0). Both are exact pins.
`@embedpdf/pdfium` is PDFium compiled to WASM (wrapper MIT, PDFium BSD-3-Clause/Apache-2.0; the
third-party libraries compiled into the wasm are listed with their texts in
`docs/licenses/PDFIUM_THIRD_PARTY_NOTICES.txt`, appended to the production licence bundle). Only
`src/pdf/engine.ts` imports it. The wasm is fetched from the app's own origin through Vite's `?url`
import and instantiated under `'wasm-unsafe-eval'`; it runs on the main thread (no worker, desktop
`worker-src 'none'` unchanged). The package's `HEAPU8` view is missing from its types; use `heap()`.
`FPDF_GetLastError` codes map to `PdfOpenError` (2 file, 3 format, 4 password, 5 security).
On upgrade: re-run `tests/pdf-engine.test.ts` and the desktop `pdf-read` suite, and recheck the
third-party list in the wasm.

Dependency review (2026-11-13, `dependency-auditor`): approved with notes. No advisories; no install
scripts; one publisher and no npm provenance. The 2.x line lives on upstream branch `v2` (2.15.1 =
commit `eb14d5ae4`); upstream `main` moved to 3.x, so a later move to 3.x is a planned migration, not
a patch bump. The wasm contains FreeType 2.14.1 (FTL), libjpeg-turbo 3.1.0, OpenJPEG 2.5.4, Little
CMS 2.15, libpng 1.6.43, zlib 1.3.1, AGG 2.3 (its own permissive licence), ICU 77.1, Abseil,
fast_float and the Emscripten runtime (musl, libc++); texts in `docs/licenses/`. Not verified: that
the published wasm reproduces from source.

`pdfjs-dist` is the second parser that reopens every corpus file and, from P2, every saved output
(`pdfjs-dist/legacy/build/pdf.mjs` in Node). It never ships. It pulls the optional native
`@napi-rs/canvas` binaries, unused by the tests.

## Other integrations

Unchanged render sequencing, strict TypeScript requirements and no-slice behavior remain governed by the canonical specification. Follow current `src/render/{markdown,math,highlight,mermaid,sanitize}.ts` and `src/paginate/*` rather than a dated illustrative recipe. In particular, sanitization precedes DOM insertion, height-affecting preparation precedes pagination, and PDF export consumes a captured input under the render-host lease.
