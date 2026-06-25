# Agent Operating Contract — MDviewer

Repo-wide operating rules for any coding agent (Claude Code via `CLAUDE.md`, Codex, or
other). Each runtime uses its native tools; the intent here is shared. See
`docs/agentic/TOOLING_PARITY.md`.

## What this project is

A browser-based, drag-and-drop **Markdown → PDF** tool whose defining job is to export
PDFs where **no code block, figure, table, or callout is ever sliced across a page
boundary**. For research and code-heavy documents. 100% client-side, local-first. Vanilla
TypeScript + Vite. Canonical build contract: `docs/design/IMPLEMENTATION_SPEC.md`.

## Authority Order

1. User prompt for the current turn.
2. `AGENTS.md` (this file) — repo-wide rules.
3. `docs/Project_Roadmap.md` — phase status, priorities, gates.
4. `docs/design/IMPLEMENTATION_SPEC.md` — pinned signatures, render order, CSS names.
5. `autodoc/AGENT_INDEX.md` — code-seam map.
6. The relevant skill (`.claude/skills/*/SKILL.md` describes the workflow intent).

When sources conflict, follow the higher source and report the conflict.

## First 5 Minutes

`ACTION_ITEMS.md` → `AGENTS.md` → `docs/Project_Roadmap.md` →
`docs/design/IMPLEMENTATION_SPEC.md` → `autodoc/AGENT_INDEX.md`. Then pick the smallest
safe, reviewable slice and state blockers, assumptions, verification target, and docs-sync
target before editing.

## Project Structure

```
src/app/        controller, state, settings, dom constants, input, sample doc
src/render/     markdown-it + Shiki + KaTeX + Mermaid + source builder
src/paginate/   Paged.js engine wiring, @page/break CSS builder, shrink-to-fit, handlers
src/export/     window.print path + programmatic html2canvas/jsPDF path
src/ui/         toolbar, canvas, empty state, banner
src/styles/     app / preview / document / print / shiki CSS
tests/          Vitest unit tests + tests/e2e Playwright + fixtures + helpers
scripts/agent_hooks/   Python safety + validation hooks (Claude) / shared discipline (Codex)
docs/           product vision, roadmap, architecture, design, agentic protocols
autodoc/        AGENT_INDEX.md code map
```

## Build / Test Commands

- `npm run dev` — Vite dev server (port 5180).
- `npm run build` — typecheck + production build.
- `npm run typecheck` / `npm run lint` — TS + ESLint.
- `npm run test` — Vitest unit suite. `npm run test:e2e` — Playwright (real Chromium).
- `npm run agent:check` — typecheck + lint + unit tests in one shot.
- `npm run agent:hooks:smoke` / `npm run agent:skills:validate` — validate agentic tooling before handoff.

## The Load-Bearing Render Order (never reorder)

```
read md → await getHighlighter() → createMarkdown(hl,settings).render() (Shiki+KaTeX, sync)
→ buildPaginationSource (TOC + footnote transform) → await renderAllMermaid
→ await awaitFontsAndImages → capture pristine clone → paginate() LAST
```
Pagination measures real heights; any earlier step changes them. Paginating early misplaces
page breaks and breaks the no-slice guarantee. This is the single most important invariant.

## Default Work Style

- Narrow diffs; preserve behavior unless asked.
- Local-first: no runtime network calls, no telemetry, no document persistence (only `Settings`).
- Don't mix render / pagination / export / UI concerns in one slice unless the seam requires it.
- Surface every failure; classify it (blocker / non-blocking risk / pre-existing noise / invalid signal).
- Record workarounds and their future-fix path.

## Git, Questions, Failures, Review

- Git: branch off `main`; `merge` not `rebase`; no force-push or history rewrite on protected
  branches; explain destructive ops first; no `Co-Authored-By` trailer. See `docs/agentic/GIT_WORKFLOW.md`.
- Questions: ask only true blockers, batched; otherwise proceed with a recorded assumption. See `docs/agentic/QUESTION_PROTOCOL.md`.
- Failures: never skip a finding as "non-blocking"; fix now or seed a tracked follow-up. See `docs/agentic/FAILURE_LEDGER.md`.
- Review/merge gates: correctness (no-slice holds), CI/tests green, manual browser check for
  UI/pagination/export, zero tech debt, docs sync. Detail in `CLAUDE.md` › Review & Merge Gates.

## Security / Privacy Guardrails

- Nothing leaves the device. No fetch/XHR/WebSocket at runtime; bundle Shiki themes/langs, KaTeX
  fonts, and Mermaid locally so the tool works offline.
- `markdown-it` runs with `html: true` (the user's own local files). If remote/pasted untrusted
  Markdown is ever accepted, sanitize (DOMPurify) before inserting into the DOM.
- Document content is never written to storage; only the small `Settings` object persists.
