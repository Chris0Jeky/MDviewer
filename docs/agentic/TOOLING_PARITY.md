# Tooling Parity — Claude Code & Codex

MDviewer is built primarily with **Claude Code**, but the workflow contract is
kept runtime-neutral so a Codex (or other) agent can pick the work up without
re-learning the project. Each runtime uses its own native tools and guardrails;
the *intent* stays aligned.

## What each runtime reads

| Concern | Claude Code | Codex / other |
| --- | --- | --- |
| Operating contract | `CLAUDE.md` | `AGENTS.md` |
| Skills | `.claude/skills/<name>/SKILL.md` | the same skill intent, applied manually |
| Permissions / safety | `.claude/settings.json` + `scripts/agent_hooks/*` | self-discipline + the same git rules |
| Shared process docs | `docs/agentic/*` | `docs/agentic/*` |
| Code orientation | `autodoc/AGENT_INDEX.md` | `autodoc/AGENT_INDEX.md` |

## Rules of parity

1. `CLAUDE.md` and `AGENTS.md` must agree on authority order, work style, and the
   merge/question/failure protocols. If you change one, change the other in the
   same slice.
2. Skills are the canonical home for repeatable procedure. A Codex agent without
   the Skill tool should still be able to *read* a `SKILL.md` and follow it.
3. The git safety rules in `GIT_WORKFLOW.md` apply to every runtime, whether or
   not a pre-tool hook is enforcing them.
4. Record any intentional difference between runtimes here so it is not mistaken
   for drift.

## Current intentional differences

- Only Claude Code has the enforcing `pre_tool_use.py` hook. Codex must apply the
  same destructive-operation rules by discipline.
