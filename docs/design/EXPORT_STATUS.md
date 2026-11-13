# PDF export status (#200)

## Decision

Raster export feedback occupies a compact final row of the application shell,
outside `#canvas` and the scrolling toolbar. Markdown mode and short-window Find
may park the measurable preview with `visibility: hidden`; neither can hide this
status. The row collapses before the first export and retains the last outcome
until the next PDF request (or clears for a vector print request).

The existing canvas overlay remains useful in Preview/Split. It does not own the
accessible export announcement. The external, initially empty live region stays
mounted with `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.
Status updates never focus an element. The visible count and native progress
element update for every completed page; live announcements occur on the first
completed page and quarter milestones, at most five times per capture.

## State and save semantics

| Phase | Evidence and visible message |
| --- | --- |
| Preparing | Request captured before waiting for the render lease; “Preparing PDF…” |
| Rendering | Real capture callback after each page image is added; “Rendered N of M PDF pages…” |
| Saving | Capture finished and the configured native save destination is pending; “Saving PDF…” |
| Downloading | Capture finished and jsPDF's browser handoff promise is pending; “Starting PDF download…” |
| Saved | Native destination resolved successfully; “PDF saved.” |
| Download requested | jsPDF completed the browser handoff; “PDF download requested.” |
| Cancel requested | The user asked to stop (#201); the lease is held until the renderer settles; “Canceling PDF export…” |
| Export canceled | Stopped before any save was handed off; nothing saved; “PDF export canceled. Nothing was saved…” |
| Canceled | Native destination rejected with `SaveCanceled`; document remains open |
| Failed | Preparation, capture, or save failed; existing fatal detail remains available and export can retry |

Failure status includes the specific error reason as plain text, with whitespace
normalized and the reason bounded to 180 characters. It wraps within the strip;
the existing fatal card retains the full detail. Chrome selectors are scoped to
the shell's direct status child so an authored “Export status” heading keeps its
styles and remains visible in print.

A browser download does not prove a disk write or disclose a canceled browser
prompt. Only a resolved native destination produces the “saved” message. A native
cancel is distinct from a capture/save error. A Cancel button (#201) is shown
only in Preparing and Rendering, is hidden from the save handoff on, and never
takes or moves focus; see `RASTER_OFFLINE_CAPTURE.md` "Bounded cancellation".

## Preserved contracts

- The captured document/settings and scheduler lease cover preparation, page
  capture, and save settlement. Pending renders still wait for export completion.
- The canvas stays mounted and measurable in Markdown and parked Find layouts.
  Status is outside the page capture host and is explicitly hidden in print CSS.
- Source text, selection, focus, scroll, view mode, page geometry, and page DOM
  identity are not changed by status updates.
- Successful capture clears prior fatal feedback before releasing the lease;
  failed/canceled saves keep prior fatal feedback. Render/ingestion warnings stay.
- No dependencies, document persistence, network destinations, or analytics
  fields are added. Vector print keeps its original path and save semantics.

## Verification

Unit coverage includes persistent/exposed live-region structure, unchanged source
focus/selection, exact progress versus bounded announcements, all terminal states,
native save settlement/cancellation, browser handoff settlement/rejection,
failure/retry, and the existing captured-input/export-lifetime/print DOM contracts.
The first new component run failed because the component did not yet exist; the
focused implementation run passed 138 tests, TypeScript, and ESLint.

`tests/e2e/export-status.spec.ts` runs against the production bundle without CDP
APIs. It pauses actual capture stylesheet requests to inspect Preparing and the
first real page-completion callback. It checks viewport and text bounds, hit
testing, the accessible status/progress node, source focus/selection/scroll,
hidden measurable canvas, unchanged page identity/count, print suppression, and
a real failed capture followed by a successful download. The matrix covers
Markdown/Split/Preview at 1280×800, Find/Replace at 1280×420 and 560×420, and
Markdown at 375×667. Screenshots and geometry attachments are emitted by the spec.

## Historical isolated qualification (2026-11-05)

The feature merged in [#210](https://github.com/Chris0Jeky/MDviewer/pull/210).
The [current checkpoint](2026-11-05-editor-followup-checkpoint.md) records the
combined application qualification; the receipts below describe earlier isolated
revisions.

The production Firefox matrix passed **7/7 without retries** (51.9 seconds) using
the locked Playwright Firefox engine and the application code at local commit
`0a9e34a`. TypeScript and ESLint also passed. That isolated full unit suite passed
**843 tests across 72 files**, including native/browser save settlement and
cancellation, bounded failure detail, and the existing export/clone invariants.

Screenshots were visually inspected for short-window Find and the failed capture.
At 560×420, the progress strip spans x=0…560 and y=388.20…420, with an unobscured
text box inside those bounds and the source area still above it. The geometry
assertions allow only 0.5 CSS pixels of engine rounding (Firefox reports a bottom
of 420.000015), and explicitly check hit testing. Focus assertions compare the
original DOM node to `document.activeElement`; markup-string comparison was an
invalid early harness attempt because capture/screenshot preparation may add an
empty style attribute without changing focus.

Local reproduction used a temporary config under ignored `test-results/`, port
5193, one Firefox worker, production preview, and this process-only sandbox
setting required by the managed container:

```sh
npm run build
MOZ_DISABLE_CONTENT_SANDBOX=1 E2E_TARGET=preview npx playwright test --config test-results/playwright.export-local.config.ts
```

The committed spec also runs in the standard Chromium production suite. Firefox
integration must set `E2E_TARGET=preview`; the paused linked-stylesheet checks
deliberately skip against Vite development CSS. Evidence is generated under
`test-results/export-status-firefox/`: `pdf-progress-*.png`, matching geometry JSON
files, `pdf-status-failed.png`, and `pdf-status-recovered.png`. An early local build
was refused by the dirty-source identity guard; a stale output directory also
caused `ENOTEMPTY`. Neither attempt counts as a passing build. Moving old output
aside and building committed source produced a successful clean production build.

Native Windows save-dialog behavior, manual assistive technology speech, hosted
Chromium/Firefox, and exact-head CI remain separate acceptance gates; these local
tests do not claim those checks passed.

Hosted Chromium at the first PR head passed 136 cases, including the seven new
status scenarios, and found one stale offline-suite assertion still watching the
old canvas live region and “downloaded” wording. That assertion now requires the
new external live region and exact “PDF download requested.” outcome; its real
network cut, downloaded file and re-enabled controls remain required. Both Node
lanes, desktop Chromium and the actual Windows native/save smoke passed that head.
The corrected final head subsequently passed fresh full CI and review before
merging; see the current checkpoint for its exact head, merge and workflow links.
