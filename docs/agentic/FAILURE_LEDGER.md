# Failure Ledger — MDviewer

A human-readable view of recurring agent / tool / workflow failures. The source
of truth is `docs/agentic/failure_ledger.jsonl` (git-tracked, curated). Raw,
machine-captured failures land in `docs/agentic/failure_autolog.jsonl`
(gitignored) via the `PostToolUseFailure` hook.

Regenerate the table below from the JSONL with:

```
python scripts/agent_hooks/render_failure_ledger.py
```

## Classification

- **blocker** — work cannot continue until resolved.
- **non_blocking_risk** — work continues, but confidence is reduced.
- **pre_existing_noise** — unrelated but visible; do not let it mask new signal.
- **invalid_signal** — false alarm or stale; record so it is not re-investigated.

## Promotion rule

A ledger entry becomes a permanent guide update (CLAUDE.md / skill / index) only
when it is **reproducible, project-specific, and recurring**. One-off
environment hiccups stay in the ledger.

<!-- LEDGER:START -->
| Date | Class | Surface | Failure | Workaround | Future fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-06-25 | non_blocking_risk | scaffold | Bootstrap entry — ledger initialized with the project scaffold. | n/a | Replace with the first real finding. | closed |
<!-- LEDGER:END -->
