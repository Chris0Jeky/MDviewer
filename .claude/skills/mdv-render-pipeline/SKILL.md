---
name: mdv-render-pipeline
description: Work on markdown-it / Shiki / KaTeX / Mermaid / callouts / TOC / footnotes while respecting the load-bearing render order.
user-invocable: true
---

# mdv-render-pipeline

Use this for any change under `src/render/*` — markdown plugins, syntax highlighting,
math, diagrams, callouts, TOC injection, footnote transforms, or font/image awaiting.

## The render order is load-bearing (spec section 3 — NEVER reorder)

```
0 read raw markdown
1 await getHighlighter()                       // singleton, once
2 createMarkdown(hl, settings).render(src)      // SYNC: Shiki (fromHighlighter) + KaTeX
3 buildPaginationSource(html, settings)         // inject TOC; footnotes -> inline floats
4 await renderAllMermaid(source, theme)         // async SVG, useMaxWidth:false
5 await awaitFontsAndImages(source)             // document.fonts.ready + img.decode
6 capture pristine clone
7 paginate(...)                                 // LAST, exactly once
```

Anything that changes laid-out height MUST happen before step 7, or breaks land in the
wrong place and the no-slice guarantee fails.

## Key files

- `src/render/markdown.ts` — `createMarkdown`, `renderMarkdown`, `SLUGIFY`,
  `RenderWarning`. Plugin order: `attrs` + `anchor` BEFORE `toc-done-right`; share one
  `SLUGIFY` so TOC links match heading ids exactly.
- `src/render/math.ts` — KaTeX wiring; `throwOnError:false` (bad TeX renders red inline,
  never aborts the doc). `import "katex/dist/katex.min.css"` is mandatory.
- `src/render/highlight.ts` — Shiki 4.x fine-grained core; `getHighlighter()` singleton;
  `CODE_THEME_PAIRS`; `ensureLang`. `defaultColor: "light"` so the vector PDF is correct.
- `src/render/mermaid.ts` — `renderAllMermaid(root, theme)`; fixed-size SVG; failure →
  placeholder figure, never a throw.
- `src/render/buildSource.ts` — `buildPaginationSource`, `transformFootnotesToInline`,
  `injectToc`, `awaitFontsAndImages`.

## Gotchas

- Shiki is 4.x (fine-grained core API, unchanged from 3.x). All `@shikijs/*` packages are
  version-pinned in lockstep — bump them together or the type graph splits.
- Unknown code language → fall back to `text`, never throw.
- Use `CLASSES`/`ATTRS` from `src/app/dom.ts`; surface failures as `RenderWarning`.

## Verify

`npm run test` (markdown/highlight/math/mermaid/buildSource specs) plus a sample doc
that exercises code + KaTeX + Mermaid + callouts + footnotes. Layout effects must also
pass `tests/e2e/nocutoff.spec.ts`.
