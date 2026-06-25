# Guide Update Protocol — MDviewer

When you learn something the docs should have told you, update the docs. Keep
each source of truth in its lane and fight bloat.

## When to update

- The same mistake happened twice.
- A review caught something a guide should have prevented.
- A workaround was needed (record it and the future fix).
- A source-of-truth path moved.
- A safety, privacy, or build-pipeline boundary changed.

## Where to write it

| Kind of knowledge | Destination |
| --- | --- |
| Short universal rule | `CLAUDE.md` / `AGENTS.md` |
| Repeatable workflow | `.claude/skills/<name>/SKILL.md` |
| Fast code orientation | `autodoc/AGENT_INDEX.md` |
| Product behavior / spec | `docs/` (vision, architecture, design) |
| Phase / status truth | `docs/Project_Roadmap.md` |
| Tool/env failure | `docs/agentic/failure_ledger.jsonl` (+ `FAILURE_LEDGER.md`) |
| Human-only task | `ACTION_ITEMS.md` |

## Anti-bloat rules

- Keep `CLAUDE.md` under ~200 lines. Push procedures into skills.
- Replace obsolete guidance; do not append a contradicting line.
- One precise rule beats three vague warnings.
- Do not promote a single, ambiguous failure into a permanent rule.

## Candidate patch format

> **Observed:** <what happened>.
> **Root cause:** <why>.
> **Repeat risk:** <low/med/high>.
> **Destination:** <file>.
> **Proposed wording:** <exact text>.
> **Verification:** <how you confirmed it helps>.
