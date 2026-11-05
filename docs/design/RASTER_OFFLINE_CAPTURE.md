# Offline raster capture

Owner: `src/export/offlineCapture.ts`, coordinated by `src/export/download.ts`.
Contract: [implementation spec §§5, 6 and 10](IMPLEMENTATION_SPEC.md).
Related qualification: [#174](https://github.com/Chris0Jeky/MDviewer/issues/174),
[#178](https://github.com/Chris0Jeky/MDviewer/pull/178).

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
may have error status. Font readiness can settle after failures, so settlement
alone is insufficient. Footnote marker painting and the existing one-canvas-per-
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
waits and the complete multi-page export still have no new overall timeout.

## Evidence and acceptance

| Head / run | Evidence | Limit |
| --- | --- | --- |
| `8ca1b584`, [CI 42030752873](https://github.com/Chris0Jeky/MDviewer/actions/runs/42030752873), Chromium job `127256289626` | Both offline attempts recorded a controlled source, initially uncontrolled capture iframe, and the real CSS error. 114 passed, 2 failed, 5 skipped. [Artifact 13416716182](https://github.com/Chris0Jeky/MDviewer/actions/runs/42030752873/artifacts/13416716182). | No saved offline PDF; this establishes the failure, not pixel fidelity. |
| `4de36024`, [CI 42033740144](https://github.com/Chris0Jeky/MDviewer/actions/runs/42033740144), Chromium job `127266404527` | The controlled `srcdoc` proof passed: control survived adoption; CSS and a KaTeX font returned 200 from the worker. Removing the exact cached CSS entry caused a real error while the source remained styled. 115 passed, the same 2 export failures, 5 skipped. [Artifact 13418076297](https://github.com/Chris0Jeky/MDviewer/actions/runs/42033740144/artifacts/13418076297). | This is a capture-context proof, not a PDF/export replacement. |
| `c02627a8`, [CI 42036581888](https://github.com/Chris0Jeky/MDviewer/actions/runs/42036581888), Chromium job `127276196392` | The original offline download, actual saved-PDF RGB/ink checks, deliberately damaged second PDF, and existing online CSS controls passed. 120 passed, 1 failed, 5 skipped. Local checks: 721 unit tests in 64 files, typecheck/lint, 4 server tests, web and desktop web builds. [Artifact 13418942201](https://github.com/Chris0Jeky/MDviewer/actions/runs/42036581888/artifacts/13418942201). | The new cache-loss control failed on its restored-cache retry. Its trace showed ordinary uncontrolled capture frames on all three attempts. The test had not asserted the offline routing hint; aligning its additional cache-control CDP session is the next harness check. Cache-recovery acceptance still needs exact-head hosted results. |

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

Exact-head CI and independent review still apply after main reconciliation or
further commits. This note does not close second-engine, live/PWA operator,
Windows manual, performance or AI-6–AI-9 gates, and does not constitute deployment
evidence.
