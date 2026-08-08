# Action Items — Human-Only Tasks

> **Purpose.** This file tracks tasks only the human (the maintainer) can do — manual browser
> testing, environment setup that needs real binaries, and product/licensing decisions — plus a
> verified current-state snapshot for session continuity.
>
> **Rules for agents.**
> 1. **Read this file at session start.**
> 2. **Flag every OPEN item** near the top of any summary, status report, or handoff.
> 3. **Clear an item only on explicit human confirmation** (e.g. "AI-1 is done"). Move it to the
>    Completed log with the date and a one-line result. Never self-clear or assume completion.
> 4. **Keep the Current State snapshot accurate** when verified truth changes.

---

## Current State (snapshot)

- **2026-08-08 (split-view editor)** — The Markdown source editor landed on `main` through PR #36
  (merge commit `87249e0`), with `main` CI green afterwards. MDviewer is no longer view-only: you
  write Markdown in the app and the paginated preview rebuilds as you type, across three view modes
  (**Markdown** / **Split**, the default / **Preview**).
  - The PR shipped with a full review round — **all 11 Codex findings addressed**, ten with code
    changes and one already fixed beforehand. Two of them changed a contract rather than a line, and
    both are now recorded in `IMPLEMENTATION_SPEC.md` §7/§12 and `AGENT_INDEX.md`:
    - **`#canvas` is the one pane never hidden with `display: none`.** Markdown mode hides the
      preview but keeps paginating into it, and Paged.js measures real heights — zero under a
      `display: none` ancestor. It is parked (`position: absolute; visibility: hidden`) and
      un-parked again under `@media print`.
    - **Renders are serialized, not just debounced.** Two overlapping `runPipeline` calls would
      share one Paged.js host and page counter. Both exports now `await App.flushRender()` so an
      export fired mid-debounce cannot ship the previous document's pages.
  - Automated verification at the merged head: 252 unit tests, 4 server tests, **36 Chromium E2E**
    tests including both no-cutoff tests — the core guarantee re-proved, not assumed, since the
    canvas-parking change touches exactly what Paged.js measures against.
  - **Not automated:** how typing *feels* (**AI-6** steps 1–11), and non-Chromium behaviour of
    `scrollbar-gutter: stable` and `execCommand("insertText")` — the whole suite is Chromium-only,
    so that gap is closed **only** by AI-6 step 12, the second-engine pass. Completing steps 1–11
    in Chrome leaves it untested.

- **2026-07-24 (public launch)** — Product hardening and packaging merged through PR #28; the durable
  deployment record then merged through PR #29 as repository `main` `43af438`, with its exact main CI
  run green. MDviewer remains live at **https://mdviewer-c9r.pages.dev/** on Cloudflare Pages from the
  deployed application merge commit `7f4eedf`.
  The stable URL, immutable deployment URL, entry HTML, and hashed JavaScript asset returned HTTP 200;
  the asset has immutable caching and the configured security headers are active. Automated
  verification includes 175 unit tests, 4 server tests, and 19 browser tests against both Vite dev
  and the production bundle. Installed-Chrome inspection verified both 7-page PDF paths.

- **2026-06-25 (session 2)** — Dependency-currency + CI foundation landed. **11 PRs merged**, `main` green.
  - **Deps fully current, 0 vulnerabilities:** jspdf 2→4 (security advisories), vite 6→8, vitest 2→4,
    TypeScript 5.9→6.0, ESLint 9→10, Shiki 3→4 (all 6 pkgs in lockstep), katex 0.16→0.17, mermaid
    11.0→11.16, GitHub Actions majors. Every open Dependabot PR (#1, #4–#12) resolved.
  - **First CI** (`.github/workflows/ci.yml`): typecheck/lint/unit/build on a Node 20+22 matrix +
    Playwright Chromium e2e, run against the **production bundle** (`vite preview`). Plus
    `.github/dependabot.yml`.
  - **Test honesty:** the settings e2e was silently no-op'ing; now drives real re-pagination via a new
    typed `window.__mdviewer` hook (`main.ts` / `src/types/window.d.ts`).
  - Docs synced to the new versions. Full session log + resumable state in [`ORCHESTRATOR.md`](./ORCHESTRATOR.md).
  - Live demo (production bundle): sample → 7 pages; no-slice geometry check = **0 of 12 atomic blocks
    straddling a page boundary**.
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
---

## OPEN items

- **AI-6 — Accept the split workspace in a real browser (manual UI gate).** The split editor is
  merged to `main` (PR #36, `87249e0`) with 36/36 Chromium E2E tests green, including layer
  alignment, live typing → pagination, divider drag, and print-media checks. Automated coverage
  cannot judge how the *typing* feels, and only you can close this item.

  **Steps** (the app is served at http://localhost:5180 via `npm run dev`):
  1. The app opens in **Split** mode: the source pane on the left, the preview on the right.
  2. Type `# Hello` then a paragraph, a `:::note` callout, and a fenced ```ts code block.
     **Type continuously, without pausing, and watch the source pane itself** — every character
     must appear the instant you press it, and deleted characters must vanish at once. (The
     colours are allowed to lag by a fraction of a second and settle when you stop; the *text*
     is not.) The caret must sit exactly on its character throughout. The preview should
     repaginate about a quarter-second after you stop.
  3. Drop one of your own `.md` files. Its source should appear on the left, editable. Change
     a heading and confirm the preview follows without the document reopening.
  4. Paste in something long enough to make the source pane scroll. Scroll it, and confirm the
     colours stay locked to the characters — no vertical drift, no sideways drift at the line
     wraps.
  5. Click **Markdown**, **Preview**, **Split** in the View group. Each shows exactly the panes
     it names; nothing is lost switching between them.
  6. Drag the divider, then reload — the size should persist. Tab to it and press ←/→. Also:
     start a drag and release the mouse **outside the browser window** — the divider must stop
     dragging, and the page must remain fully interactive.
  7. Press **Print / Save as PDF** and confirm the PDF contains only the page sheets — no
     source pane, no toolbar, no divider — and still no sliced code block.
  8. **Type an edit, then export immediately, without pausing.** The PDF must contain that edit.
     Do this **twice — once with Print / Save as PDF and once with Download PDF** — because the
     fix covers both export paths but only the Print path has an automated immediate-edit test.
     Then repeat from an empty app (type a heading, export at once) — it must not be blank.
  9. **Switch to Markdown mode and press Print / Save as PDF from there.** The PDF must still
     contain the page sheets — not a blank document.
  10. Press Tab in the source pane, then Ctrl+Z. The undo should step back sensibly rather than
      wiping out more than the tab.
  11. Try the **dark** preview theme and confirm the source pane's colours follow.
  12. **Repeat steps 2, 4 and 10 in a non-Chromium browser — Firefox or Safari.** Steps 1–11 in
      Chrome do *not* close the compatibility gap: the whole automated suite is Chromium-only, and
      two of the fixes lean on engine-variable APIs — `scrollbar-gutter: stable` on the
      `overflow: hidden` backdrop (step 4) and `execCommand("insertText")`, which is deprecated and
      has a weaker fallback path (step 10). If a second engine is not available to you, say so when
      you close this item and it will be recorded as still untested rather than silently assumed.

  Steps 2, 4, 6 (the release-outside-the-window case), 8, 9 and 10 are the ones the PR #36 review
  round fixed; they are the highest-value checks here because each covers a defect that shipped
  once already. Step 12 is the only one that touches the non-Chromium gap.

  Reply "AI-6 is done" (or report what looked wrong) and it moves to the Completed log.

## Completed log

- **AI-5 — Enable mechanical merge protection for `main`** — DONE 2026-07-24. User confirmed the
  relaxed solo-owner profile: PR + exact named checks + conversation resolution, zero required
  approvals, admin emergency bypass, force-push/deletion blocked, merge commits on, squash off.

- **AI-4 — Choose and authorize the permanent remote-access path** — DONE 2026-07-24. User selected
  Cloudflare Pages. Production deployment `e3bd9770` from merge commit `7f4eedf` is live at
  **https://mdviewer-c9r.pages.dev/** and passed HTTP/header/asset smoke checks.

- **AI-1 — Manually verify the golden path in real Chrome (Gate 3)** — DONE 2026-07-24. User accepted
  the agent-run installed-Chrome inspection: vector and fallback exports each produced 7 A4 pages;
  all 14 rendered pages were visually checked with no sliced normal atomic blocks.

- **AI-3 — Decide license and author** — DONE 2026-06-25. User confirmed: **keep the MIT placeholder.**
  `package.json` + `README.md` already carry MIT; the author/copyright holder is intentionally left as
  a placeholder for now. No change required. (Revisit author/`LICENSE` file only before a public release.)

- **AI-2 — Install Playwright browsers + run the E2E suite** — DONE 2026-06-25. Ran
  `npx playwright install chromium` + `npm run test:e2e` → **15/15 passing**, including
  `e2e/nocutoff.spec.ts` (no atomic block straddles a page boundary).

---

## Known dev follow-ups (agent-doable, tracked in the roadmap)

- **Bundle size:** Paged.js and curated extra Shiki grammars load on demand. Measured at `main`
  `87249e0`, the entry chunk is **1,603.59 kB** (512.43 kB gzipped) — the "~1.46 MB" figure carried
  here previously was stale. Further main-thread and Mermaid/Shiki splitting remains possible.
