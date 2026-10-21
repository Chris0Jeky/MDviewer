# Fallback PDF visual regression coverage

Issue [#136](https://github.com/Chris0Jeky/MDviewer/issues/136) identified a gap after
html2canvas-pro 2.5.2: a successful download does not show that its page was drawn
correctly. The existing raster-resolution test compares captures of the same
renderer at different preview states. A defect shared by all those captures can
pass that comparison.

## Reproduce the durable check

```sh
npm ci
npx playwright install chromium
npm run build
E2E_TARGET=preview npm run test:e2e -- tests/e2e/raster-visual.spec.ts
```

The fixture passes through the real file-input, Markdown/sanitization and Paged.js
pipeline. The test captures a native browser reference, switches to the dark
screen theme and Markdown-only mode, then clicks Download PDF. No renderer or
download is mocked.

The downloaded file is read through its xref, page, resource and content
references. Each page must paint exactly one opaque RGB image at the full paper
size, without rotation or offset. The generated image's Flate/PNG predictor bytes
are rewrapped as a PNG and decoded by Chromium. This test helper deliberately
supports only the format the current fallback emits; a different encoding fails
explicitly instead of skipping the assertion or selecting an unused image.

Pixel expectations are independent of earlier html2canvas captures:

- Fixed RGB probes cover HSL, brightness/opacity composition, linear and radial
  gradients, translated SVG and overlap order.
- Invisible SVG overlays must stay invisible, while the ordinary SVG is visible.
- Code, math, headings, tables and TOC regions contain ink; syntax retains color.
- The styled task checkbox retains its blue fill and light tick. Tick coverage
  counts interior pixels to allow its necessary antialiasing.
- A second real download deliberately removes one color patch, code and the tick.
  The same visual criteria must identify those losses.

`test-results/` retains the PDF, extracted page PNG, native browser reference,
pixel measurements and damaged-control PDF/PNG. The existing CI browser-artifact
upload includes them on success and failure. No native PDF package or new npm
dependency is required for this check.

## Defects found while adding the check

All three were reproduced against the production bundle using html2canvas-pro
2.5.2 before the relevant fix. This does not establish which dependency release
first introduced each behavior.

1. The cloner materializes the TOC leader with its computed used width. As a flex
   basis, that copied width can shrink the title by a rounding fraction, wrap it
   onto another line and move everything below it. Resetting the copied leader's
   width to `auto` restores the original flex layout.
2. SVG elements receive copied computed styles, including inherited
   `visibility:hidden` from the parked Markdown-only preview. Revealing the sheet
   leaves those inline SVG declarations hidden. Restoring each SVG node's authored
   visibility declaration allows inheritance while retaining intentional hiding.
3. The renderer's checkbox painter overrides the app's styled control. The clone
   now uses a static span with the existing computed paint. Its tick also needed
   intrinsic SVG width/height: an independent canvas probe drew zero nontransparent
   pixels with the renderer's nine-argument resize of the viewBox-only SVG, and
   21 pixels at 8×8 after adding `width="16" height="16"`.

All normalization remains in the disposable capture clone. The live page, real
checkboxes, source, pagination and primary vector export keep their existing
contracts. Unit coverage checks clone isolation and preservation of explicit SVG
hiding; the production browser test proves the saved pixels.

## Scope of the evidence

This is a regional visual contract, not a complete typography snapshot, a generic
PDF conformance validator or a comparison with html2canvas-pro 2.5.0. It detects
missing content, wrong colors and the reproduced geometry changes without pinning
platform font antialiasing. The separate no-slice, multi-page, offline, primary
print and preview-resolution tests remain required. Human acceptance items
AI-6/AI-7/AI-8/AI-9 remain open; this check does not establish other-browser or live
deployment acceptance.
