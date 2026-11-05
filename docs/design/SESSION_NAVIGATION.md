# Session document navigation (#199)

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
import. Filename collisions receive an ordinal label in the document picker.

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

## Verification (2026-11-05)

The final runtime revision `9aaf0cd` passed TypeScript, ESLint, both production
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

Locked Chromium, packaged Windows behavior, hosted exact-head CI, and independent
review remain the publishing agent's gates. Apple modifier behavior is covered
by a platform-stubbed unit test; no native Mac browser claim is made.
