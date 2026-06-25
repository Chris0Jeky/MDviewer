---
name: mdv-repo-map
description: Find the exact MDviewer code seam fast using AGENT_INDEX + the hot-spot list, and know what to ignore.
user-invocable: true
---

# mdv-repo-map

Use this when you know roughly what to change but not exactly which file/function.
The goal is to land on the one seam, confirm its signature, and skip the rest.

## Procedure

1. Open `autodoc/AGENT_INDEX.md` and `docs/design/IMPLEMENTATION_SPEC.md` section 7
   (pinned signatures) and section 6 (file tree).
2. Match your task to a hot spot below.
3. Read only that file plus its direct collaborators. Confirm the pinned signature
   before editing — cross-module imports depend on exact names/params/returns.

## Hot spots (task → seam)

- Markdown/plugins (callouts, TOC, footnotes section, anchors, task lists):
  `src/render/markdown.ts`, `src/render/math.ts`.
- Syntax highlighting / themes: `src/render/highlight.ts` (`getHighlighter` singleton,
  `CODE_THEME_PAIRS`, `ensureLang`).
- Mermaid diagrams: `src/render/mermaid.ts` (`renderAllMermaid`, `useMaxWidth:false`).
- TOC inject / footnote-to-inline transform / font+image await:
  `src/render/buildSource.ts`.
- Pagination engine, teardown, fresh Previewer per run: `src/paginate/paginate.ts`.
- Break/@page CSS string: `src/paginate/cssBuilder.ts` + `src/styles/print.css`.
- Page-area math: `src/paginate/measure.ts` (`MM`, `IN`, `SHRINK_LIMIT`).
- Tier-3 shrink, TOC page numbers, handler lifecycle: `src/paginate/shrinkToFit.ts`,
  `src/paginate/handler.ts`.
- Export (print + raster fallback): `src/export/print.ts`, `src/export/download.ts`.
- Toolbar/canvas/empty/banner: `src/ui/*`, `src/styles/app.css`, `preview.css`.
- Settings/state/DOM names: `src/app/settings.ts`, `state.ts`, `dom.ts`.

## What to ignore

`node_modules`, build output, `*.d.ts` shims (unless types are the task), and CSS that
is not in the paged stylesheet path (`app.css`/`preview.css` are screen-only).

## Verify

You found the seam when you can name the file, the exported signature, and the test
file that exercises it (`tests/<name>.test.ts` or an `tests/e2e/*.spec.ts`).
