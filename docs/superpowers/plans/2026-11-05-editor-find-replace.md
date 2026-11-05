# Find and Replace implementation plan

**Goal:** add direct, bounded, accessible source search and undoable replacement.

**Architecture:** pure literal-search model, a small inline controller, and the
existing native textarea's guarded edit seam. No new dependency or persistence.

1. Add behavior tests for literal/case/Unicode matching, wrap navigation, range
   bounds and literal replacement. Observe failure against an empty model, then
   implement the model and rerun the targeted suite.
2. Integrate the independently reviewed editor mutation-safety seam. Add real
   component tests for opening, queries, current result, keyboard routing,
   document changes, replace, replace-all, cancellations and teardown.
3. Implement the inline controls and screen-only responsive styles. Keep the
   existing textarea/backdrop box metrics identical and avoid scanning while shut.
4. Add production Chromium coverage for undo/redo, deep-match reveal, narrow
   layouts, print suppression and both source layers. Capture a useful screenshot.
5. Run typecheck, lint, full units, production web/desktop builds and agent checks;
   sync the canonical spec and agent index. Publish a scoped draft through GitHub.
6. Review the actual latest diff independently, triage all comments and inspect
   exact-head five-job CI/browser evidence. Merge with a merge commit only after
   those checks and the repository's minimum head age; reconcile with current main.
