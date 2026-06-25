---
name: mdv-question-batch
description: Decide whether an MDviewer task needs user questions or can proceed with explicit assumptions.
user-invocable: true
---

# mdv-question-batch

Use this before asking the user anything. Do not ask just because something is
uncertain — most uncertainty is resolvable from `IMPLEMENTATION_SPEC.md`,
`LIBRARY_NOTES.md`, the code, or the roadmap. Mirror
`docs/agentic/QUESTION_PROTOCOL.md`.

## Ask only when the uncertainty is a true blocker

- Irreversible product decision (e.g. changing the no-slice guarantee semantics,
  dropping a supported export path, persisting document bytes).
- A security/privacy boundary (any new network call, telemetry, or storage of document
  content — all forbidden by default).
- A public-contract conflict: a pinned signature in spec section 7 would have to change
  in a way other modules depend on.
- Ambiguous acceptance criteria that cannot be inferred from code or docs.

## Otherwise proceed

- Resolve from the spec, library notes, `dom.ts`/`settings.ts`/`state.ts`, the roadmap,
  or existing tests.
- Make the most reasonable assumption, state it explicitly, and record it in the
  handoff. Prefer the default that preserves existing behavior.

## Batch

If you must ask, collect ALL blocker questions into ONE compact message. Never trickle
questions across turns.

## Verify

Before asking, confirm the answer is not already in the spec, library notes, or code.
Every assumption you proceed on must appear in the final handoff (`mdv-verify-handoff`).
