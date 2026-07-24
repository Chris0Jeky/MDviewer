# MDviewer — Orchestrator State

> Single source of truth for the autonomous engineering loop. Resumable: a fresh session can
> read this file alone and continue. Keep entries terse and factual. Update at every checkpoint.

> **▶ CURRENT CHECKPOINT — 2026-07-24:** Draft PR **#28** remains open on
> `feat/product-hardening-deployment`. Installed-Chrome PDF inspection found and fixed a primary
> print regression; an additional independent adversarial review found atomic-coverage, Windows
> launcher, and policy-definition gaps, all now fixed in small commits. Relaxed solo-owner branch
> protection is active. Re-run exact-head local/hosted gates and independent review after this docs
> checkpoint before changing PR readiness. No external deployment was authorized. OPEN human items:
> **AI-1** (accept agent PDF evidence or repeat native-dialog check), **AI-4** (choose/authorize the
> permanent hosting path), and **AI-5** (confirm the applied relaxed protection profile).

## Run header

- **Start commit:** `fe085b0` (Initial scaffold) on `main`, tracking `origin/main`.
- **Goal:** Drive real, shippable improvements end-to-end (discover → plan → implement → review → verify → merge), keeping a durable resumable record.
- **Current cycle:** 2 — **LOCAL ENGINEERING COMPLETE** on isolated worktree; primary checkout remains untouched.
- **Last updated:** 2026-07-24
- **Cycle-2 base:** exact `origin/main` `a0647549be99f8053732150d7ef1ff9c5e9c65c6`.
- **Live GitHub queue (2026-07-24):** Dependabot PRs #22–#27 are OPEN, CLEAN, and have all checks
  green. They were inspected but not merged or folded into this product branch; handle each as its
  own reviewable dependency slice after this branch lands.
- **Local main HEAD:** `68bf164` (after T-10 merge) → updated to the T-14 housekeeping merge on wrap, tracking `origin/main`.
- **PRs merged this session:** 11 (T-1 jspdf+vite+vitest security; T-2 CI; T-5 dependabot cfg; T-6 prod-build e2e; T-7 action majors; T-8 katex/mermaid; T-9b TS6; T-9a shiki4; T-9c eslint10; T-12 docs version-sync; T-10 window.__mdviewer hook + honest settings test). All Dependabot PRs #1,#4-#12 merged or superseded+closed.
- **Final main verification (2ebc8b7):** typecheck ✓ · lint ✓ (eslint 10) · 157 unit ✓ · build ✓ · e2e 15/15 on production bundle ✓ · agent:hooks:smoke ✓ · agent:skills:validate ✓ (14 skills). 0 npm vulnerabilities.

## Environment / verification commands

- Stack: Vanilla TypeScript + Vite 8, Vitest 4, Playwright (Chromium), ESLint 10. Node v24.13.1, npm 11.8.0.
- Package manager: npm. Default branch: `main` (protected: no force-push/rebase/amend/reset per CLAUDE.md).
- VCS host: GitHub (`Chris0Jeky/MDviewer`), `gh` CLI authed as Chris0Jeky.
- Verification commands (the merge gate):
  - `npm run typecheck` — tsc --noEmit
  - `npm run lint` — eslint src tests
  - `npm run test` — vitest run (unit, jsdom)
  - `npm run test:e2e` — playwright (real Chromium) — **required for render/pagination/export/UI**
  - `npm run build` — tsc + vite build
  - `npm run agent:check` — typecheck + lint + unit in one shot
  - `npm run agent:hooks:smoke` / `npm run agent:skills:validate` — agentic tooling, before handoff
- `.github/workflows/ci.yml` runs verification on Node 20/22 plus production-bundle Chromium E2E.

## Baseline (cycle 1 start, commit fe085b0)

- `npm run typecheck` ✓
- `npm run lint` ✓ (0 warnings)
- `npm run test` ✓ (157 unit tests, 11 files)
- `npm run build` ✓ (known 1.9 MB initial chunk warning — tracked, P3)
- `npm run test:e2e` — not yet re-run this session (ACTION_ITEMS records 15/15 from 2026-06-25 bring-up)

## OPEN human action items (from ACTION_ITEMS.md — always surface these)

- **AI-1** — Accept the agent-run installed-Chrome PDF inspection or repeat native-dialog check. OPEN.
- **AI-4** — Choose and authorize the permanent remote-access path. OPEN.
- **AI-5** — Confirm the applied relaxed solo-owner `main` protection profile. OPEN.

## Task board

| id | title | status | prio | deps | branch/PR | review | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-1 | Evaluate & land Dependabot PR #1 (jspdf 2→4 security + vite 6→8, vitest 2→4) | **MERGED** | P2 (security) | — | PR #1 → `8839177` | 2 adversarial lenses, all gates green incl. prod-build e2e | Security bump landed; jspdf advisories closed; deps current. 0 vulns. |
| T-2 | Add GitHub Actions CI (typecheck/lint/unit/build + e2e on Chromium) | **MERGED** | P1 (unblock) | — | PR #2 → `cf5042c` | 2 adversarial reviews resolved | CI green on its own PR (verify Node 20+22, E2E Chromium incl. no-slice). Gate now enforceable. |
| T-3 | Lazy-load Paged.js | **COMMITTED** | P3 performance | — | `27544c1` | unit + dev/preview E2E | Empty state no longer pays the Paged.js cost; pagination remains last |
| T-4 | Load curated Shiki languages on demand | **COMMITTED** | P3 performance | — | `8a494ee` | unit + real Chromium C# fixture | Pre-scan resolves curated grammar chunks before synchronous Markdown render |
| T-5 | Add `.github/dependabot.yml` (github-actions + npm auto-updates) | **MERGED** | P3 | — | PR #3 → `be68c1d` | self + 1 independent review; F-12 fixed | Config-valid (Dependabot check passed). Auto-patches deps+actions; closes F-11. |
| T-6 | CI e2e tests the production bundle (`vite preview`), not just dev server | **MERGED** | P2 (closes F-10) | — | PR #13 → `33ca290` | self + independent review; F-13 fixed | CI e2e now runs on the shipped rolldown bundle |
| T-7 | GitHub Actions majors consolidated (checkout 4→7, upload-artifact 4→7, setup-node 4→6, cache 4→6) | **MERGED** | P4 | — | PR #14 → `63dd258`; closed #4-#7 | CI ran the bumped actions green | consolidated 4 PRs into 1 |
| T-8 | Dependabot: npm production minor/patch group (#8: katex 0.16→0.17, mermaid 11.0→11.16) | **MERGED** | P4 | — | PR #8 → `9434106` | full local gates + PR CI; katex JS/CSS version-lock verified | minor/patch group; 15/15 e2e |
| T-9a | Consolidated shiki monorepo → ^4 (supersede #9 + #10) | **MERGED** | P3 | — | PR #16 → `b9a6378`; closed #9/#10 | full gates + independent review (SAFE) | all 6 shiki pkgs → 4.3; zero code change; clean dedupe |
| T-9b | typescript 5.9→6.0 (#12) | **MERGED** | P3 | — | PR #15 → `fb505aa`; closed #12 | local gates + CI (npm ci on linux validated) | proved own-branch approach; W-2 libc churn is benign |
| T-9c | eslint 9→10 (#11) + `@eslint/js`→^10 + lint-fix + engines floor | **MERGED** | P3 | — | PR #17 → `2ebc8b7`; closed #11 | full gates + CI Node 20+22 | lint clean (no new findings); engines tightened |
| T-10 | Expose `window.__mdviewer` hook + make the settings e2e honest | **MERGED** | P4 | — | PR #19 → `68bf164` | self + independent review (ship-able); nit applied | was false-confidence no-op test; now drives real re-pagination; +typed prod hook |
| T-13 | Fix misleading Canvas "Fit the page to the canvas" tooltip (Canvas.ts:26) — actual behavior is natural mm sizing (`transform: none`) | **COMMITTED** | P5 | — | `982c6c0` | unit + E2E | Control copy now describes natural-size rendering |
| T-14 | Wrap-up housekeeping: commit ORCHESTRATOR.md, record Q-answers, ACTION_ITEMS snapshot | IN-PROGRESS | P3 | — | branch `chore/session-wrap` | — | makes state durable + tracked for next session |
| T-11 | dead `ensureLang` loader | FOLDED → T-4 | P4 | — | — | F-18 | user chose build-out (Q-2): keep `ensureLang`, make it work as part of T-4 (don't delete). |
| T-12 | Docs version-sync after the major dep bumps | **MERGED** | P3 (docs gate) | T-1,T-8,T-9a/b/c | PR #18 → `82ac4bc` | skills validate + CI | spec/notes/roadmap/3 skills now match installed versions |
| T-15 | Sanitize untrusted Markdown and Mermaid output | **COMMITTED** | P1 security | — | `d2fc3c9`, `5be6243` | independent adversarial review; literal and obfuscated bypasses fixed | Local-first renderer no longer executes/auto-loads hostile HTML/SVG/resource URLs |
| T-16 | Resolve transitive npm advisories | **COMMITTED** | P1 security | — | `d54892c` | `npm audit` | 3 advisories → 0 |
| T-17 | Isolate E2E server ports | **COMMITTED** | P2 test honesty | — | `7fdd9cb` | dev + preview 18/18 | stale primary-checkout listener can no longer contaminate targeted runs |
| T-18 | Product packaging and deployment paths | **COMMITTED** | P2 distribution | T-3,T-4 | `0362a45` + follow-ups | full local gates + independent review | built-in server, one-command/click launcher, static-host headers, deployment runbook; external host awaits AI-4 |
| T-19 | Restore Mermaid rendering and sanitize real SVG safely | **COMMITTED** | P1 correctness/security | T-15 | `993e926`, `ff07d38` | independent finding + real Chromium | Mermaid bypasses Shiki, retains safe SVG styles/text, strips remote SVG/CSS resources, and stays print-light |
| T-20 | Close no-slice E2E identity gap | **COMMITTED** | P1 test honesty | — | `3a12930` | independent finding + production E2E | stable source atomic IDs detect short logical blocks cloned across pages; over-tall pre/table splits constrained |
| T-21 | Fix primary print pagination and inspect both PDFs | **COMMITTED** | P1 correctness | T-18 | `af006ff` | installed Chrome + rendered 14 PDF pages + regression E2E | primary vector export now prints all 7 sheets without a trailing blank; fallback remains 7 pages |
| T-22 | Close second adversarial-review findings | **COMMITTED** | P1/P2 | T-20,T-18 | `f072846`, `4e1e771`, `48196ba` | targeted unit/server/production E2E; final re-review pending | canonical atomic selector complete; Windows launcher returns to error handler; relaxed aging criterion operational |

### Completed cycle-2 product tasks

> T-3 and T-4 were user-approved in Q-2/Q-3 and completed in this cycle. Their original acceptance
> constraints are retained below as durable design context.

- **T-3 — Bundle lazy-load (DONE, P3).** Lazy-load Paged.js so the empty state paints without it.
  Files: `paginate.ts` (static `import { Previewer } from "pagedjs"` → dynamic `await import("pagedjs")`
  inside `paginate()`), and `handler.ts` (the `MDViewerHandler extends Handler` class must be defined
  AFTER a dynamic import of `Handler`/`registerHandlers`, so `registerHandlersOnce` becomes async) +
  its one call site in `App.ts`. PDF libs in `download.ts` are already dynamic-imported on user action.
  Preserve render order (paginate still runs last, once). Verify: full e2e incl. no-cutoff + measure the
  entry-chunk reduction in the build output.
- **T-4 — On-demand Shiki language loading (DONE, P3).** Build it properly (supersedes the
  remove-it option). Constraints from the F-18 analysis: (1) `ensureLang` must load via the per-lang
  subpath, but a fully-dynamic `import(\`@shikijs/langs/${lang}\`)` makes Vite glob-bundle ~200 lang
  chunks — pick a bundle strategy (e.g. a curated allow-list of extra langs, or accept lazy glob chunks
  knowingly and `log` the tradeoff). (2) The render is SYNC (`fromHighlighter`), so to load on demand
  you must PRE-SCAN the markdown for fenced-code languages and `await ensureLang` each BEFORE the sync
  render — a careful addition to the load-bearing render order in `App.ts` (do NOT paginate before langs
  settle). Also fix the matching broken recipe in `LIBRARY_NOTES.md:125` and add a real test that loads
  an unbundled-but-known language (folds in T-11; keep `ensureLang`, don't delete it).
### Remaining backlog

- Profile very large documents and set a render-time/main-thread budget.
- Evaluate additional Mermaid/Shiki code-splitting after real-user performance measurements.

## Deferred questions — ALL ANSWERED 2026-06-25

- **Q-1** (AI-3 license): **ANSWERED — keep the MIT placeholder.** No change (package.json/README already MIT; author intentionally left as placeholder). AI-3 closed in ACTION_ITEMS.
- **Q-2** (Shiki on-demand languages): **ANSWERED — build it out properly (T-4).** Don't remove `ensureLang`; implement real on-demand loading. See T-4 below for the design constraints.
- **Q-3** (bundle lazy-load): **ANSWERED — yes, do it (T-3).** Greenlit. See T-3 below.

## Findings ledger

- **F-1 (T-1):** vite 8 ships a new default bundler (rolldown); e2e only ran against dev server. Resolved — re-ran layout+export e2e against the production `vite preview` build (10/10 green). No regression.
- **F-2 (T-1):** jspdf v4 pulls deprecated transitive deps (core-js@2, @babel/polyfill) → npm deprecation warnings. Cosmetic, pre-existing to jspdf, not a regression. No action.
- **F-3 (T-2, review A+B):** No `timeout-minutes` on CI jobs → hung runs could burn to the 6h cap. **Fixed** (15/20).
- **F-4 (T-2, review A+B):** `cancel-in-progress` keyed on ref cancels post-merge main runs. **Fixed** — gated to `pull_request` only.
- **F-5 (T-2, review A+B):** Playwright browsers re-downloaded every run (CDN flakiness/cost). **Fixed** — cache `~/.cache/ms-playwright` by version.
- **F-6 (T-2, review B):** `checkout` persists token in git config downstream. **Fixed** — `persist-credentials: false`.
- **F-7 (T-2, review B):** Uncapped CI e2e parallelism → CPU contention flakes on height-measuring no-slice tests, masked by retries. **Fixed** — `workers: 2` in CI.
- **F-8 (T-2, review B):** Failure artifacts were trace-only (on retry). **Fixed** — added `screenshot: only-on-failure`.
- **F-9 (T-2, review B nit):** Only Node 22 exercised vs `engines >=20`. **Fixed** — verify job matrix `[20, 22]`.
- **F-10 (T-2, review A):** e2e runs vs `vite dev`, not the bundled output → bundle-only runtime regressions uncaught. **Deferred → T-6** (verify-job `build` still catches build-time breaks).
- **F-11 (T-2, review B):** Actions tag-pinned (not SHA). Accepted for first-party `actions/*`; **deferred mitigation → T-5** (Dependabot for github-actions). Closed by T-5.
- **F-12 (T-5, independent review):** `github-actions` Dependabot group bundled major bumps, contradicting the file's own "majors individual" policy. **Fixed** — added `update-types: [minor, patch]` + explicit PR limit to the actions group.
- **F-13 (T-6, independent review):** `vite.config.ts preview.port: 5181` is shadowed by the e2e `--port 5180` override → latent trap if the flag is ever dropped. **Fixed** — documented the override at the source (comment-only).
- **F-14 (T-6 review, pre-existing):** `window.__mdviewer` is referenced (optional-chained, with fallback) in `golden-path.spec.ts`/`export.spec.ts` but defined **nowhere** in `src/`. Not a regression (fallbacks make behavior identical), but it's either dead test code or a missing intended test instrumentation hook. **Seed → T-10** (investigate; low prio).
- **F-15 (T-9 analysis):** Dependabot PRs #9 (`@shikijs/transformers` 3→4) and #10 (`@shikijs/core` 3→4) CANNOT land alone — the shiki monorepo pins all `@shikijs/*` siblings to the EXACT same version; mixing v4 core/transformers with v3 `shiki`/`langs`/`themes`/`markdown-it` splits the type graph and nests a duplicate v3 copy. Must bump all six shiki packages to ^4 together. v4 removes only `createdBundledHighlighter` (typo variant) — not used here, so near-zero code change expected. **Plan:** supersede #9/#10 with one consolidated shiki-v4 PR (T-9a).
- **F-16 (T-9 analysis):** eslint 9→10 (#11) also needs `@eslint/js` bumped to ^10 (flat config consumes `eslint.configs.recommended` from it); eslint 10 adds 3 new recommended rules (`no-unassigned-vars`, `no-useless-assignment`, `preserve-caught-error`) that may fire on src/tests; eslint 10 needs Node ≥20.19/22.13/24 (tighten `engines`). typescript-eslint ^8.62 already supports eslint 10 (no v9 needed). **Plan:** T-9c, land separately with lint-fix.
- **F-17 (T-9 analysis):** typescript 5.9→6.0 (#12) is safe to land alone (typescript-eslint ^8.62 peer allows `<6.1.0`; tsconfig uses no TS-6-deprecated options). Gate on clean `tsc --noEmit` + build. **Plan:** T-9b. **Done.**
- **F-18 (T-9a, independent review — PRE-EXISTING, not from this bump):** `src/render/highlight.ts:~93-102` `ensureLang` does `langs = await import("@shikijs/langs"); loader = langs[lang]`, but the `@shikijs/langs` aggregate entry exports only metadata arrays (`languageNames`/`languageAliasNames`), never per-lang loaders → `langs[lang]` is always `undefined`, so on-demand language loading is a silent no-op. Harmless today (never called from app code — grammars are pre-loaded by 16 static `import("@shikijs/langs/<lang>")` + `fallbackLanguage:"text"`), but it means unbundled-but-known languages can't load on demand. **Seed → T-11** (overlaps T-4 graceful unknown-language fallback). Kept out of the shiki-v4 PR to keep it deps-only.

## Failures / workarounds ledger

- **W-1 (T-1 cleanup):** `git worktree remove` left files behind on Windows ("Filename too long" on deep node_modules paths). Worktree was unregistered from git (prune OK); leftover files are in the session scratchpad temp dir (auto-cleaned, outside repo). No repo impact.
- **W-2 (recurring hazard):** Running `npm install` locally (Windows, npm 11) rewrites `package-lock.json` to strip `libc: [glibc|musl]` fields from linux-only optional native deps (esbuild/rollup/rolldown). Those fields matter for `npm ci` on the Linux CI runner. **Never commit that churn** — after a local `npm install`, `git restore package-lock.json` (only safe on non-protected branches; hook blocks `restore` on main) unless the lockfile change is the intended task. Verify lockfile diffs are real dep changes, not platform churn, before staging.

## Checkpoint log

- **C0 (2026-06-25):** Discovery complete. Baseline green (typecheck/lint/unit/build). Found open Dependabot PR #1 (security-motivated jspdf bump grouped with major vite/vitest bumps). No CI exists. Selected T-1 first (security priority).
- **C1 (2026-06-25):** **T-1 MERGED** (PR #1 → `8839177`). Verified all gates on isolated worktree incl. production-build e2e (10/10) before merge; posted verification comment; merge-commit + branch delete; fast-forwarded local main; `npm install` synced lockfile (0 vulns); post-merge typecheck + 157 unit tests green. Next: T-2 (CI).
- **C2 (2026-06-25):** **T-2 MERGED** (PR #2 → `cf5042c`). First CI workflow + e2e-config hardening. Two adversarial reviews (correctness + robustness/supply-chain); 7 findings fixed inline (F-3..F-9), 2 deferred to tracked tasks (F-10→T-6, F-11→T-5). CI verified itself green on its own PR (verify Node 20+22 pass, E2E Chromium pass incl. no-slice). Gotcha logged: local `npm install` (Windows/npm11) strips `libc` fields from linux optional deps — must NOT commit that lockfile churn (restored committed lockfile). Next: T-5.
- **C3 (2026-06-25):** **T-5 MERGED** (PR #3 → `be68c1d`). Dependabot config (npm + github-actions). Self-review + 1 independent adversarial review; F-12 fixed (individualize major action bumps). CI green incl. Dependabot's own config-validation check. Browser cache confirmed working (E2E 1m20s→54s). Next: T-6 (production-build e2e).
- **C4 (2026-06-25):** **T-6 MERGED** (PR #13 → `33ca290`). CI e2e now runs against the production rolldown bundle (vite preview); F-13 fixed, F-14 seeded (T-10). Triggered by C3, Dependabot opened the version-update batch (#4-#12).
- **C5 (2026-06-25):** Dependency batch landed. **T-8** (#8 katex 0.17/mermaid 11.16, verified KaTeX JS/CSS version-lock) → `9434106`. **T-7** (#14 consolidated action majors checkout/setup-node/cache/upload-artifact, closed #4-#7) → `63dd258`. Approach for stale Dependabot branches: supersede with own branch off current main; `npm ci` tests their committed lockfile without W-2 churn.
- **C6 (2026-06-25):** **T-9b** (#15 TS 6.0, closed #12) → `fb505aa` — proved W-2 libc-stripped lockfile passes CI `npm ci` on linux (benign). **T-9a** (#16 shiki monorepo→4.3 all 6 pkgs, closed #9/#10) → `b9a6378` — zero code change, independent review SAFE, F-18 seeded (T-11). **T-9c** (#17 eslint 9→10 + @eslint/js + engines floor, closed #11) → `2ebc8b7` — lint clean.
- **C7 (2026-06-25) MILESTONE:** All Dependabot PRs resolved (9 PRs merged this session); deps fully current; first CI established + hardened + testing the production bundle. Final main `2ebc8b7` fully green (all gates + agent tooling). No open PRs. Remaining backlog is product/quality work: T-3 (bundle lazy-load), T-4/T-11 (Shiki language handling), T-10.
- **C8 (2026-06-25):** **T-12** (#18 docs version-sync) → `82ac4bc`. **T-10** (#19 expose `window.__mdviewer` hook + make the false-confidence settings e2e honest; +typed global; independent review ship-able) → `68bf164`. **Live demo** run against the production bundle: sample loads via the new hook → 7 pages, 5 Shiki blocks, 4 KaTeX, 4 callouts, 9 TOC links, 1 Mermaid SVG; **no-slice geometry check: 12 atomic blocks, 0 straddling a page boundary**; screenshots + a PDF saved to the session scratchpad. 11 PRs merged total. Clean wrap point — remaining backlog (T-3, T-4/T-11, T-13) is design-heavy / needs direction (see Q-2, Q-3). No open PRs; main green.
- **C9 (2026-06-25) — PAUSE / WRAP:** User paused the loop and answered all deferred questions: Q-1 keep MIT (AI-3 closed), Q-2 build out on-demand Shiki languages (T-4), Q-3 do bundle lazy-load (T-3). Tidy-up: ORCHESTRATOR.md committed to the repo (was untracked), ACTION_ITEMS.md snapshot + AI-3 resolution recorded, greenlit backlog + "NEXT SESSION START HERE" pointer written. Final housekeeping PR = **T-14**. Working tree clean, no open PRs, `main` green. Next session: start the greenlit T-3 / T-4.
- **C10 (2026-07-24) — HARDENING / PACKAGING:** Started from exact `origin/main` `a0647549` in a
  detached-origin isolated worktree, then created `feat/product-hardening-deployment`; primary main
  stayed unchanged. Cleared 3 npm advisories; sanitized Markdown/Mermaid output; lazy-loaded Paged.js;
  implemented curated on-demand Shiki languages; added isolated E2E ports after detecting a stale
  primary-checkout Vite listener; added tested production serving, one-command/click Windows launch,
  static-host headers, source-map opt-in, and a deployment decision guide. T-18 awaits final full gates.
  Independent review then exposed four high findings: Mermaid was plain Shiki text; generic
  sanitization removed its styles/labels; SVG presentation attributes could retain remote URLs; and
  no-slice E2E could miss a short logical block split into separate fragments. Commits `993e926` and
  `3a12930` fix all four with real Chromium and stable source identity coverage; `8db5072` fixes the
  review's IPv6 launcher finding. Follow-up review then found and closed an obfuscated-CSS URL bypass
  (`5be6243`) and dark-preview/print Mermaid theme drift (`ff07d38`). The independent re-review passed
  at `ff07d38` with no release-blocking finding.
- **C11 (2026-07-24) — FINAL LOCAL GATES:** `npm run agent:check` passed (171 unit + 3 server),
  production build passed with zero source maps, `npm audit` reported zero vulnerabilities, agent hook
  smoke and all 14 repo skills passed, and all 18 Chromium E2E tests passed independently against both
  the production bundle and Vite dev on fresh ports. The complete gate set was rerun after this final
  documentation checkpoint so the handoff evidence applies to the resulting exact branch head.
- **C12 (2026-07-24) — PUBLISHED FOR REVIEW:** Pushed `feat/product-hardening-deployment` and opened
  draft PR **#28** against `main`. The first remote observation showed all three CI jobs running and
  the PR mergeable. GitHub still reports one high Dependabot advisory on the default branch; this
  branch reports zero via `npm audit`. Re-read exact-head CI, review threads, and bot comments before
  any future ready-for-review or merge transition.
- **C13 (2026-07-24) — POLICY PROMOTION:** Added the standing small-commit, autonomous draft-PR,
  aged-review, exact-head-CI, zero-comment-debt, merge-commit-only policy to repo `AGENTS.md`, the
  live global Codex mirror, and the live Claude canonical file. Canonical config publication is draft
  `claude-config` PR #5. MDviewer `main` is currently unprotected, so mechanical enforcement remains
  human-owned AI-5 rather than an implied repository-settings mutation.
- **C14 (2026-07-24) — SOLO-OWNER PROTECTION + PDF REVIEW:** Applied relaxed `main` protection:
  PR required, required conversation resolution, exact Node 20/22 and production Chromium checks,
  zero required approvals, admin emergency bypass, force-push/deletion blocked, merge commits on and
  squash off. Installed Chrome showed the primary PDF emitted only page 1; `af006ff` fixes the print
  shell and final-page break, with a real 7-sheet PDF regression test. Both export paths then produced
  7 A4 pages; all 14 rendered pages were visually inspected with no sliced normal atomics. A fresh
  independent review found three gaps; commits `f072846`, `4e1e771`, and `48196ba` address all three.
