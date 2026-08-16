# MDviewer — Orchestrator State

> Single source of truth for the autonomous engineering loop. Resumable: a fresh session can
> read this file alone and continue. Keep entries terse and factual. Update at every checkpoint.

> **▶ CURRENT CHECKPOINT — 2026-08-16:** The QA sweep is **MERGED AND LIVE**. The manual QA
> report `mdviewerqareport.md` (27 findings against the outdated July deployment) drove a
> coordinated fix sweep on `qa-sweep-20260816`: 25 findings fixed, 1 already fixed on `main`,
> 1 deferred with a written plan (TECH-1 responsive toolbar <720px — see the 2026-08-16
> failure-ledger entries for it and the three other accepted trade-offs). The app is now an
> installable PWA with full offline support. PR **#48** merged as **`8a9c942`** with all three
> CI jobs green (after `52132ee` pinned a 1600×900 viewport for the two single-row toolbar E2E
> assertions, which wrapped at 1280px on CI Linux's wider fonts). Wrangler deployed production
> id **`3378378d-82ab-4de7-9fe7-30873b650a66`** from `8a9c942`; the stable URL serves the new
> build and the smoke checks passed, including `max-age=0, must-revalidate` on `/sw.js` +
> `/manifest.webmanifest` and immutable `workbox-*.js`. Evidence at the merged head: 341 unit,
> 4 server, 65+67 Chromium E2E (dev + production incl. offline and both no-cutoff tests).
> **Two OPEN human items: AI-7 (manual live-site acceptance, steps 4–8) and AI-6.**
>
> **▶ PREVIOUS CHECKPOINT — 2026-08-12:** The repository owner selected
> `GPL-3.0-only` for current and future owner-authored MDviewer code, superseding
> the earlier MIT placeholder. The licensing PR also makes every production
> `dist/` carry the GPL text, exact corresponding-source link, project notice,
> and installed dependency licence texts. Historical MIT revisions retain their
> grant. **AI-6 remains the one OPEN human item.**
>
> **▶ PREVIOUS CHECKPOINT — 2026-08-08:** The split-view Markdown editor is **MERGED**. PR **#36**
> closed its review round — all 11 Codex findings addressed across four fix commits — and merged to
> `main` as merge commit **`87249e0`**, with the post-merge `main` CI run green on all three required
> jobs. Head at merge was `0867399`.
> `ACTION_ITEMS.md` still has **one OPEN item, AI-6** — the manual browser acceptance of the split
> workspace, which only the maintainer may close; PR **#39** sharpens its checklist to cover the six
> behaviours this review round fixed. The two stale worktrees from 2026-07-24
> (`codex-deployment-record-20260724`, `codex-improvements-20260724`) were torn down; both removed
> without `--force` and their branches are merged into `main`, so nothing was lost.
> **The Dependabot backlog is cleared:** all eight open PRs (#23, #25, #27, #32, #33, #34, #37,
> #38) are superseded by one consolidated sweep, which also fixed two advisories Dependabot never
> raised (`dompurify` XSS, `brace-expansion` DoS). `npm audit` reports **0 vulnerabilities** and
> all 11 GitHub alerts are resolved. The stale queue table below is retained only as the
> 2026-07-24 historical record — see the note on it.

> **▶ PREVIOUS CHECKPOINT — 2026-07-24:** Public launch and its durable record are complete. Product
> hardening PR **#28** merged as `7f4eedf`; deployment-record PR **#29** merged as `43af438`, whose
> exact `main` CI run `30060892316` passed. Cloudflare Pages production deployment `e3bd9770` remains
> live at **https://mdviewer-c9r.pages.dev/** and passed HTTP, header, and hashed-asset smoke checks.
> The user explicitly closed AI-1 and AI-5 and selected/authorized Cloudflare Pages for AI-4;
> `ACTION_ITEMS.md` has no OPEN items. The next session should reconcile the six dependency PRs or
> choose a remaining product slice below; there is no launch blocker.

## NEXT SESSION START HERE

### 1. Re-establish live truth before changing anything

Follow the first-five-minutes order in `AGENTS.md`, then run this state reconciliation from the
primary checkout. GitHub mergeability, check results, review state, and deployment state are snapshots;
never carry them forward after a head change.

```powershell
git fetch --prune
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
gh pr list --state open --json number,title,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,url
gh run list --branch main --limit 5 --json databaseId,headSha,status,conclusion,url
gh api repos/Chris0Jeky/MDviewer/branches/main/protection
npm exec --yes wrangler@4.114.0 -- pages deployment list --project-name mdviewer --json
```

Use a project-local isolated worktree created with `git worktree add --detach <path> origin/main`,
then create a branch inside it. Keep the primary checkout clean. Any changed PR head invalidates its
older CI and independent-review evidence.

### 2. Durable launch snapshot

- **Repository anchor:** `main` was `43af438a47df08030cf0e6eafcc7b6ec7c580ea1` after PR #29; CI run
  `30060892316` passed Node 20, Node 22, and production Chromium.
- **Production:** Cloudflare Pages project `mdviewer`, stable URL
  **https://mdviewer-c9r.pages.dev/**. Current deployment (2026-08-16): immutable URL
  **https://3378378d.mdviewer-c9r.pages.dev/**, deployment id
  `3378378d-82ab-4de7-9fe7-30873b650a66`, source `8a9c942`, branch `main`. (First
  deployment `e3bd9770-750c-4abe-b758-d7191dc7e841` from `7f4eedf`, 2026-07-24.)
- **Deployment mode:** Wrangler direct upload. A Git push does **not** deploy automatically. From an
  authenticated maintainer machine, build and deploy with the commands in `docs/DEPLOYMENT.md`.
- **Privacy/product boundary:** the public product is still entirely client-side. Documents and PDFs
  remain in the browser; there is no conversion API, document storage, telemetry, or third-party
  document/resource request. Same-origin application chunks and fonts can load lazily as features run.
- **Human queue (2026-08-16):** **AI-7** (manual live-site acceptance of the QA sweep, steps
  4–8) and **AI-6** (split-workspace browser acceptance). `ACTION_ITEMS.md` is authoritative
  and only the maintainer may close items.
- **Branch protection:** relaxed solo-owner profile — PR required; conversation resolution and the
  three CI jobs required; zero approvals; admins may bypass; force-push and deletion blocked; merge
  commits enabled, squash disabled; strict/up-to-date checks disabled.
- **Release evidence:** the PR #28 exact head passed 175 unit tests, 4 server tests, build, audit,
  hook smoke, 14 skill validations, and 19 Chromium tests in both dev and production-preview lanes.
  Installed Chrome produced both 7-page PDF paths; all 14 rendered pages were visually inspected.
  Local PDF evidence was retained at
  `C:\Users\Public\codex-shell-home\mdviewer-pdf-evidence-20260724` on the maintainer machine.

### 3. Dependabot queue — RESOLVED 2026-08-08 (historical snapshot below)

> **⚠ This section is history, not work.** Every dependency listed here is now at or beyond the
> proposed version, applied in one consolidated sweep and verified together rather than PR by PR.
> `npm audit` reports 0 vulnerabilities. Do **not** act on the table below; it is kept only to
> show what the queue looked like and what was decided.
>
> Of the six PRs recorded on 2026-07-24, #22 (jsdom 25→29), #24 (`markdown-it-attrs` 4→5) and #26
> (toolchain group) were resolved before this sweep; #23, #25 and #27 were carried into it along
> with the later #32, #33, #34, #37 and #38.

As observed on 2026-07-24, all six PRs below reported `MERGEABLE`/`CLEAN` with their three CI jobs
green. Most checks are from 2026-06-29 and predate the product-hardening merge; #26 was refreshed on
2026-07-24.

| PR | Exact observed head | Change | First concern to review |
| --- | --- | --- | --- |
| #22 | `857d4c8` | jsdom 25 → 29 | Major test-runtime behavior and Node compatibility |
| #23 | `af39e2b` | `@types/markdown-it-container` 2 → 4 | Type/API drift against the runtime package |
| #24 | `a547204` | `markdown-it-attrs` 4 → 5 | Runtime Markdown parsing and sanitization behavior |
| #25 | `15bbd19` | `@types/node` 22 → 26 | Declared Node floor and accidental newer-API use |
| #26 | `7948a07` | ESLint, typescript-eslint, Vite, and Vitest updates | Grouped lockfile/toolchain interactions |
| #27 | `b8a157d` | `actions/setup-node` 6 → 7 | Workflow behavior and supported runner/Node matrix |

Recommended approach *as written on 2026-07-24* — **superseded on 2026-08-08**, recorded because the
reasoning behind departing from it is worth keeping. One-PR-at-a-time was the wrong shape here: every
one of these except #27 rewrites `package-lock.json`, so serial merging costs a forced rebase and a
CI cycle per PR and still never verifies the combined result — each PR only ever proves its own bump
against a base that has since moved. The sweep instead applied all of them at their proposed
versions in separate commits on one branch and verified the end state, which is the state that
ships. Prefer that shape next time the queue is more than two deep and they all touch the lockfile.

Original text: take one independent PR at a time, oldest first unless live review reveals a
dependency or superseding relationship. For each slice: exact-head diff review, local relevant gates,
independent adversarial review, all bot/human comments triaged, hosted CI green, then merge-commit
only. Never treat these snapshot results as current proof.

If dependency maintenance is intentionally deferred, the highest-value product choices are:

1. Profile very large documents and establish render-time, main-thread, and memory budgets (the only
   remaining P3 roadmap item).
2. Pick one narrow P2 UX/accessibility slice and preserve the no-slice/render-order invariants.
3. Optionally automate the existing Pages project with a GitHub Actions workflow using pinned
   Wrangler plus scoped Cloudflare secrets. A Direct Upload project cannot later switch to Pages Git
   integration; that alternative requires a new Pages project and an explicit URL/domain migration.
4. Consider installable PWA packaging only as optional product polish. A remote `POST /convert` API
   is a separate security/privacy product and must not be slipped into this client-only app.

## Run header

- **Start commit:** `fe085b0` (Initial scaffold) on `main`, tracking `origin/main`.
- **Goal:** Drive real, shippable improvements end-to-end (discover → plan → implement → review → verify → merge), keeping a durable resumable record.
- **Current cycle:** 3 — **PUBLIC LAUNCH COMPLETE**; next work is dependency reconciliation or a
  deliberately selected P2/P3 product slice.
- **Last updated:** 2026-08-16
- **Cycle-2 base (historical):** exact `origin/main` `a0647549be99f8053732150d7ef1ff9c5e9c65c6`.
- **Live GitHub queue snapshot (2026-07-24):** Dependabot PRs #22–#27 reported clean/mergeable with
  green CI at the exact heads listed above. Refresh before use; several checks predate current `main`.
- **Verified `main` anchor:** `43af438a47df08030cf0e6eafcc7b6ec7c580ea1` (PR #29 merge).
- **PRs merged through the launch record:** 14, including housekeeping PR #20,
  product-hardening/deployment PR #28, and deployment-record PR #29.
- **Current main verification (`43af438`):** hosted Node 20/22 and production Chromium CI run
  `30060892316` green. The fuller product/release gate evidence belongs to PR #28 / `7f4eedf` and is
  summarized above; production Pages smoke is recorded in C16.

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

- **AI-7 — Accept the QA-sweep fixes on the live site (manual gate).** Opened 2026-08-16 with
  PR #48. Merge, deploy, and smoke (steps 1–3) are done; the remaining steps 4–8 are the
  in-browser checks on **https://mdviewer-c9r.pages.dev/** (zoom/chip/banners/export progress,
  PWA install + offline, dark-theme print accuracy, the Title-page toggle). Instructions in
  `ACTION_ITEMS.md`.
- **AI-6 — Accept the split workspace in a real browser (manual UI gate).** Opened 2026-08-08 with
  PR #36. Automated coverage cannot judge how typing feels or confirm the Print/Save-as-PDF output
  by eye. Step-by-step instructions are in `ACTION_ITEMS.md`; only the maintainer may close it.

## Task board

| id | title | status | prio | deps | branch/PR | review | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-1 | Evaluate & land Dependabot PR #1 (jspdf 2→4 security + vite 6→8, vitest 2→4) | **MERGED** | P2 (security) | — | PR #1 → `8839177` | 2 adversarial lenses, all gates green incl. prod-build e2e | Security bump landed; jspdf advisories closed; deps current. 0 vulns. |
| T-2 | Add GitHub Actions CI (typecheck/lint/unit/build + e2e on Chromium) | **MERGED** | P1 (unblock) | — | PR #2 → `cf5042c` | 2 adversarial reviews resolved | CI green on its own PR (verify Node 20+22, E2E Chromium incl. no-slice). Gate now enforceable. |
| T-3 | Lazy-load Paged.js | **MERGED** | P3 performance | — | `27544c1`; PR #28 → `7f4eedf` | unit + dev/preview E2E + PR CI | Empty state no longer pays the Paged.js cost; pagination remains last |
| T-4 | Load curated Shiki languages on demand | **MERGED** | P3 performance | — | `8a494ee`; PR #28 → `7f4eedf` | unit + real Chromium C# fixture + PR CI | Pre-scan resolves curated grammar chunks before synchronous Markdown render |
| T-5 | Add `.github/dependabot.yml` (github-actions + npm auto-updates) | **MERGED** | P3 | — | PR #3 → `be68c1d` | self + 1 independent review; F-12 fixed | Config-valid (Dependabot check passed). Auto-patches deps+actions; closes F-11. |
| T-6 | CI e2e tests the production bundle (`vite preview`), not just dev server | **MERGED** | P2 (closes F-10) | — | PR #13 → `33ca290` | self + independent review; F-13 fixed | CI e2e now runs on the shipped rolldown bundle |
| T-7 | GitHub Actions majors consolidated (checkout 4→7, upload-artifact 4→7, setup-node 4→6, cache 4→6) | **MERGED** | P4 | — | PR #14 → `63dd258`; closed #4-#7 | CI ran the bumped actions green | consolidated 4 PRs into 1 |
| T-8 | Dependabot: npm production minor/patch group (#8: katex 0.16→0.17, mermaid 11.0→11.16) | **MERGED** | P4 | — | PR #8 → `9434106` | full local gates + PR CI; katex JS/CSS version-lock verified | minor/patch group; 15/15 e2e |
| T-9a | Consolidated shiki monorepo → ^4 (supersede #9 + #10) | **MERGED** | P3 | — | PR #16 → `b9a6378`; closed #9/#10 | full gates + independent review (SAFE) | all 6 shiki pkgs → 4.3; zero code change; clean dedupe |
| T-9b | typescript 5.9→6.0 (#12) | **MERGED** | P3 | — | PR #15 → `fb505aa`; closed #12 | local gates + CI (npm ci on linux validated) | proved own-branch approach; W-2 libc churn is benign |
| T-9c | eslint 9→10 (#11) + `@eslint/js`→^10 + lint-fix + engines floor | **MERGED** | P3 | — | PR #17 → `2ebc8b7`; closed #11 | full gates + CI Node 20+22 | lint clean (no new findings); engines tightened |
| T-10 | Expose `window.__mdviewer` hook + make the settings e2e honest | **MERGED** | P4 | — | PR #19 → `68bf164` | self + independent review (ship-able); nit applied | was false-confidence no-op test; now drives real re-pagination; +typed prod hook |
| T-13 | Fix misleading Canvas "Fit the page to the canvas" tooltip (Canvas.ts:26) — actual behavior is natural mm sizing (`transform: none`) | **MERGED** | P5 | — | `982c6c0`; PR #28 → `7f4eedf` | unit + E2E + PR CI | Control copy now describes natural-size rendering |
| T-14 | Wrap-up housekeeping: commit ORCHESTRATOR.md, record Q-answers, ACTION_ITEMS snapshot | **MERGED** | P3 | — | PR #20 → `1b9fe30` | hosted CI | made cycle-2 state durable for the next session |
| T-11 | dead `ensureLang` loader | FOLDED → T-4 | P4 | — | — | F-18 | user chose build-out (Q-2): keep `ensureLang`, make it work as part of T-4 (don't delete). |
| T-12 | Docs version-sync after the major dep bumps | **MERGED** | P3 (docs gate) | T-1,T-8,T-9a/b/c | PR #18 → `82ac4bc` | skills validate + CI | spec/notes/roadmap/3 skills now match installed versions |
| T-15 | Sanitize untrusted Markdown and Mermaid output | **MERGED** | P1 security | — | `d2fc3c9`, `5be6243`; PR #28 → `7f4eedf` | independent adversarial review; literal and obfuscated bypasses fixed; PR CI | Local-first renderer no longer executes/auto-loads hostile HTML/SVG/resource URLs |
| T-16 | Resolve transitive npm advisories | **MERGED** | P1 security | — | `d54892c`; PR #28 → `7f4eedf` | `npm audit` + PR CI | 3 advisories → 0 |
| T-17 | Isolate E2E server ports | **MERGED** | P2 test honesty | — | `7fdd9cb`; PR #28 → `7f4eedf` | dev + preview 18/18 + PR CI | stale primary-checkout listener can no longer contaminate targeted runs |
| T-18 | Product packaging and deployment paths | **MERGED + DEPLOYED** | P2 distribution | T-3,T-4 | PR #28 → `7f4eedf`; Pages `e3bd9770` | exact-head CI + independent re-review + production smoke | local launchers and deployment runbook landed; public app live at `mdviewer-c9r.pages.dev` |
| T-19 | Restore Mermaid rendering and sanitize real SVG safely | **MERGED** | P1 correctness/security | T-15 | `993e926`, `ff07d38`; PR #28 → `7f4eedf` | independent finding + real Chromium + PR CI | Mermaid bypasses Shiki, retains safe SVG styles/text, strips remote SVG/CSS resources, and stays print-light |
| T-20 | Close no-slice E2E identity gap | **MERGED** | P1 test honesty | — | `3a12930`; PR #28 → `7f4eedf` | independent finding + production E2E + PR CI | stable source atomic IDs detect short logical blocks cloned across pages; over-tall pre/table splits constrained |
| T-21 | Fix primary print pagination and inspect both PDFs | **MERGED** | P1 correctness | T-18 | `af006ff`; PR #28 → `7f4eedf` | installed Chrome + rendered 14 PDF pages + regression E2E + PR CI | primary vector export now prints all 7 sheets without a trailing blank; fallback remains 7 pages |
| T-22 | Close second adversarial-review findings | **MERGED** | P1/P2 | T-20,T-18 | `f072846`, `4e1e771`, `48196ba`; PR #28 → `7f4eedf` | targeted gates + final independent re-review + exact-head PR CI | canonical atomic selector complete; Windows launcher returns to error handler; relaxed aging criterion operational |

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

- **Q-1** (AI-3 licence): **SUPERSEDED 2026-08-12 — GPL-3.0-only.** The repository owner's later
  decision relicenses current and future owner-authored MDviewer code under GPLv3. Historical MIT
  releases retain their original grant; the durable record is `RELICENSING.md`.
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
- **C15 (2026-07-24) — FINAL LOCAL GATES:** Exact local head passed typecheck, lint, 172 unit tests,
  4 production-server tests, production build, zero-vulnerability audit, hook smoke, all 14 skill
  validations, and all 19 Chromium E2E tests against both production-preview and dev servers on
  isolated ports. Final documentation commit requires a short exact-head rerun before publication.
- **C16 (2026-07-24) — MERGED + PUBLICLY DEPLOYED:** PR #28 passed exact-head Node 20/22/production
  Chromium CI, final independent re-review with no actionable findings, and zero review-thread debt;
  merged with merge commit `7f4eedf` without deleting the branch. User explicitly accepted AI-1 and
  AI-5 and selected Cloudflare Pages for AI-4. Wrangler OAuth created project `mdviewer` and deployed
  production id `e3bd9770` from `main`. Stable URL **https://mdviewer-c9r.pages.dev/** and immutable
  deployment URL returned HTTP 200; entry title, hashed JS asset, immutable cache header, and security
  headers verified. No human action items remain open.
- **C19 (2026-08-08) — SPLIT-VIEW EDITOR MERGED after its review round:** PR #36's two Codex passes
  raised **11 findings** (5×P1, 6×P2); all are addressed and every thread is resolved. Ten needed a
  change, in four commits; the eleventh (dark-mode inline token colours) was already fixed in
  `1fec906` before that pass ran, verified at the head rather than taken on trust. Two changed a
  contract rather than a line, and both are now in `IMPLEMENTATION_SPEC.md` §7/§12 +
  `AGENT_INDEX.md`: (1) **`#canvas` is the one pane never hidden with `display: none`** — Markdown
  mode still paginates into it and Paged.js measures real heights, all zero under a `display:none`
  ancestor, so it is parked `position:absolute; visibility:hidden` and un-parked under
  `@media print`, which also cures the blank-PDF-from-Markdown-mode defect; (2) **renders are
  serialized, not just debounced** — `createRenderScheduler` returns
  `RenderScheduler {schedule, flush, isPending}` and chains runs, because two overlapping
  `runPipeline` calls shared one Paged.js host, handler and page counter, and `renderToken` only
  ever suppressed the older run's final UI write. Both exports now `await App.flushRender()`.
  The other eight: typed glyphs invisible until the 90 ms debounce (the backdrop now repaints plain
  synchronously and Shiki only recolours), backdrop scroll not re-synced after a repaint, word count
  rescanning the document per keystroke, Tab discarding native undo history (now
  `execCommand("insertText")` with a guarded fallback), a divider drag that could strand `dragging`
  state (pointer capture + `lostpointercapture` + blur), and the scrollbar-gutter width mismatch
  between the two layers. Evidence at `0867399`: typecheck, lint, **252 unit** (was 236), 4 server,
  **36 Chromium E2E** (was 30) including both no-cutoff tests, build, hook smoke, 14 skills — all
  green locally, then all three CI jobs green at that exact head and again on `main` after the merge.
  Entry chunk 1,602.49 → **1,603.59 kB** (+1.1 kB). Merged with a merge commit, branch not deleted.
  **Not verified:** non-Chromium behaviour of `scrollbar-gutter: stable` and `execCommand`, and the
  real-browser *feel* of the changed typing path — both belong to AI-6. No fresh-context adversarial
  subagent review was run, again on the operator's standing "no subagents unless requested"
  instruction; the Codex connector pass plus exact-head CI carried the gate.
- **C18 (2026-08-08) — SPLIT-VIEW EDITOR PUBLISHED (PR #36, merged at C19):** Built on a branch in the
  primary checkout rather than a worktree — a single sequential session with no parallel agents, so
  worktree isolation bought nothing against a full `npm install` plus the recorded W-1 Windows
  removal hazard. Four commits: foundations (`viewMode`/`splitRatio` with *validating* migration,
  `DocStore.updateText` + a new `"text"` event, `ui/Editor.ts`, `ui/Splitter.ts`, `editor.css`),
  wiring (`#workspace`, the toolbar View group, the typing→preview loop), docs, and two
  browser-found fixes. Deliberate design points: the workspace is pure CSS state so a mode switch
  never re-renders, `viewMode`/`splitRatio` are **not** reflow keys because page geometry is mm-based
  (`measurePageArea` reads Settings, never the DOM), and the syntax backdrop is built from
  `codeToTokens` + `textContent` so document text is never parsed as markup — no per-keystroke
  DOMPurify pass. Three pre-existing bugs surfaced and were fixed: `.toolbar-group{display:flex}`
  defeated the `hidden` attribute so the single-document switcher never disappeared; `EmptyState.ts`
  emitted class names `preview.css` does not style, so the dropzone card was never styled; and the
  dark editor rule lost to Shiki's inline style for want of `!important`. Evidence at `1fec906`:
  typecheck, lint, **236 unit** (was 183), 4 server, **30 Chromium E2E** (was 19), build, hook smoke,
  14 skills — all green locally; hosted CI verify jobs green on Node 20 and 22. Entry chunk measured
  1,595.86 kB on `main` `0dbd8a2` vs 1,602.49 kB here (**+6.6 kB, +0.4%**), which also retires the
  stale "~1.46 MB" roadmap claim. Live installed-Chrome run: typed a document from scratch, edited
  the 8-page bundled sample in place, exercised all three view modes and the divider (ratio
  round-tripped through localStorage), and measured **15 atomic blocks with 0 straddling a page
  boundary**. `PRODUCT_VISION.md`'s "no editor pane" non-goal and the roadmap's P4 deferral were
  reversed in-place with the date and the reason, per the authority order. The gate outstanding at
  this checkpoint (exact-head CI plus a review pass) was met at **C19**, where the PR merged.
- **C17 (2026-07-24) — LAUNCH RECORD MERGED:** PR #29 corrected the durable launch documentation,
  passed exact-head CI and independent adversarial review with all comments triaged, and merged as
  `43af438`. Main CI run `30060892316` then passed all three required jobs. The relaxed solo-owner
  protection profile was read back from GitHub, the Pages deployment was read back from Wrangler,
  and open work is now only Dependabot #22–#27 plus the explicit P2/P3 roadmap choices above.
