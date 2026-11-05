# Desktop New document

**Completed:** [#183](https://github.com/Chris0Jeky/MDviewer/pull/183), merged as
`3e67112850422fbd05a004323ad39a4e026c2481`, closes
[#181](https://github.com/Chris0Jeky/MDviewer/issues/181). The implementation sequence
and local candidate evidence below are historical. Hosted qualification and later
combined-main verification are recorded in the
[authoring checkpoint](2026-11-05-authoring-checkpoint.md).

## Design

New starts a blank, memory-only Markdown document directly in the existing lazy
editing workspace. It is available from the reader toolbar, reader empty state,
workspace toolbar and Ctrl/Cmd+N. Ordinary reader startup still loads no editor or
pagination workspace. The first available case-insensitive name is `Untitled.md`,
`Untitled 2.md`, and so on among currently open documents.

Desktop owns admission and source lifetime. Creation uses the existing 32-document
and 25,000,000 UTF-8-byte session limits, preserves all existing documents, and
records an empty clean baseline. Typing makes the document dirty. Save Markdown
continues saving a copy; it does not change the original-source dirty baseline.
Failed workspace entry retains the complete reader session for retry.

New is blocked during mode transitions, exports and native save dialogs. A newer
New action owns selection ahead of an outstanding open request. New reveals the
editor when the saved layout is Preview-only, preserves Markdown/Split otherwise,
and focuses the source pane. No new persistence, native capability or rendering
pipeline is introduced.

## Historical implementation sequence

1. Reproduce missing empty-reader creation and shortcut routing with regressions.
2. Add bounded desktop creation, an optional toolbar callback and explicit
   `data-document-command` action selectors.
3. Verify document retention, admission failures, dirty round trips, async open
   ownership, repeat/composition guards and transition/export/native-save guards.
4. Add production desktop coverage for New, editing, preview, source saving and
   Preview-only layout recovery; retain the existing lazy-startup controls.
5. Run local typecheck, lint, unit tests and both builds. Hosted Chromium and native
   Windows checks, screenshot review and independent exact-head review were required
   before merge. The local environment had no Chromium, Rust or PowerShell.

## Documentation and remaining work

The Windows guide, implementation specification and agent index now document New,
its callback and the explicit command selectors. AI-6/AI-7/AI-8/AI-9 and Windows
issue #169 stay open. This slice did not qualify offline raster PDF capture; that
separate work subsequently completed in [#178](https://github.com/Chris0Jeky/MDviewer/pull/178).
Further authoring work is tracked in [Future work](../FUTURE_WORK.md) and
[#195](https://github.com/Chris0Jeky/MDviewer/issues/195).

## Local candidate verification — 2026-11-05

The regression-first run failed 18 New/shortcut cases while 13 existing controls
passed against the original production source. The isolated New candidate then
passed `agent:check` (726 unit tests, four server tests, typecheck, lint and SDK
integrity), both production builds, hook smoke checks and all 14 skill validations.
Builds use the honest source-archive label
`local-main-0bfcce1-new-document-candidate`. Existing dependency deprecation and
large-chunk build warnings remain; no dependency change is included.

Production browser coverage records the empty reader, a newly written note and
the revealed source pane as screenshots. Those browser tests and native Windows
checks could not run locally. The completed #183 hosted checks, screenshot review
and independent review are linked from the authoring checkpoint above.
