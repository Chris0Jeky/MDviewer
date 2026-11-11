# Claude Operating Contract — MDviewer

Compact session contract for Claude Code in `MDviewer/`. Keep it short. Put repeatable
procedures in `.claude/skills/*/SKILL.md` and deep detail in `docs/*`.

@AGENTS.md

`AGENTS.md` (imported above) holds the project summary, authority order, structure, commands,
render order and privacy guardrails shared with Codex. This file adds only what is
Claude-specific. Estate laws (`~/.claude/rules/laws.md`) govern where this repository is silent.

## Session start

Read `ACTION_ITEMS.md` and the top of `ORCHESTRATOR.md`; the rest of the canon loads or is
linked from `AGENTS.md`. Pick one primary skill and at most one support skill, then the
smallest safe, reviewable change.

Use [Future work](docs/FUTURE_WORK.md) and [#195](https://github.com/Chris0Jeky/MDviewer/issues/195)
for the issue-backed queue. Native Save/Save As [#196](https://github.com/Chris0Jeky/MDviewer/issues/196)
and recovery [#197](https://github.com/Chris0Jeky/MDviewer/issues/197) have reviewed designs
merged in #209; native proof, measurement and implementation gates remain open.
Current Save Copy, memory-only sessions and privacy contracts remain in force until their
reviewed implementation updates those contracts together.

## Human Action Items

`ACTION_ITEMS.md` is the running list of tasks only the user (Chris) can do — manual
browser testing, product go/no-go — plus a verified current-state snapshot. Rules:

1. **Read it at session start.**
2. **Flag every OPEN / BLOCKED item** near the top of any status report, summary, or handoff. Never let an open item go unmentioned.
3. **Clear an item only on explicit user confirmation.** Move it to the Completed log with date + one-line result.
4. **Keep the current-state snapshot accurate** when verified truth changes.
5. When you discover a new human-only task, add an `AI-N` item with a step-by-step guide and tell the user.

## Git Workflow

Full detail: [`docs/agentic/GIT_WORKFLOW.md`](docs/agentic/GIT_WORKFLOW.md). These rules are
agent-held: `scripts/agent_hooks/pre_tool_use.py` exists but is not wired as a `PreToolUse`
hook (this machine is declared floorless), so nothing blocks a command for you.

- **Protected branches** (`main`, `master`, `develop`, `release`): no rebase, force-push, hard/soft/mixed reset, `commit --amend`, `checkout -- <path>`, `restore`, `pull --rebase`.
- **Never run**: `rm -rf`, `sudo`, `chmod -R 777`, bare force-push, `git clean -f`, `curl|sh`, `npm publish`.
- **Update branch:** `git merge main` (not rebase). **Diverged remote:** `git merge origin/<branch>`.
- **Never `git commit --amend` after pushing.** New commit instead.
- **Commits and PRs carry no attribution trailers** (`attribution` is empty in `.claude/settings.json`).
- Before any history-rewriting/discarding command: explain it in plain language, state the risk and reversibility, and let the user run it.

## Default Work Style

- Prefer narrow diffs over rewrites; preserve existing behavior unless the task asks for a change.
- Keep the app **local-first**: no document network calls or automatic/app-managed document or session persistence. Explicit user-selected Markdown copies and PDF saves/exports write the requested output; Save Copy does not adopt an original-file binding or clear its dirty baseline. Persisted app-managed user state remains limited to `Settings` and the approved Pulseboard keys in `AGENTS.md`. The SDK (`public/pulseboard.js`) is reached only through `src/app/pulse.ts` with closed enums, size buckets and counts — never document text, file names, headings, URLs or export contents (`tests/pulse.test.ts`). No other telemetry.
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
in the final handoff if unresolved. Fix it now or seed a concrete follow-up (tracked issue,
roadmap entry or `docs/agentic/failure_ledger.jsonl`); never drop one silently. Recurring
lessons get promoted via `docs/agentic/GUIDE_UPDATE_PROTOCOL.md`.

## Review & Merge Gates

Estate law 2 governs review: read existing comments first, post findings on the PR, triage every
comment once. Fix confirmed CRITICAL and HIGH findings (correctness, security, data loss) before
merge; everything else becomes a tracked issue or a one-line decline, never a fix-commit cascade.
Two rounds at most, then ship or park. Before a change is considered done:

- **Correctness**: the no-slice guarantee still holds (run the no-cutoff test for any
  render/pagination/export change). Render order intact.
- **CI/tests**: `npm run typecheck`, `npm run lint`, `npm run test` green; `npm run test:e2e`
  green for render/pagination/export/UI changes. New code has tests.
- **Manual (Gate, human)**: drag-drop → preview → Print/Save-as-PDF and Download-PDF verified in
  a real browser for UI/pagination/export changes (tracked as an AI-N item when it needs Chris).
- **No silent debt**: no TODO without a tracked follow-up; no skipped required tests; no silent
  workarounds. Report the existing opt-in performance-ladder skips separately.
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
- Windows reading and workspace ownership: `src/desktop/{main,session,render,workspace,native}.ts`;
  native file/link/save boundaries: `src-tauri/src/{main,file_policy,export_policy}.rs`.
- UI: `src/ui/Toolbar.ts`, `Canvas.ts`, `EmptyState.ts`, `Banner.ts`. Styles: `src/styles/*`.
- Split workspace: `src/ui/Editor.ts`, `Splitter.ts`, `src/styles/editor.css`
  (`IMPLEMENTATION_SPEC.md` §12). The source backdrop and the textarea must keep identical box
  metrics, token text goes in via `textContent` (never `innerHTML`), and `@media print` must
  keep the editing surface off the exported PDF.
- The guarantee test: `tests/e2e/nocutoff.spec.ts` (+ fixture `tests/fixtures/nocutoff.md`).

## Local Settings

Committed `.claude/settings.json` holds shared guardrails (`bypassPermissions` + the safety
hooks in `scripts/agent_hooks/*`). Use `.claude/settings.local.json` only for machine-specific
overrides (gitignored). MCP defaults live in `.mcp.json` (credential-free: context7, playwright,
ripgrep) — verify a server is live via `/mcp` before relying on it.
