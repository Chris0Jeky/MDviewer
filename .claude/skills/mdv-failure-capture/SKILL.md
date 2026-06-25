---
name: mdv-failure-capture
description: Classify and record MDviewer failures (failed commands, flaky tests, denials, workarounds) — never skip a finding.
user-invocable: true
---

# mdv-failure-capture

Use this whenever a command fails, a dependency is missing, a tool is denied, a test is
flaky, a docs-control warning fires, or you apply a workaround. No finding may be
dropped because it is "minor" or "non-blocking."

## Classify each finding

- Blocker — stops the task; must be fixed or escalated now.
- Non-blocking risk — does not stop this slice but is real; seed a concrete follow-up.
- Pre-existing noise — already on `main`, unrelated to your change; note it.
- Invalid signal — false alarm; record why so it is not re-investigated.

## Record

- For recurring or instructive failures: append a line to
  `docs/agentic/failure_ledger.jsonl` and/or update `docs/agentic/FAILURE_LEDGER.md`.
- Every unresolved finding must become one of: a fix in the current diff, a GitHub
  issue, a roadmap entry, or a ledger entry with a concrete fix path.
- Promote confirmed lessons via `docs/agentic/GUIDE_UPDATE_PROTOCOL.md`.

## MDviewer-specific traps worth a ledger entry

- Render-order regressions (paginating before fonts/Mermaid settle → misplaced breaks).
- Paged.js teardown leaks (`style[data-pagedjs-inserted-styles]` left behind → stale
  CSS on re-paginate).
- Shiki 3.x-vs-4.x API drift; KaTeX without `katex.min.css`; Mermaid `useMaxWidth` not
  false (wrong measured height).
- jsdom layout assertions sneaking into unit tests (always wrong → must be e2e).

## Verify

Every failure surfaced this session appears in the final handoff with its
classification and disposition (fixed / issue / roadmap / ledger). Nothing skipped.
