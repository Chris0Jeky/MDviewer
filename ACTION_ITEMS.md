# Action Items — Human-Only Tasks

> **Purpose.** This file tracks tasks only the human (the maintainer) can do — manual browser
> testing, environment setup that needs real binaries, and product/licensing decisions — plus a
> verified current-state snapshot for session continuity. Some gates (notably manual Chrome
> verification of the no-slice guarantee) cannot be cleared from an agent sandbox.
>
> **Rules for agents.**
> 1. **Read this file at session start.**
> 2. **Flag every OPEN item** near the top of any summary, status report, or handoff.
> 3. **Clear an item only on explicit human confirmation** (e.g. "AI-1 is done"). Move it to the
>    Completed log with the date and a one-line result. Never self-clear or assume completion.
> 4. **Keep the Current State snapshot accurate** when verified truth changes.

---

## Current State (snapshot)

- **2026-06-25** — Repo scaffolded and the app **verified working end-to-end in headless Chromium**.
  - **P0 Scaffolding `DONE`**: build/test config, agentic tooling (`bypassPermissions` + 4 safety
    hooks), pinned design specs (`docs/design/IMPLEMENTATION_SPEC.md`, `LIBRARY_NOTES.md`), seams.
  - **P1 Core pipeline `FUNCTIONAL`**: render → paginate → export all wired; the app boots, ingests a
    `.md`, and paginates (sample → 7 pages). Verify gates all green: `npm run typecheck` ✓ ·
    `lint` ✓ (0 warnings) · `test` ✓ (157 unit) · `test:e2e` ✓ (**15/15**, incl. both crown-jewel
    no-cutoff tests) · `build` ✓.
  - Fixes made during bring-up: a double-build DOM collision (App **and** `mountCanvas` each created
    `#paged-output`, so pages rendered off-screen); `SLUGIFY` now emits query-safe ids so numbered
    headings (`## 1. Foo`) don't crash Paged.js `target-counter`; e2e helpers use the file-input path.
- **Still needs a human:** a real-Chrome **visual** check of the exported PDFs (AI-1). The automated
  no-cutoff test proves the geometry, but a human eyeball on actual Save-as-PDF output is the final
  Gate-3 sign-off.

---

## OPEN items

### AI-1 — Manually verify the golden path in real Chrome (Gate 3) — OPEN (2026-06-25)

Verify the core product promise in an actual browser; it cannot be proven in the agent sandbox.

1. Run `npm install` then `npm run dev`; open the printed localhost URL in **Chrome**.
2. Drag a `.md` file onto the window (use a code-heavy doc with math, a Mermaid diagram, callouts,
   footnotes, and at least one code block tall enough to approach a full page). The bundled sample
   doc is a good start.
3. Confirm the preview renders: highlighted code, KaTeX math, a Mermaid diagram, callout boxes,
   footnotes at the page bottom, and an auto TOC with page numbers.
4. **Primary export:** click Print / Save as PDF, choose "Save as PDF" in the dialog, save the file.
5. **Fallback export:** click Download PDF; save the file.
6. **The critical check:** open both PDFs and confirm **no code block, figure, table, or callout is
   sliced across a page boundary**. Tables that must continue should repeat their header.
7. Spot-check edge cases: empty state (no doc), a very large doc, and rapid setting changes (paper
   size, margins, font, toggles) — the preview should re-paginate without corruption.

Report: pass/fail per export path, and any block that got sliced (with the doc that triggered it).

### AI-3 — Decide license and author for `package.json` — OPEN (2026-06-25)

`package.json` and `README.md` currently carry an **MIT placeholder**. Confirm the intended license
and author/copyright holder, then update `package.json` (`license`, `author`) and the README License
section. If a different license is chosen, add the appropriate `LICENSE` file.

---

## Completed log

- **AI-2 — Install Playwright browsers + run the E2E suite** — DONE 2026-06-25. Ran
  `npx playwright install chromium` + `npm run test:e2e` → **15/15 passing**, including
  `e2e/nocutoff.spec.ts` (no atomic block straddles a page boundary).

---

## Known dev follow-ups (agent-doable, tracked in the roadmap)

- **Bundle size:** the initial chunk is ~1.9 MB (KaTeX + markdown-it + Paged.js + Shiki core). It
  builds and runs fine for a local-first tool, but `paginate.ts`/`download.ts` could lazy-load
  Paged.js and the PDF libs to shrink first paint. See `docs/Project_Roadmap.md` P3.
