# Fallback PDF visual regression coverage

Issue [#136](https://github.com/Chris0Jeky/MDviewer/issues/136) identified a gap after
html2canvas-pro 2.5.2: a successful download does not show that its page was drawn
correctly. The existing raster-resolution test compares captures of the same
renderer at different preview states. A defect shared by all those captures can
pass that comparison.

## Current qualification

Main `203c09798b01061ceb0c00f0937c22beeafb1a55` uses html2canvas-pro 2.6.0 with the
capture correction merged in [#178](https://github.com/Chris0Jeky/MDviewer/pull/178).
Its [production Chromium push job](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053738540/job/127336535492)
passed 130 cases with five existing optional performance skips, including the
online/offline saved-PDF pixels, damaged-output controls and real CSS/font
cache-loss refusal, cleanup and recovery. All five jobs passed, and the source
artifact's literal main commit, tree and all 330 blobs were verified. The
[offline capture note](design/RASTER_OFFLINE_CAPTURE.md#completed-qualification--2026-11-05)
records this final-main receipt and the earlier integrated `a9664f9b` qualification.
These results do not establish second-engine or live-deployment acceptance.

## Reproduce the durable check

```sh
npm ci
npx playwright install chromium
npm run build
E2E_TARGET=preview npm run test:e2e -- tests/e2e/raster-visual.spec.ts tests/e2e/raster-footnotes.spec.ts tests/e2e/raster-styles-ready.spec.ts tests/e2e/raster-fonts-ready.spec.ts tests/e2e/raster-offline-frame.spec.ts
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
- The online production run delays linked stylesheets only inside the capture iframe.
  Its live preview is already styled; the test verifies the delay actually
  occurred before checking the saved page's pixels.
- A separate two-page fixture checks all twelve footnote numerals, including
  double digits, repeats and a heading ID collision. The regions exclude note
  text, and require the first-line baseline for tall inline content. A block-first
  note retains its native marker's existing separate line. The live note geometry
  and generated IDs must be identical after export. A second actual PDF hides
  only the added numeral paint and must fail every numeral region.

The production failure/retry check aborts capture CSS on two attempts, verifies
no PDF was saved and no capture iframe remains, then allows a successful retry.
Unit tests exercise stylesheet errors before `onclone`, including retained empty
sheets and sheets whose `cssRules` getter throws, plus load/error events queued
after the callback starts. Successful empty and inaccessible sheets must still
export after an observed load. Further cases cover all required links, unused
links, the mount-time stylesheet deadline, a fresh post-reveal font deadline,
failures outside the callback, unrelated iframes, source preservation and retry.
The existing clone/content/pseudo tests invoke their callback during a mounted
capture; they retain their visibility, geometry and content assertions.
Upstream font/image waits precede `onclone`; neither readiness deadline is a
timeout for the whole export. [#201](https://github.com/Chris0Jeky/MDviewer/issues/201)
tracks bounded capture/cancellation without weakening these failure controls.

`test-results/` retains the PDF, extracted page PNG, native browser reference,
pixel measurements and damaged-control PDF/PNG. The existing CI browser-artifact
upload includes them on success and failure. No native PDF package or new npm
dependency is required for this check.

## html2canvas-pro 2.6 readiness contract

Issue [#167](https://github.com/Chris0Jeky/MDviewer/issues/167) exposed a changed
callback order when PR #165 upgraded html2canvas-pro from 2.5.2 to 2.6.0.
The library now awaits `stylesheetsReady` before calling `onclone`, but that wait
resolves on both link load and error events, and after its readiness timeout.
The old adapter added its own listeners inside `onclone`; an already-fired error
was missed, delaying failure by another ten seconds.

A first correction checked for a missing `link.sheet` after that wait. The
[diagnostic browser run](https://github.com/Chris0Jeky/MDviewer/actions/runs/41952565137/job/126999705106)
disproved that signal: both aborted required links retained non-null sheets with
inaccessible rules, and the exporter still saved a PDF. Chromium's
[`LinkStyle::NotifyFinished`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/link_style.cc)
can create a sheet after a load failure; its presence is not a successful load.
Rejecting empty or inaccessible rules would also reject valid CSS.

The adapter observes actual load/error outcomes in a container it owns. The
timing relies on the inspected 2.6 implementation: [`renderElement`](https://github.com/yorickshan/html2canvas-pro/blob/v2.6.0/src/core/render-element.ts)
does not await until calling `DocumentCloner.toIFrame`, which synchronously calls
[`mountCloneInIFrame`](https://github.com/yorickshan/html2canvas-pro/blob/v2.6.0/src/dom/iframe-mount.ts).
Mounting appends the iframe and replaces its document root before returning.
The adapter attaches listeners immediately after `html2canvas()` returns its
promise, in the same JavaScript task. Chromium's
[`HTMLLinkElement::ScheduleEvent`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/html_link_element.cc)
queues link load/error dispatch as a later task. No MutationObserver, global
prototype patch or extra resource request is needed.

The enabled, non-alternate linked stylesheets with nonempty `href` values each
retain an outcome promise. Errors resolve a failed outcome, avoiding an unhandled
rejection while upstream waits for fonts/images. At `onclone`, the adapter checks
that it is using the observed owned Document and the same required links, then
awaits all outcomes and rejects promptly if any failed. Upstream sheet polling
can settle before a queued load/error event, so an unresolved outcome remains
pending even when `link.sheet` is non-null. Its ten-second deadline starts at
mount observation and is never restarted by the callback. An observed successful
load accepts empty or inaccessible rules without reading them. External
`@import` handling remains upstream; the application's bundled CSS has none.

After CSS succeeds, clone normalization and layout precede a fresh ten-second
font deadline. A fulfilled `document.fonts.ready` is insufficient if an attempted
font face has an error status; that capture also rejects without saving. Unused,
unloaded faces remain valid. The entire owned container, iframe, listeners and timers are
released in `finally`, including when capture fails outside `onclone`. The
container is fixed with zero dimensions and is excluded from cloning through
`data-html2canvas-ignore`; unrelated iframes and the live page are preserved.
The adapter rejects a missing or unobserved callback rather than accepting a
future incompatible library lifecycle.

The upstream stylesheet wait was introduced by commit
[`b9f57d9`](https://github.com/yorickshan/html2canvas-pro/commit/b9f57d9942745e7a1103d67446d81b919977c669).
The existing online delayed-CSS pixel assertions and the failed-CSS
cleanup/retry tests remain intact; extending their timeouts would hide the
missed-event regression.

## Offline resource availability and qualification (#174)

The original 2.6 adapter was blocked by offline resource availability. Historical
[`ab40ca7f` web CI](https://github.com/Chris0Jeky/MDviewer/actions/runs/41954702853)
passed the original online CSS failure/retry and delayed-CSS pixel cases, but
failed the unchanged offline raster download. Its trace shows the source page
loading cached CSS after an offline reload while the capture iframe's request
for the same stylesheet fails with `ERR_INTERNET_DISCONNECTED`. The observed
error correctly prevents saving. The iframe creation and document-open sequence
are unchanged between upstream 2.5.2 and 2.6.0, so this evidence does not establish
a newly introduced service-worker lifecycle change.

The later diagnostic directly observed an uncontrolled staging document and
failed CSS, despite the source being controlled. The correction in
[#178](https://github.com/Chris0Jeky/MDviewer/pull/178) prepares a controlled empty
`srcdoc` destination before cloning, adopts the cloned root into that destination,
and recreates the app's stylesheet links in their original cascade positions.
This path requires an offline source and an accessible existing service-worker
controller; ordinary online/native capture retains its existing route. It does
not retry arbitrary failed stylesheets. See [the lifecycle contract and exact-head
evidence](design/RASTER_OFFLINE_CAPTURE.md) for ownership, scope and cleanup.

`raster-visual.spec.ts` now runs the same independent pixel expectations and
actually damaged second download in separate online and offline contexts. The
offline branch waits for service-worker readiness, cuts the network, reloads,
checks that the page has a controller and verifies an uncached request fails
before loading the fixture or importing export dependencies. It installs no
stylesheet route interception. Both real downloaded PDFs must satisfy their
respective healthy/damaged assertions. The offline branch is skipped only
outside the production-preview target; hosted production checks must run it.
The page/frame foreign-request assertion is supplemental and is not a complete
service-worker network inventory.

In CI associated with head `c02627a8`, the original offline download, online/offline saved-PDF
pixels and damaged controls passed. The independently extracted online and offline
fixtures have identical color and ink measurements. The test-only `f5a3b6f8`
correction aligned an extra CDP cache-control session with the context's offline
state; its full production browser run passed 126 tests with five existing optional
skips. The next head `268bcb8f` added the real missing-font recovery control and
[passed 127 tests with five existing optional skips](https://github.com/Chris0Jeky/MDviewer/actions/runs/42039793150/job/127287280284).
These workflows used GitHub's PR merge refs, so their runtime trees also included
the then-current main. These results are specific checkpoints, not a substitute
for all five required checks and source-tree verification after subsequent integration.

The CSS and font recovery tests delete the actual CacheStorage entry only after
the source has loaded it. HTTP/memory cache is disabled. Both failed capture
attempts must use the controlled destination, save no PDF and remove all owned
frames; the source and view remain intact. Restoring the original cached Response
must yield a real parseable PDF with a worker-served resource response. The font
case additionally proves CSS still loads while the required KaTeX face fails.
No route supplies a replacement stylesheet or font. File-backed JSON attachments
retain bounded resource metadata alongside the recovery PDFs.

## Defects found while adding the check

The following were reproduced against the production bundle using html2canvas-pro
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
4. The capture iframe can report loaded before its newly adopted stylesheet links
   finish loading. A controlled 350 ms clone-only CSS delay produced a valid but
   unstyled PDF. The original 2.5.2 adapter waited for those links, resolved layout,
   then waited for fonts introduced by that CSS. It released failed clones because
   that version's cleanup started only after `onclone` succeeded. The 2.6 contract
   above observes the cloned links before their events and validates every
   required outcome before normalization.
5. Paged.js uses native `::marker` content for footnote numerals. The browser
   reserves the correct width, but html2canvas does not paint that content: the
   initial twelve-note downloaded PDF had zero ink in every numeral region.
   Clone-only absolute text now fills that existing space using the number from
   the linked citation. An initial top-edge placement also failed for a tall
   inline image; temporary baseline probes corrected it. Probes are removed
   before capture, and any change to the note or original content geometry
   aborts the export instead of accepting reflow.

All normalization remains in the disposable capture clone. The live page, real
checkboxes, source, pagination and primary vector export keep their existing
contracts. Unit coverage checks clone isolation, readiness cleanup, marker
identity/continuations/baseline alignment and preservation of explicit hiding;
the production browser tests prove the saved pixels. Marker normalization is
limited to Paged.js's default decimal marker; it does not implement arbitrary
authored CSS counter styles.

## Scope of the evidence

This is a regional visual contract, not a complete typography snapshot, a generic
PDF conformance validator or a comparison with html2canvas-pro 2.5.0. It detects
missing content, wrong colors and the reproduced geometry changes without pinning
platform font antialiasing. The separate no-slice, multi-page, offline, primary
print and preview-resolution tests remain required. Human acceptance items
AI-6/AI-7/AI-8/AI-9 remain open; this check does not establish other-browser or live
deployment acceptance.
