---
name: mdv-roadmap-sync
description: Update docs/Project_Roadmap.md only when an MDviewer change actually changes its truth.
user-invocable: true
---

# mdv-roadmap-sync

Use this when a change alters the project's status — a phase completes, a gate clears,
priorities shift, or a planned item is delivered. Do NOT edit the roadmap cosmetically
or speculatively.

## When to update

- A roadmap item's code now exists on the working branch (and you will land it).
- A phase/milestone status genuinely changed (started, blocked, done).
- A gate's state changed (e.g. a verification lane now passes).

## When NOT to update

- The work is in-progress and unmerged with no status change yet.
- You are tempted to mark something "done" before the code exists — never mark a
  roadmap task done before the implementation is real (accuracy rule).

## Procedure

1. Read `docs/Project_Roadmap.md` and find the affected item.
2. Change only the lines whose truth changed; keep the diff minimal and factual.
3. If a human-only gate blocks (e.g. manual browser testing the agent cannot run),
   leave it OPEN and reflect it in `ACTION_ITEMS.md` instead of self-clearing.
4. Note the change in your handoff (`mdv-verify-handoff`).

## Authority order reminder

User prompt > `AGENTS.md` > `docs/Project_Roadmap.md` >
`docs/design/IMPLEMENTATION_SPEC.md` > `autodoc/AGENT_INDEX.md`. If the roadmap
conflicts with a higher source, follow the higher source and report the conflict.

## Verify

The roadmap diff reflects only verified, landed truth. No task is marked complete ahead
of its code, and no human-only gate is silently cleared.
