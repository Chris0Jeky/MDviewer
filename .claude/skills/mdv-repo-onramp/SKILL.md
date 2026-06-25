---
name: mdv-repo-onramp
description: Orient to the MDviewer repo before editing — use at session start, when scope is vague, or when entering an unfamiliar layer.
user-invocable: true
---

# mdv-repo-onramp

Use this at the start of a session, when a request is broad or ambiguous, or before
touching a layer you have not worked in yet. The goal is to load just enough context
to pick one safe, reviewable slice — not to bulk-read the whole tree.

## Read order (stop once you can name the slice)

1. `ACTION_ITEMS.md` (repo root) — human-only tasks + verified current-state snapshot.
   Flag every OPEN/BLOCKED item in any summary you produce.
2. `AGENTS.md` — repo-wide operating rules.
3. `docs/Project_Roadmap.md` — active phase, priorities, gates.
4. `docs/design/IMPLEMENTATION_SPEC.md` — the canonical source of truth: render order
   (section 3), no-slice tiers (section 4), pinned signatures (section 7), DOM names
   (section 8). This file wins if code and docs disagree.
5. `autodoc/AGENT_INDEX.md` — fast code-seam map.
6. `docs/design/LIBRARY_NOTES.md` only when touching a library integration.

## What MDviewer is (one line)

Browser-only, drag-and-drop Markdown → PDF; 100% client-side; the #1 guarantee is that
no code block, figure, table, or callout is ever sliced across a page boundary.

## Pick the slice

- State the smallest change that moves one roadmap item.
- Name the exact files (use `mdv-repo-map` if unsure).
- State blockers, assumptions, the verification target, and the docs-sync target
  BEFORE editing.

## Do not

- Bulk-read `node_modules`, generated build output, or archives.
- Mix render, paginate, export, and UI layers in one slice unless the seam requires it.
- Add runtime network calls, telemetry, or document persistence (only `Settings`
  persists, localStorage key `mdviewer.settings.v1`).

## Verify

You are oriented when you can state: the slice, its files, its verification command
(`npm run test` and/or the relevant e2e spec), and which OPEN action items still stand.
