# Offline raster capture

Owner: `src/export/offlineCapture.ts`, coordinated by `src/export/download.ts`.
Contract: [implementation spec §§5, 6 and 10](IMPLEMENTATION_SPEC.md).
Related qualification: [#174](https://github.com/Chris0Jeky/MDviewer/issues/174),
[#178](https://github.com/Chris0Jeky/MDviewer/pull/178).

## Completed qualification — 2026-11-05

The capture correction merged in #178 as `85f7361e`, closing #174. Its integrated
head `a9664f9b5041ffa7e7c04fa3913dbc6959334df7` passed all five jobs in
[CI 42045009842](https://github.com/Chris0Jeky/MDviewer/actions/runs/42045009842) and
[Windows Desktop 42045009809](https://github.com/Chris0Jeky/MDviewer/actions/runs/42045009809):
818 unit tests, 127 web cases with five existing optional performance skips,
27 desktop-reader cases, and the native build/smoke gate. The
[browser evidence](https://github.com/Chris0Jeky/MDviewer/actions/runs/42045009842/artifacts/13423519305)
retains the original online/offline saved-PDF pixels, damaged controls, and both
CSS/font recovery JSON files and PDFs. All 11 RGB probes and six ink measurements
matched between healthy online and offline captures. Each missing-resource control
refused two saves, removed its frames, then saved a one-page PDF after restoring
the original cached response.

The [integration source artifact](https://github.com/Chris0Jeky/MDviewer/actions/runs/42045009809/artifacts/13422969042)
recorded GitHub's synthetic PR merge commit `b18b8ab03266939ba42b8472c87f6906d69ba8d6`.
Its tree `62fb5c93cbcffd1df86dc92ab0070ac7234a9cf8` matched the reviewed candidate,
and all 323 archived blobs matched the authoritative tree.

After the authoring and Shiki updates, final main
`203c09798b01061ceb0c00f0937c22beeafb1a55` passed all five push jobs in
[CI 42053738540](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053738540) and
[Windows Desktop 42053740244](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244):
832 unit tests in each Node job, 130 web cases with the same five optional skips,
27 desktop-reader cases, and 22 Rust tests plus actual native smoke. Its
[source artifact](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244/artifacts/13427938732)
names that literal main commit and tree `8fe8e94f9cde0a52f3344075f0c272f140825ccb`;
all 330 archived blobs were verified. [#169](https://github.com/Chris0Jeky/MDviewer/issues/169)
records the corresponding binary, source and native saved-file checksums and the
remaining human acceptance. These checkpoints qualify the tested Chromium capture
contract; they do not close second-engine, live/PWA or Windows manual gates.

## Failure established in Chromium

The source page and html2canvas's capture iframe are different service-worker
clients. In the production offline test, the source was controlled by `sw.js` and
its app stylesheet returned 200 from the service worker. The newly inserted
`about:blank` capture iframe inherited the source origin but had no controller.
It remained uncontrolled through `document.open`, writing, closing, adoption and
root replacement. Its request for the identical stylesheet failed with
`ERR_INTERNET_DISCONNECTED`.

The stylesheet's `error` event still had a non-null `link.sheet`. Neither origin,
document URL, `readyState`, nor `sheet` presence proves a successful offline load.
The existing outcome guard correctly prevented an unstyled PDF from being saved.
The installed 2.5.2 and 2.6.0 packages share this iframe mount sequence; this
evidence does not attribute the underlying client-control problem to 2.6.

## Select the destination before cloning

`offlineCaptureController` selects the additional path only when the source
window reports `navigator.onLine === false` and has an accessible service-worker
controller with a script URL. All other cases use the existing capture path,
including online capture and packaged desktop documents without a controller.
`onLine` is only a routing hint: actual resource outcomes still determine success.
A failed ordinary stylesheet request never triggers an automatic retry through
another document.

The offline destination is a new, empty `srcdoc` iframe inside the capture's
owned, ignored container. Its navigation has a ten-second budget. It must finish
at `about:srcdoc` and expose the source controller's script URL. Controller and
document identity are checked again during adoption and before rendering.
Unsupported controller inheritance fails with the existing Print/Save fallback.
This does not register a worker, claim clients, navigate the app, or change worker
caching policy.

The library's `iframeContainer` option cannot admit a prepared iframe: the
installed 2.6.0 `createIFrameContainer` ignores the return value of `appendChild`
and immediately uses the frame it created. The adapter instead uses the existing
`onclone` callback. The library keeps the cloned reference node and reads its
`ownerDocument` after that callback, allowing the same nodes to be adopted into
the prepared destination without serializing the page or losing canvas state.

## CSS order and document ownership

The source's linked styles are snapshotted before cloning. The offline path
omits those exact link nodes from the temporary library iframe, which is used to
prepare the DOM. It therefore does not wait for an arbitrary failed initial CSS
request and then disregard that failure. The callback verifies the observed
temporary document, that every planned link was omitted, and that the source
link identities, attributes, disabled state and relative style order have not
changed.

After detaching and adopting the cloned root, the adapter restores fresh link
nodes before mounting that root in the controlled destination. Each link retains
its position relative to source inline head styles. Links after the last source
style are inserted before any renderer-appended head styles. The renderer's
generated pseudo-hiding styles remain in the body. Existing inline styles,
generated pseudo elements, author content and reference-node identity stay in
the cloned tree. The destination viewport matches the library frame.

The installed renderer clones source inline head styles in order, appends
document adopted styles to the end of head, and adds its pseudo-hiding styles to
body. Those are explicit compatibility assumptions, covered by the ordering
fixture and actual saved-PDF regressions. Recheck them when upgrading the
renderer. The library supplies the source base URI; the adapter does not rewrite
CSS text, asset URLs or relative font paths.

Scope is MDviewer's app-owned linked CSS in the document head. Ordinary document
stylesheet links outside the head and links to another origin are rejected. The
document selectors do not traverse shadow roots: this is not a general shadow-DOM
capture adapter. A future component that changes these source structures must
revisit the contract rather than assume its styles are covered.

## Resource outcomes, bounds and cleanup

Immediately after the final root is inserted, in the same JavaScript task,
`download.ts` observes every enabled, non-alternate stylesheet link with an
`href`. No resource event task can run between insertion and binding. A load
event, unchanged link identity/URL, and a non-null sheet are all required. An
error or the ten-second stylesheet deadline rejects the capture. Empty and
cross-origin-inaccessible rule lists are not inspected as readiness evidence.

After successful CSS, the existing clone normalization reveals the sheet and
removes preview scaling/clipping. A layout read precedes a separate ten-second
font deadline. `fonts.ready` must settle and no font in that document's font set
may have error status. The [Font Loading specification](https://www.w3.org/TR/css-font-loading-3/#font-face-set-ready)
defines the ready promise as fulfilling even after font failures, so settlement
alone is insufficient. Unused, unloaded faces are allowed. Footnote marker painting and the existing one-canvas-per-
paginated-page export then continue normally.

The source DOM, prepared-page lease, pagination order, export APIs, native save
destination and primary Print routing are unchanged. There is no new document
persistence, remote document request, CSS fetch helper or CSS-text fallback.
CSS and fonts use their ordinary same-origin browser requests through the
existing worker cache.

The outer capture `finally` removes both owned frames and their container on
success or any failure, including errors outside `onclone`. Owned resource
listeners and timers are disposed; unrelated frames remain. A failure saves no
PDF and leaves the existing error feedback/retry behavior available. The frame,
CSS and font waits are bounded individually; the library's preceding image/font
waits are not individually bounded here; cancellation and the progress bound that cover them
are defined in "Bounded cancellation" below ([#201](https://github.com/Chris0Jeky/MDviewer/issues/201)),
which preserves render ownership and the existing no-save controls.

## Bounded cancellation (#201)

One `AbortController` per raster export, owned by `App.exportPdf` and passed as
`FallbackPdfOptions.signal`. A rejected promise is never taken for "stopped": the export settles only
after everything that can read the render host has, so `withRenderLock` is not released early and no late
callback can touch a replacement host.

| Phase | Behavior on cancel |
| --- | --- |
| Waiting for the lease | The queued callback throws before preparation or any host access; ordinary renders run meanwhile. |
| Render preparation | Not interruptible (it is the ordinary render of the requested input). The callback stops right after it. |
| Frame mount, CSS, `srcdoc` navigation | Interrupted: the signal reaches `createOfflineCapture`, the adapter's stylesheet wait and the renderer (html2canvas-pro 2.6 `signal`: iframe load, stylesheet wait, image preload, paint checkpoints). |
| Clone fonts | The adapter's font wait is interrupted. The renderer's own `documentClone.fonts.ready` await, and any synchronous layout or paint, are not (see the limitation below). |
| Between pages / assembly | The signal is checked before each page, before encoding it and before `pdf.output`; a finished page is dropped and its canvas zeroed. No partial PDF is ever assembled or saved. |
| Native dialog / browser handoff | The last check is immediately before `onSaving`. After it Cancel is hidden: a native dialog uses its own Cancel (`SaveCanceled`), and a browser download prompt is not observable. |

Two states are distinct. `cancel-requested` ("Canceling PDF export…") means the lease and busy state are
still held, the Cancel control is hidden and progress from the stopped operation is ignored. The terminal
`export-canceled` ("PDF export canceled. Nothing was saved.") means every reader has settled and a retry is
safe. User cancellation is never reported as a failure; the save dialog's own cancel keeps the `canceled`
phase. Owned frames, listeners, timers and canvases are released as the capture unwinds (`capturePage`'s
`finally`; the abortable, font and frame waits remove their own listeners and timers).

**Budget.** There is no whole-document wall-clock deadline: large documents legitimately run long, and a
representative budget needs the workloads of [#202](https://github.com/Chris0Jeky/MDviewer/issues/202). The
policy is a progress bound, `PDF_PAGE_STALL_MS` (90 s) from the start of capture or the previous page. It
covers the adapter's own waits (frame, CSS and fonts, 10 s each) plus the renderer's 15 s image timeout with
margin. On expiry the export is aborted through the same path and ends as a failure whose message offers
Print / Save as PDF. The watchdog stops at the save handoff.

**Known upstream limitation.** A JavaScript timer cannot preempt a synchronous main-thread section, and
html2canvas-pro 2.6 awaits `documentClone.fonts.ready` without a signal. A capture stalled there (reproduced
in `tests/e2e/export-cancel.spec.ts` by parking the clone's font set) cannot be stopped: Cancel stays at
`cancel-requested` with the lease held until the renderer yields. That is deliberate rather than hidden
behind a relaxed deadline; Print remains the fallback. A hard bound would need renderer isolation (a worker or
a separate document), which is not designed here.

## Historical diagnosis and required acceptance

The workflows use the default pull-request merge ref. Runs below are associated
with the listed PR head, while their runtime tree is the synthetic integration
with main available to that run. In particular, the run associated with
`268bcb8f` includes main `4976` and its New/Find features. Test counts include the
main-branch tests present in each merge ref. These runs do not establish runtime
behavior of an isolated historical branch tree. They preceded the completed
`a9664f9b` integration above, which explicitly merged current main, passed fresh CI,
and verified the source archive COMMIT/TREE against the integrated candidate tree.

| PR head / run | Evidence | Limit |
| --- | --- | --- |
| `8ca1b584`, [CI 42030752873](https://github.com/Chris0Jeky/MDviewer/actions/runs/42030752873), Chromium job `127256289626` | Both offline attempts recorded a controlled source, initially uncontrolled capture iframe, and the real CSS error. 114 passed, 2 failed, 5 skipped. [Artifact 13416716182](https://github.com/Chris0Jeky/MDviewer/actions/runs/42030752873/artifacts/13416716182). | No saved offline PDF; this establishes the failure, not pixel fidelity. |
| `4de36024`, [CI 42033740144](https://github.com/Chris0Jeky/MDviewer/actions/runs/42033740144), Chromium job `127266404527` | The controlled `srcdoc` proof passed: control survived adoption; CSS and a KaTeX font returned 200 from the worker. Removing the exact cached CSS entry caused a real error while the source remained styled. 115 passed, the same 2 export failures, 5 skipped. [Artifact 13418076297](https://github.com/Chris0Jeky/MDviewer/actions/runs/42033740144/artifacts/13418076297). | This is a capture-context proof, not a PDF/export replacement. |
| `c02627a8`, [CI 42036581888](https://github.com/Chris0Jeky/MDviewer/actions/runs/42036581888), Chromium job `127276196392` | The original offline download, actual saved-PDF RGB/ink checks, deliberately damaged second PDF, and existing online CSS controls passed. 120 passed, 1 failed, 5 skipped. All 11 RGB samples and 6 ink measurements matched the online PDF. Local checks: 721 unit tests in 64 files, typecheck/lint, 4 server tests, web and desktop web builds. [Artifact 13418942201](https://github.com/Chris0Jeky/MDviewer/actions/runs/42036581888/artifacts/13418942201). | The new cache-loss control failed on its restored-cache retry. Its trace showed ordinary uncontrolled capture frames on all three attempts; the test had not asserted the offline routing hint. The additional cache-control CDP session was aligned in the next test-only candidate. |
| `f5a3b6f8`, [CI 42038913043](https://github.com/Chris0Jeky/MDviewer/actions/runs/42038913043), Chromium job `127284220223` | 126 passed, 5 skipped, no failures. The CSS control asserted an offline source before all captures, two missing-CSS requests in the controlled destination, no saves or retained frames, restoration of the original cached response, then worker-served CSS and an actual one-page PDF. Existing saved-PDF pixels, damaged controls and online failure/retry guards passed. [Artifact 13420422027](https://github.com/Chris0Jeky/MDviewer/actions/runs/42038913043/artifacts/13420422027) includes the recovery PDF. | The capture implementation files are unchanged from `c02627a8`. The extra test CDP session explicitly emulates offline after reload. The initial body-only JSON attachment was not retained by the artifact upload; the assertions and PDF were retained. Later runs write the JSON file explicitly. The missing-font control was not yet present at this head. |
| `268bcb8f`, [CI 42039793150](https://github.com/Chris0Jeky/MDviewer/actions/runs/42039793150), Chromium job `127287280284` | 127 passed, 5 skipped, no failures. The real font-cache control passed: the source retained its loaded font; two captures requested the missing font in `about:srcdoc` while CSS remained worker-served; neither saved a PDF or retained a frame. Restoring the original response yielded a worker-served font and an actual one-page PDF. Existing CSS recovery, saved-PDF pixels, damaged controls and online guards remained green. [Artifact 13420388005](https://github.com/Chris0Jeky/MDviewer/actions/runs/42039793150/artifacts/13420388005). | The capture implementation files are unchanged from `c02627a8`. This head still used body-only recovery JSON attachments; the final integration writes those files explicitly. Reconciliation with current main and any further commit require fresh exact-head CI and review. |

The same `268bcb8f` head did not pass every platform gate. In
[Windows run 42039793185](https://github.com/Chris0Jeky/MDviewer/actions/runs/42039793185),
native job `127287280277` passed the build and 22 Rust tests, then timed out waiting
for its first Save dialog. The same readiness race also affected main `4976`;
[#190](https://github.com/Chris0Jeky/MDviewer/issues/190) tracks the desktop smoke
correction. [Native artifact 13421195361](https://github.com/Chris0Jeky/MDviewer/actions/runs/42039793185/artifacts/13421195361)
has SHA256 `55ed02f0e4f7200e85d95473409909d71f7594bc1ffbcf99031bbe0ca77e0727`.
The correction has since merged in [#192](https://github.com/Chris0Jeky/MDviewer/pull/192)
as `7f6db5d2d6ee541e6ab2fc7baf8250f03f76fd78`, after all five jobs passed and the
source TREE and actual two-dialog native save metrics were verified. The completed
`a9664f9b` capture integration includes that correction and passed fresh native and
browser checks. The earlier `268bcb8f` native failure remains part of the record.

Required browser acceptance remains the actual offline downloaded-PDF RGB/ink
test and its deliberately damaged second download in `raster-visual.spec.ts`.
The network is cut and an uncached probe fails before fixture loading or export
imports. Existing online delayed-CSS and failed-CSS/no-save/retry cases remain
unchanged.

`raster-styles-ready.spec.ts` additionally removes the exact app CSS CacheStorage
entry after the source is styled, requires two failed exports with no download or
retained iframe, restores the original cached response, and parses the actual PDF
saved on retry. HTTP/memory cache is disabled for this control so it cannot mask
the missing worker entry. Its extra cache-control CDP session explicitly uses
offline network conditions after navigation; both `navigator.onLine === false`
and an uncached request failure are checked. Each export checks the source
controller and offline hint, and resource events must identify the controlled
destination. There are no route-provided CSS responses. Unit cases
cover source/link/style ordering, generated styles, controller refusal, bounded
navigation, inactive links, final CSS failure/cleanup/retry and failed fonts.

`raster-fonts-ready.spec.ts` removes the exact precached KaTeX Main-Regular woff2
response only after the source's corresponding face is loaded. Its two exports
must receive the font-failure message and save no PDF while app CSS still loads
through the worker. It requires missing-font requests in the controlled
destination, complete cleanup, unchanged source text/view, and retention of the
source's loaded face. Restoring the original response must yield a worker-served
font and an actual one-page PDF. Both cache-loss controls keep their normal test
deadlines and write bounded resource/source metadata to artifact JSON files.

Exact-head CI and independent review still apply to further commits. This note
does not close second-engine, live/PWA operator,
Windows manual, performance or AI-6–AI-9 gates, and does not constitute deployment
evidence.
