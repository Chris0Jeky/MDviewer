---
name: mdv-verify-handoff
description: Close an MDviewer task properly — verify the changed seam, state residual risk, and sync docs only when truth changed.
user-invocable: true
---

# mdv-verify-handoff

Use this as the last step of any change, before declaring it done.

## Verification steps

1. Re-read the requested outcome and confirm the diff actually delivers it.
2. Verify the exact changed seam — read the final code, not your memory of it.
3. State the commands you ran and their real results:
   - `npm run test` (Vitest) for unit-level changes.
   - `npm run test:e2e` (Playwright) for anything layout-affecting; ALWAYS
     `tests/e2e/nocutoff.spec.ts` for render/paginate/break/export work.
   - typecheck / lint / build if the toolchain config changed.
4. State what you did NOT verify and why (e.g. "no real browser available, e2e not run
   in this sandbox").
5. Never claim a test passed unless it actually ran in this environment.

## Handoff content

- The slice delivered and the files touched.
- Commands run + results; what is unverified and why.
- Every failure/workaround from the session (`mdv-failure-capture`), each with a
  disposition.
- Every OPEN/BLOCKED item from `ACTION_ITEMS.md`, restated.
- Assumptions you proceeded on (`mdv-question-batch`).

## Docs sync (only if truth changed)

- Public signature changed → `mdv-interface-map` (`autodoc/AGENT_INDEX.md` +
  `IMPLEMENTATION_SPEC.md` section 7).
- Phase/status changed → `mdv-roadmap-sync` (`docs/Project_Roadmap.md`).
- New recurring failure → failure ledger.

## Verify

The handoff is complete when a reviewer could re-run your verification verbatim and
knows exactly what remains open. Keep it short and factual.
