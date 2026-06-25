# Claude Operating Contract — MDviewer

Compact session contract for Claude Code in `MDviewer/`. Keep it short. Put repeatable
procedures in `.claude/skills/*/SKILL.md` and deep detail in `docs/*`.

## What this project is

A browser-based, drag-and-drop **Markdown → PDF** tool. The one job that defines it:
export beautiful PDFs where **no code block, figure, table, or callout is ever sliced
across a page boundary**. Built for research papers and code-heavy docs. 100%
client-side, local-first (no runtime network calls, nothing uploaded). Vanilla
TypeScript + Vite. Full design: [`docs/design/IMPLEMENTATION_SPEC.md`](docs/design/IMPLEMENTATION_SPEC.md).

## Authority Order

1. User prompt for the current turn.
2. `AGENTS.md` — repo-wide operating rules (Claude + Codex share intent).
3. `docs/Project_Roadmap.md` — active phase, priorities, gates.
4. `docs/design/IMPLEMENTATION_SPEC.md` — the canonical build contract (signatures, render order, CSS names).
5. `autodoc/AGENT_INDEX.md` — fast code-seam orientation.
6. Relevant skill under `.claude/skills/*/SKILL.md`.
7. Deeper docs and generated artifacts only when the task needs them.

When sources conflict, follow the higher source and report the conflict.

## First 5 Minutes

1. Read `ACTION_ITEMS.md` (human-owned tasks + current-state snapshot).
2. Read `AGENTS.md`.
3. Read `docs/Project_Roadmap.md`.
4. Read `docs/design/IMPLEMENTATION_SPEC.md` and `autodoc/AGENT_INDEX.md`.
5. Pick one primary skill and at most one support skill.
6. Identify the smallest safe, reviewable change.
7. State blockers, assumptions, the verification target, and the docs-sync target before editing.

Do not bulk-read `node_modules`, `dist`, build output, or generated artifacts unless the task requires it.

## Human Action Items

`ACTION_ITEMS.md` is the running list of tasks only the user (Chris) can do — manual
browser testing, product go/no-go — plus a verified current-state snapshot. Rules:

1. **Read it at session start.**
2. **Flag every OPEN / BLOCKED item** near the top of any status report, summary, or handoff. Never let an open item go unmentioned.
3. **Clear an item only on explicit user confirmation.** Move it to the Completed log with date + one-line result.
4. **Keep the current-state snapshot accurate** when verified truth changes.
5. When you discover a new human-only task, add an `AI-N` item with a step-by-step guide and tell the user.

## Git Workflow

Full detail: [`docs/agentic/GIT_WORKFLOW.md`](docs/agentic/GIT_WORKFLOW.md). The
`pre_tool_use.py` hook enforces the safety rules.

- **Protected branches** (`main`, `master`, `develop`, `release`): no rebase, force-push, hard/soft/mixed reset, `commit --amend`, `checkout -- <path>`, `restore`, `pull --rebase`. Hook-blocked.
- **Always blocked**: `rm -rf`, `sudo`, `chmod -R 777`, bare force-push, `git clean -f`, `curl|sh`, `npm publish`.
- **Update branch:** `git merge main` (not rebase). **Diverged remote:** `git merge origin/<branch>`.
- **Never `git commit --amend` after pushing.** New commit instead.
- **Commits have no `Co-Authored-By` trailer** (`includeCoAuthoredBy: false`).
- Before any history-rewriting/discarding command: explain it in plain language, state the risk and reversibility, and let the user run it.

## Default Work Style

- Prefer narrow diffs over rewrites; preserve existing behavior unless the task asks for a change.
- Keep the app **local-first**: no runtime network calls, telemetry, or document persistence (only `Settings` in localStorage).
- The **render order is load-bearing** (parse → Shiki → KaTeX → Mermaid await → fonts → paginate). Never paginate before async content settles — that defeats the no-slice guarantee.
- Do not mix render-pipeline, pagination, export, and UI concerns in one slice unless the seam requires it.
- Do not silently ignore failures. Classify as blocker, non-blocking risk, pre-existing noise, or invalid signal.
- When using a workaround, record it and the future-fix path.

## Skill Routing

- `mdv-repo-onramp`: broad or ambiguous repo work / session start.
- `mdv-repo-map`: find the exact code seam before editing.
- `mdv-safe-slice`: implement one small reviewable change.
- `mdv-render-pipeline`: markdown-it, Shiki, KaTeX, Mermaid, callouts, TOC, footnotes.
- `mdv-pagination`: Paged.js, the @page/break CSS, the no-slice guarantee (the core).
- `mdv-export`: the print and programmatic-PDF export paths.
- `mdv-ui-ux`: toolbar, dropzone, themes, empty/error states, accessibility.
- `mdv-test-harness`: Vitest, Playwright, the no-cutoff test, fixtures, sample docs.
- `mdv-question-batch`: decide whether to ask, assume, or proceed.
- `mdv-failure-capture`: classify and record failures.
- `mdv-verify-handoff`: final verification and handoff discipline.
- `mdv-roadmap-sync`: update roadmap/status docs when their truth changes.
- `mdv-interface-map`: update `autodoc/AGENT_INDEX.md` when public seams change.
- `mdv-claude-tooling`: Claude-specific tool selection and safety.

Codex has a matching intent layer via `AGENTS.md` + the shared `docs/agentic/*`. See `docs/agentic/TOOLING_PARITY.md`.

## Question Protocol

Do not ask just because something is uncertain. Ask only for true blockers: irreversible
product decision, destructive action, missing resource, or an ambiguous acceptance criterion
that cannot be inferred from code/docs. Otherwise proceed with a stated assumption and record
it. Batch blocker questions into one message. See `docs/agentic/QUESTION_PROTOCOL.md`.

## Failure Protocol

Every failed command, missing dependency, tool denial, flaky test, or workaround must appear
in the final handoff if unresolved. No finding may be skipped because it is "non-blocking."
Fix it now or seed a concrete follow-up (roadmap entry or `docs/agentic/failure_ledger.jsonl`).
Tech-debt accrual from skipped findings is not acceptable. Recurring lessons get promoted via
`docs/agentic/GUIDE_UPDATE_PROTOCOL.md`.

## Review & Merge Gates

When reviewing a change: read existing comments first, post structured findings, and act on
every finding regardless of tier. "Non-blocking" means "fix it now, not later." Before a
change is considered done:

- **Correctness**: the no-slice guarantee still holds (run the no-cutoff test for any
  render/pagination/export change). Render order intact.
- **CI/tests**: `npm run typecheck`, `npm run lint`, `npm run test` green; `npm run test:e2e`
  green for render/pagination/export/UI changes. New code has tests.
- **Manual (Gate, human)**: drag-drop → preview → Print/Save-as-PDF and Download-PDF verified in
  a real browser for UI/pagination/export changes (tracked as an AI-N item when it needs Chris).
- **Zero tech debt**: no TODO without a tracked follow-up; no skipped tests; no silent workarounds.
- **Docs sync**: roadmap, `IMPLEMENTATION_SPEC.md`, and `AGENT_INDEX.md` updated if their truth changed.

## Verification Protocol

Before the final response: re-read the requested outcome; verify the exact changed seam; state
the commands you ran and their results; state what you did not verify and why; update
roadmap/spec/index docs only if their truth changed. Never claim tests passed unless they ran
in the current environment.

## Project Hot Spots

- Render pipeline: `src/render/markdown.ts`, `highlight.ts`, `math.ts`, `mermaid.ts`, `buildSource.ts`.
- Pagination (the core): `src/paginate/paginate.ts`, `cssBuilder.ts`, `handler.ts`, `shrinkToFit.ts`, `measure.ts`.
- Export: `src/export/print.ts`, `download.ts`.
- App core: `src/app/App.ts` (render order), `state.ts`, `settings.ts`, `dom.ts`, `input.ts`.
- UI: `src/ui/Toolbar.ts`, `Canvas.ts`, `EmptyState.ts`, `Banner.ts`. Styles: `src/styles/*`.
- The guarantee test: `tests/e2e/nocutoff.spec.ts` (+ fixture `tests/fixtures/nocutoff.md`).

## Local Settings

Committed `.claude/settings.json` holds shared guardrails (`bypassPermissions` + the safety
hooks in `scripts/agent_hooks/*`). Use `.claude/settings.local.json` only for machine-specific
overrides (gitignored). MCP defaults live in `.mcp.json` (credential-free: context7, playwright,
ripgrep) — verify a server is live via `/mcp` before relying on it.
