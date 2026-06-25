---
name: mdv-claude-tooling
description: Claude tool selection and safety in the MDviewer repo — hooks, the pre_tool_use guard, and pre-handoff smoke checks.
user-invocable: true
---

# mdv-claude-tooling

Use this when choosing Claude tools, working with the harness config, or before a
handoff that touched skills/hooks.

## Tool selection

- Prefer dedicated tools over Bash: `Read` (not `cat`/`head`/`tail`), `Grep` (not
  `grep`/`rg`), `Glob` (not `find`), `Edit`/`Write` (not `sed`/`echo >`).
- Use absolute paths; the cwd resets between Bash calls.
- Batch independent reads/searches in one turn; only serialize when a value depends on a
  prior result.

## Safety / guardrails

- Shared guardrails live in committed `.claude/settings.json`; machine-specific
  overrides in `.claude/settings.local.json`. Permission-bypass mode belongs only in
  disposable containers/VMs.
- A pre_tool_use hook enforces branch-aware git rules: protected branches (`main`,
  `master`, `develop`, `release`) block rebase/force-push/hard-reset/history-rewrite;
  other branches allow them but route through the permission prompt.
- Explain-before-acting: before any history-rewriting or work-discarding git command,
  state in plain language what you will do, what could be lost, and whether it is
  reversible, then wait for approval.
- No runtime network calls, telemetry, or document persistence in the app — these are
  product invariants, not just tooling preferences.

## Pre-handoff smoke checks

Run before declaring skills/hooks work done:
- `npm run agent:skills:validate` — confirms each skill's frontmatter `name` equals its
  directory name (`validate_skills.py`) and that all 14 are referenced in `CLAUDE.md`.
- `npm run agent:hooks:smoke` — confirms the hooks fire as configured.

## Verify

Skills validate and hooks smoke-test clean; any tool denial or guard interaction is
recorded via `mdv-failure-capture` and surfaced in the handoff.
