# Agent Operating Contract — MDviewer

Repo-wide operating rules for any coding agent (Claude Code via `CLAUDE.md`, Codex, or
other). Each runtime uses its native tools; the intent here is shared. See
`docs/agentic/TOOLING_PARITY.md`.

## What this project is

A local Markdown reader and editor for the web and an experimental Windows desktop app,
with a paginated **Markdown → PDF** workspace for research and code-heavy documents.
The Windows reader loads editing and pagination on demand. The defining export contract
keeps code blocks, figures, tables and callouts whole when they fit on a page; oversized
content uses the canonical shrink/split tiers. Vanilla TypeScript + Vite, with a bounded
Tauri/Rust host on Windows. Canonical build contract: `docs/design/IMPLEMENTATION_SPEC.md`.

## Authority Order

1. User prompt for the current turn.
2. `AGENTS.md` (this file) — repo-wide rules.
3. `ORCHESTRATOR.md` — resumable live state, queue, evidence, and next work.
4. `docs/Project_Roadmap.md` — phase status, priorities, gates.
5. `docs/design/IMPLEMENTATION_SPEC.md` — pinned signatures, render order, CSS names.
6. `autodoc/AGENT_INDEX.md` — code-seam map.
7. The relevant skill (`.claude/skills/*/SKILL.md` describes the workflow intent).

When sources conflict, follow the higher source and report the conflict.

## First 5 Minutes

`ACTION_ITEMS.md` → `AGENTS.md` → `ORCHESTRATOR.md` → `docs/Project_Roadmap.md` →
`docs/design/IMPLEMENTATION_SPEC.md` → `autodoc/AGENT_INDEX.md`. Then pick the smallest
safe, reviewable slice and state blockers, assumptions, verification target, and docs-sync
target before editing.

The issue-backed queue is [Future work](docs/FUTURE_WORK.md) and
[#195](https://github.com/Chris0Jeky/MDviewer/issues/195). Native Save/Save As
[#196](https://github.com/Chris0Jeky/MDviewer/issues/196) is implemented on Windows (companion
push S1b) on the conflict-safe replace primitive; optional recovery
[#197](https://github.com/Chris0Jeky/MDviewer/issues/197) is still design-only and sessions stay
memory-only. The web/PWA keeps its source download.

## Project Structure

```
src/app/        controller, state, settings, dom constants, input, sample doc
src/desktop/    continuous reader, in-memory session, lazy workspace and native adapter
src-tauri/      bounded native file/link/save capabilities and Windows packaging
src/render/     markdown-it + Shiki + KaTeX + Mermaid + source builder
src/paginate/   Paged.js engine wiring, @page/break CSS builder, shrink-to-fit, handlers
src/export/     window.print path + programmatic html2canvas/jsPDF path
src/ui/         toolbar, source editor, splitter, canvas, empty state, banner
src/styles/     app / editor / preview / document / print / shiki CSS
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
read md + capture settings → await getHighlighter() → createMarkdown(null,settings) + parse
→ await ensureLang for parsedFenceLanguages(md,tokens)
→ installMarkdownHighlighter → renderMarkdownTokens(md,tokens,env) (Shiki+KaTeX, sync)
→ buildPaginationSource (TOC + footnote transform) → await renderAllMermaid
→ await awaitFontsAndImages → fresh prepared source for this run → paginate() LAST
```
Pagination measures real heights; any earlier step changes them. Paginating early misplaces
page breaks and breaks the no-slice guarantee. This is the single most important invariant.

## Default Work Style

- Narrow diffs; preserve behavior unless asked.
- Local-first: no document network calls or automatic/app-managed document or session persistence.
  Explicit user-selected Markdown copies and PDF saves/exports are supported. Persisted app-managed
  user state is limited to `Settings` and the approved SDK keys below. The content-free Pulseboard SDK is reached
  only through `src/app/pulse.ts` (closed enums, size buckets, counts; never document content or names;
  `tests/pulse.test.ts`). No other telemetry.
- Don't mix render / pagination / export / UI concerns in one slice unless the seam requires it.
- Surface every failure; classify it (blocker / non-blocking risk / pre-existing noise / invalid signal).
- Record workarounds and their future-fix path.

## Git, Questions, Failures, Review

- Git: branch off `main`; `merge` not `rebase`; no force-push or history rewrite on protected
  branches; explain destructive ops first; no `Co-Authored-By` trailer. See `docs/agentic/GIT_WORKFLOW.md`.
- Publication is standing-authorized: keep commits small and logical, push scoped branches, and open
  draft PRs after relevant local checks. A PR is aged once an independent adversarial review has
  examined its latest head, exact-head CI has completed green, every comment is triaged, and the
  head has aged at least three minutes (global law 2f). The repository is T2 with push and merge free
  (`.agent-harness/tier.json`, owner decision 2026-10-15); merging is not deploying (AI-9). Actionable findings require finding → commit
  evidence, while informational/bot notices require an explicit non-finding triage. Any head change
  resets review and CI evidence. Preserve commits with a merge commit—never squash-merge.
- Questions: ask only true blockers, batched; otherwise proceed with a recorded assumption. See `docs/agentic/QUESTION_PROTOCOL.md`.
- Failures: never skip a finding as "non-blocking"; fix now or seed a tracked follow-up. See `docs/agentic/FAILURE_LEDGER.md`.
- Review/merge gates: correctness (no-slice holds), CI/tests green, manual browser check for
  UI/pagination/export, zero tech debt, docs sync. Detail in `CLAUDE.md` › Review & Merge Gates.

## Security / Privacy Guardrails

- Document content never leaves the device. Open documents and latest-close recovery stay in
  memory; there is no automatic/app-managed document or session storage. Explicit user-selected
  Markdown copies and PDF saves/exports write the requested output. On Windows, Save (Ctrl+S) writes the open document back to its own file in place and Save As (Ctrl+Shift+S) writes it to a file the user chooses and binds it there (docs/design/FILE_LIFECYCLE.md, #196); Save Markdown stays the explicit copy and does not adopt a binding or clear the dirty baseline. Only the small `Settings` object and
  SDK keys below persist as app-managed user state. The Windows app also keeps `library.json` in its local data folder: recent files, pinned files and project folders, and last-looked-at stamps — absolute paths and timestamps only, never content, capped (500 recents, 64 pins), cleared by Clear library. Bundle Shiki themes/langs, KaTeX fonts, and
  Mermaid locally so the tool works offline.
- The one runtime-network exception is the owner-approved Pulseboard SDK
  (`public/pulseboard.js`, called only through `src/app/pulse.ts`): closed enums, size
  buckets, and page counts to the Pulseboard collector — never document text, file names,
  titles, headings, document URLs, or export contents (`tests/pulse.test.ts` proves it).
  It stores only its own `pulseboard:*` consent/visit/region/session keys. No other
  fetch/XHR/WebSocket at runtime, and no other telemetry.
- `markdown-it` runs with `html: true`, so every rendered fragment is sanitized with DOMPurify
  before DOM insertion. Automatic remote-resource references are stripped; only embedded raster
  image data URLs are allowed. Mermaid SVG output is sanitized again after rendering.
