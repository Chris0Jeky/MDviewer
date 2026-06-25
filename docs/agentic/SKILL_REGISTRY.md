# MDviewer — Skill Registry

> The catalog of `mdv-*` workflow skills and when each fires. Claude reads the full procedure from
> `.claude/skills/<name>/SKILL.md`; Codex follows the same intent via `AGENTS.md` (each runtime uses
> its native tools and guardrails). Keep workflow intent aligned across both runtimes.

## Skills

| Skill | Trigger — use when… |
| --- | --- |
| `mdv-repo-onramp` | Orienting at session start, or scope is broad/ambiguous and you need to find your footing in the repo. |
| `mdv-repo-map` | You need the exact code seam (file + invariant + verification) before editing. |
| `mdv-safe-slice` | Turning a request into one small, reviewable change without drifting across unrelated layers. |
| `mdv-render-pipeline` | Working on markdown-it, Shiki, KaTeX, Mermaid, or the pagination-source builder (steps 1–5 of the render order). |
| `mdv-pagination` | Touching Paged.js wiring, the `@page`/break stylesheet, page-area math, shrink-to-fit, or lifecycle handlers. |
| `mdv-export` | Working on the print (vector) or download (rasterized) export path, or the dark-on-white print guarantee. |
| `mdv-ui-ux` | Toolbar, canvas/preview, empty state, banners, risk/error copy, or accessibility work. |
| `mdv-test-harness` | Choosing or adding unit (Vitest/jsdom) vs E2E (Playwright/Chromium) coverage — including the no-cutoff test. |
| `mdv-question-batch` | Deciding whether to ask the user or proceed with a stated assumption (minimize context churn). |
| `mdv-failure-capture` | Classifying and recording a tool/test/dependency/browser/workaround failure so nothing fails silently. |
| `mdv-verify-handoff` | Closing a task: verify the changed seam, state residual risk, sync docs only if truth changed. |
| `mdv-roadmap-sync` | Updating `docs/Project_Roadmap.md` (or status docs) when implementation changes their truth. |
| `mdv-interface-map` | Updating `autodoc/AGENT_INDEX.md` or domain interface maps after public seams change. |
| `mdv-claude-tooling` | Claude-specific tool selection and safety decisions for an MDviewer task. |

## Maintenance rule

When a skill's behavior changes, update **all three together in the same change**:

1. The skill itself — `.claude/skills/<name>/SKILL.md` (and the matching intent in `AGENTS.md`).
2. The routing list in [`../../CLAUDE.md`](../../CLAUDE.md).
3. This registry.

Drift between these three is a defect. Adding a skill means adding a row here, a routing entry in
`CLAUDE.md`, and the `SKILL.md` file (plus its Codex-side counterpart).
