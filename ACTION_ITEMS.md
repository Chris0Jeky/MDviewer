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

- **2026-07-24 (product hardening + packaging)** — Security-sensitive Markdown and Mermaid output is
  sanitized; dependency audit is clean; Paged.js and curated Shiki grammars load on demand; a tested
  production server, one-command/one-click local launch, and deployment guide are present on branch
  `feat/product-hardening-deployment`. Automated verification includes 170 unit tests, 3 server tests,
  and 18 browser tests against both Vite dev and the production bundle on isolated ports. The
  no-slice test now tracks stable source-block identities across Paged.js fragments rather than
  trusting already-split output geometry alone.

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

---

### AI-4 — Choose and authorize the permanent remote-access path — OPEN (2026-07-24)

The code and instructions support all options, but an agent cannot create or link hosting/network
accounts without the maintainer choosing the audience and authorizing the external change.

1. Choose **Cloudflare Pages** for a permanent public URL (recommended default), **Tailscale Serve**
   for private access through this PC, or **Cloudflare Tunnel + Access** for a stable authenticated
   URL hosted by this PC.
2. Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), or ask an agent to walk through the chosen setup.
3. For Cloudflare Pages, decide whether to use the free `pages.dev` address or a custom domain.
4. After deployment, report the URL and desired visibility so it can be recorded and smoke-tested.

---

## Completed log

- **AI-3 — Decide license and author** — DONE 2026-06-25. User confirmed: **keep the MIT placeholder.**
  `package.json` + `README.md` already carry MIT; the author/copyright holder is intentionally left as
  a placeholder for now. No change required. (Revisit author/`LICENSE` file only before a public release.)

- **AI-2 — Install Playwright browsers + run the E2E suite** — DONE 2026-06-25. Ran
  `npx playwright install chromium` + `npm run test:e2e` → **15/15 passing**, including
  `e2e/nocutoff.spec.ts` (no atomic block straddles a page boundary).

---

## Known dev follow-ups (agent-doable, tracked in the roadmap)

- **Bundle size:** Paged.js and curated extra Shiki grammars now load on demand, reducing the entry
  chunk from ~1.97 MB to ~1.46 MB. Further main-thread and Mermaid/Shiki splitting remains possible.
