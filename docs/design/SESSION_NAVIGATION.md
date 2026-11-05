# Session document navigation (#199)

Current merged qualification: [editor follow-up checkpoint](2026-11-05-editor-followup-checkpoint.md). Earlier local receipts below describe their own source revisions.

## Contract

Document positions are volatile coordinates keyed by the stable document ID, never
by filename or content. The cache holds at most 64 open-document entries using
least-recently-used eviction. It contains no source, DOM references, undo history,
or browser storage. Closing removes the entry. The existing single Undo Close
snapshot may carry that document's coordinates; restoring assigns a new ID and
consumes the snapshot. Discard and teardown release it.

The source position consists of UTF-16 selection offsets, selection direction,
and vertical/horizontal scroll offsets. Restore clamps offsets to the current
text and lets the browser clamp scroll to current geometry. Each real identity
switch creates a fresh textarea, including equal-content documents; native undo
therefore remains isolated. Find retargets the new textarea and recomputes ranges
before the saved position is restored.

Preview coordinates use the existing page/fraction model and restore only after
the corresponding document finishes pagination. Reader/workspace transitions
transfer coordinates explicitly while preserving the reader's lazy workspace
import. A successful reader render builds and reveals the heading outline before
restoring scroll offsets, so clamping uses the final text width and document
height. Stale and failed renders cannot restore another document's position.
Filename collisions receive an ordinal label in the document picker.

The reader shell establishes its border-box model before the first workspace
import. Lazy workspace CSS therefore cannot change the outline or reading width
and invalidate saved offsets when returning to the reader.

Complete visible pages retain their own document identity while new source is
preparing or preparation has failed. That identity is separate from export-ready
render metadata, which is invalidated immediately. Position capture follows the
visible page owner even when another document is active in the editor. The last
complete position is sampled again immediately before pagination; partial or
failed pagination cannot overwrite it. Closing a document still removes its
coordinates, including while old pages await teardown. Fatal feedback keeps its
existing behavior of revealing the error card at the canvas origin; later
scrolling of retained pages is captured under their original document identity.

## Keyboard access

Visible Previous and Next controls cycle the current document order. On Windows
and Linux, their
shortcuts are Alt+Shift+P and Alt+Shift+N. Alt+Shift+D focuses the
document picker; its native arrow/Enter behavior selects a document. Titles,
`aria-keyshortcuts`, and a visible hint disclose these commands. Browser tab,
history, page, and native arrow-selection shortcuts keep their existing behavior.
On Apple platforms these custom chords and their hints are omitted to preserve
Option-generated text; Tab/Enter on the buttons and the native picker remain
available. A separate Mac shortcut scheme is outside this slice. Composition, already
handled events, and held-key repeats do not navigate.

## Implementation and checks

1. Capture positions before a store identity mutation, restore source immediately,
   and restore preview after a successful render for that identity.
2. Avoid store events for reselecting the active ID and avoid pagination for an
   inactive import or position-only movement.
3. Transfer a single close position through existing recovery and transfer desktop
   coordinates during reader/workspace mode changes.
4. Verify bounded eviction/removal, duplicate names/equal contents, Unicode and
   changed text, stale Find ranges, delayed imports, repeated navigation, native
   undo isolation, and long-document scroll restoration.

No history stack, persistent storage, source mutation, new renderer, or new
reader-startup dependency is introduced.

## Historical isolated verification (2026-11-05)

The isolated navigation revision `9aaf0cd` passed TypeScript, ESLint, both production
builds, and all 846 Vitest tests across 73 files. The hook smoke check and
14-skill validation also passed. The new unit coverage includes bounded LRU
eviction, close/removal, Unicode clamping, latest-close position transfer,
delayed reader imports, initial/failed reader render fencing, repeated mode
handoffs, and Apple Option-key non-interception.

Production-preview Firefox passed 23 browser cases using a temporary local
configuration with separate web and desktop servers and one worker. The command
selected `session-navigation.spec.ts`, `editor-edit-safety.spec.ts`,
`input-race.spec.ts`, `toolbar.spec.ts`, and `editor-search.spec.ts`. It covered
source/preview scroll, equal names and equal content, repeated switches, open and
closed Find, native undo isolation, close/undo, preview-only/source transitions,
reader/workspace handoffs, lazy reader loading, and existing/new 560×420 and
640×480 layout checks. Source contents and paginated DOM identity were checked
for position-only commands. The container required the per-command
`MOZ_DISABLE_CONTENT_SANDBOX=1` compatibility setting.

The initial dev-server run passed its eight cases but emitted font allow-list
errors because dependencies were symlinked from the verified checkout. The final
production-preview run served bundled assets and passed without that dev-server
limitation. A first dirty-tree build correctly refused to stamp license
provenance; clean committed builds subsequently passed.

At that isolated checkpoint, locked Chromium, packaged Windows behavior, hosted
exact-head CI and independent review remained publishing gates. Their subsequent
receipts are in #212 and the linked follow-up checkpoint. Apple modifier behavior is covered
by a platform-stubbed unit test; no native Mac browser claim is made.

### Pending preparation regression

The follow-up runtime fix `a66e027` separates complete visible-page ownership
from export readiness. Its five unit cases cover held preparation, failed
preparation for another document, obsolete preparation, partial pagination
failure, and close-before-teardown. At `387645a`, TypeScript, ESLint, the full
862-test / 75-file unit suite, and a clean production web build passed.

Production Firefox passed six focused cases from `preview-position-race.spec.ts`
and `session-navigation.spec.ts` on a separate preview server. The new regression
holds the first Mermaid module request, moves the old preview during preparation,
switches documents, and verifies the restored position. Its failure control
asserts the existing fatal-card scroll reset before testing a new scroll on the
retained pages. The first version incorrectly expected the pre-error scroll to
survive that intentional reset; the corrected test preserves the existing
feedback contract. Both new cases are included in the production Firefox
authoring lane. Hosted exact-head checks and independent review remain separate
release gates.

### Reader outline geometry regression

The 1000×720 desktop regression uses wrapped paragraphs and a visible 17-heading
outline, with the saved position 40 px from the document end. Against baseline
`7758707`, both a document switch and a reader/workspace round-trip restored
7378.3999 instead of the saved 7501 px. The hidden outline temporarily widened
and shortened the document before the browser clamped the requested scroll.

Runtime fix `c59b48f` builds and reveals the outline before restoring offsets,
within the existing successful-render generation check. Both new cases and the
three existing desktop navigation cases pass in production Firefox. The existing
stale/failed-render unit control also now checks outline exclusion and retained
coordinate ownership. TypeScript, ESLint, 33 relevant unit tests across three
files, and clean web/desktop production builds passed. Both browser regressions
are selected by the existing desktop Firefox authoring lane. Packaged Windows
and hosted exact-head checks remain separate gates.

### First workspace stylesheet regression

Hosted Windows Firefox run `42089308673`, job `127463352748`, exposed another
geometry change at published head `c6f7f2be` (local `ca37a09`): the workspace
round-trip restored 6671 instead of 7066 px. Its downloaded trace and artifact
`13443928529` show a stable clamp, while the document-switch case passed.

The lazy workspace's universal `box-sizing: border-box` reset narrowed the
reader outline from 219 to 190 px and widened the reading viewport from 781 to
810 px. Local Firefox retained the same paragraph line counts despite the width
change; Windows rewrapped and shortened the document. Local measurements showed
unchanged fonts and line height, with fonts already loaded on both sides.

The reader now applies the same box model within the actual body-child reader
shell at startup, without importing workspace assets. The existing near-end
regression retains its exact scroll assertion and additionally requires equal
outline, viewport and document geometry before and after the transition. That
new geometry assertion fails against `ca37a09` on local Firefox as well, making
the cause reproducible independently of platform font wrapping.
