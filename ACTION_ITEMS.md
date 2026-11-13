# Action Items — Human-Only Tasks

> **Purpose.** This file tracks tasks only the human (the maintainer) can do — credentials and
> repository or environment settings, approvals, and product, licensing and signing decisions — plus
> the acceptance checks the owner delegated to agent QA and a verified current-state snapshot.
>
> **Rules for agents.**
> 1. **Read this file at session start.**
> 2. **Flag every OPEN item** near the top of any summary, status report, or handoff, and list the
>    delegated items with their status ("delegated, not accepted" until their charters pass).
> 3. **Clear an OPEN item only on explicit human confirmation** (e.g. "AI-9 is done"). Move it to the
>    Completed log with the date and a one-line result. Never self-clear or assume completion.
> 4. **Never give the owner a mechanical check.** Trying a build, browser and live-site checks,
>    install, print, keyboard and screen-reader passes are agent QA work (owner decision 2026-11-13):
>    add them to `docs/qa/ACCEPTANCE.md`, not here. A new OPEN item is only for what no agent can do.
> 5. **Delegated is not accepted.** A delegated item's status changes only with evidence (a CI link,
>    a QA session report, an issue number); agents never mark one as accepted by the owner. A
>    delegated item moves to the Completed log only when every row of its charter in
>    `docs/qa/ACCEPTANCE.md` has passed or is recorded "not verified (no agent can check it; owner decision 2026-11-13 not to be asked)", with the
>    evidence linked, and its Completed entry names every not-verified row. A not-verified row is
>    never acceptance: a #169 box is ticked only when every one of its rows passed.
> 6. **Keep the Current State snapshot accurate** when verified truth changes.

---

## Current State (snapshot)

- **2026-11-13 (complete push paused by the owner)** — main
  [`382938b`](https://github.com/Chris0Jeky/MDviewer/commit/382938b) (last CI-verified: CI and Windows Desktop success), then
  #348 merged as `13af3de`. 27 PRs merged
  that day (#309 to #352, then #348): PDFs open and read (#322, #344), the browser host (#323), many fixes. Not in the app yet:
  PDF editing, the web shell, local pages, the weight table, D8, most of D7. Owner bugs #334/#335 are **not fixed yet**: the fix is in open
  #345, which fails the Windows smoke. OPEN owner items: **AI-9** and the parked **#169 signing decision**. Delegated, not
  accepted: AI-6, AI-7, AI-8, AI-10, #169 hands-on boxes (agent results in `docs/qa/ACCEPTANCE.md`, #348). Resume order: `ORCHESTRATOR.md`.

### Earlier snapshots (historical)

- **2026-11-13 (acceptance delegated to agent QA)** — main
  [`59d6c27`](https://github.com/Chris0Jeky/MDviewer/commit/59d6c27). During AI-10 on the CI build from `722cbbd`
  the owner found #334 and #335 and moved mechanical acceptance checks to agent QA. AI-6, AI-7, AI-8, AI-10 and
  the four hands-on boxes of #169 are now under "Delegated to agent QA"; AI-11 to AI-13 become QA charters. None
  was accepted. The only OPEN owner items are **AI-9** and the parked **#169 signing decision**.

- **2026-11-12 (Companion push close-out)** — main
  [`2544bc4`](https://github.com/Chris0Jeky/MDviewer/commit/2544bc4) (merge of #297). Its CI
  [43314167244](https://github.com/Chris0Jeky/MDviewer/actions/runs/43314167244) and Windows Desktop
  [43314167050](https://github.com/Chris0Jeky/MDviewer/actions/runs/43314167050) completed success; so did the
  previous main [`42426fe`](https://github.com/Chris0Jeky/MDviewer/commit/42426fe92f3c098890b490ac8ecb38a12b223792)
  (merge of #295). New since the entry below: YAML, TOML, CSV and TSV now open as readable views (D4, #281, #284,
  #288) and the views are easier to read (D6, #293); New from template reads a pinned project's `templates/`
  folder (A4, #285, #286, #295); the Library lists agent data files (#290); switching tabs is faster (S9 part 1,
  #294). The copy functions are on main (D5 pure part, #289) but not yet in the app (webview #299); the S9 polish pass
  merged (#298). S9 part 2 (#297: start-up numbers, first frame in the theme colour) is merged. Not on main: the embeddable
  reading element (A5, #300). These are automated results on
  unsigned CI builds; nobody has accepted them on real files, which is **AI-10**. **AI-6, AI-7, AI-8, AI-9, AI-10
  and #169 remain OPEN; none was cleared.** No deployment, signed release or performance claim is made; the
  deployed site is unchanged. The ordered queue and every PR/issue number are in
  [ORCHESTRATOR.md](ORCHESTRATOR.md).

- **2026-11-12 (companion push: Readable data and Actionable Markdown on main)** — main
  [`8984b9b`](https://github.com/Chris0Jeky/MDviewer/commit/8984b9b7fa29a7d5bafc16f56b96597ef1c454ed)
  (merge of #281); [CI 43221710538](https://github.com/Chris0Jeky/MDviewer/actions/runs/43221710538) and
  [Windows Desktop 43221710658](https://github.com/Chris0Jeky/MDviewer/actions/runs/43221710658) passed on it.
  The Windows app now saves in place (Save/Save As), follows file changes, keeps a Library and opens
  linked Markdown files. Actionable Markdown A1 to A3 (#252, #244, #263) are merged: task checkboxes and
  marks, choices, fields and status chips are clickable in the reader and written back byte-exact with
  Undo (the native smoke #275 proves toggle and Undo on a CRLF file against the real host). The app also
  opens `.json`, `.jsonc`, `.jsonl`, `.ndjson`, `.txt` and `.log` as readable views, with a conversation
  view for chat and agent transcripts (Readable data D0 to D3, #269/#270/#273/#272/#280). Not yet a
  readable view: YAML, TOML and CSV (parsers merged in #281; native open #284 merged, so such files
  open, but as plain Markdown text until the webview follow-up lands), templates (A4: native read
  #285 merged, picker #286 open). These are automated results on unsigned CI builds; nobody has
  accepted them on real files yet, which is the new item **AI-10**. **AI-6/AI-7/AI-8/AI-9 and #169
  remain OPEN, and AI-10 is added.** No
  deployment, signed release or performance result is claimed; the deployed site is unchanged.

- **2026-11-05 (editor follow-up qualified)** — application revision
  [`18afeeb8`](https://github.com/Chris0Jeky/MDviewer/commit/18afeeb8df7f7448d5241de50ff00db1d56f9697),
  tree `2ede86cc07caf53a8afb3106716ece69c49d8a41`, includes merged #209/#210/#208/#213/#212/#211/#214.
  Format, session positions/navigation, visible PDF progress, production Firefox
  and authored-heading isolation are delivered. The two persistence designs are
  merged; their implementations remain open. All six hosted jobs passed at the
  qualified revision: 1,073 units per Node lane, 178 web Chromium
  cases with five existing optional performance skips, 94 Firefox,
  36 desktop Chromium, 22 Rust and 21 probe-policy cases plus actual
  native launch/save verification. Exact source/binary checks and artifact retention
  are in the [editor follow-up checkpoint](docs/design/2026-11-05-editor-followup-checkpoint.md)
  and [#169](https://github.com/Chris0Jeky/MDviewer/issues/169).
  **AI-6/AI-7/AI-8/AI-9 and #169 remain OPEN.** Current saves are explicit copies;
  documents remain in memory. This does not establish deployment, a signed release,
  an automatic updater or comparative RAM/startup performance.

- **2026-11-05 (combined application verified; future work indexed)** —
  [main `203c0979`](https://github.com/Chris0Jeky/MDviewer/commit/203c09798b01061ceb0c00f0937c22beeafb1a55),
  tree `8fe8e94f9cde0a52f3344075f0c272f140825ccb`, includes all nine authoring,
  export, Shiki and documentation PRs through #194. Postmerge
  [CI 42053738540](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053738540)
  and [Windows 42053740244](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244)
  passed all five jobs: 832 unit tests on each Node lane, 130 web cases with five
  optional performance skips, 27 desktop cases and 22 Rust tests plus native smoke.
  All 330 tracked source blobs match GitHub; the packaged portable executable
  matches the executable exercised by the two-dialog native save smoke.
  [#169](https://github.com/Chris0Jeky/MDviewer/issues/169) records downloads,
  checksums, artifact retention and the still-unchecked Windows acceptance work.
  [Future work](docs/FUTURE_WORK.md) / [#195](https://github.com/Chris0Jeky/MDviewer/issues/195)
  now track the scoped development queue. Save/Save As and optional recovery are
  design-first proposals; current documents stay in memory and Save Markdown saves
  a copy. **AI-6/AI-7/AI-8/AI-9 and #169 remain OPEN.** No live deployment, signed
  release, automatic updater or comparative RAM/startup result is claimed. The
  deployed-source history and human checklists below are unchanged.

- **2026-11-05 (qualified desktop authoring and offline capture)** — the last merged
  authoring baseline verified for this record is
  [280c73e2](https://github.com/Chris0Jeky/MDviewer/commit/280c73e26487b16d7de607c269b2839636b0b969).
  It includes [New #183](https://github.com/Chris0Jeky/MDviewer/pull/183),
  [compact writing space #187](https://github.com/Chris0Jeky/MDviewer/pull/187),
  [guarded mutations #185](https://github.com/Chris0Jeky/MDviewer/pull/185),
  [Find/Replace #188](https://github.com/Chris0Jeky/MDviewer/pull/188),
  [workspace readiness #192](https://github.com/Chris0Jeky/MDviewer/pull/192),
  [offline capture #178](https://github.com/Chris0Jeky/MDviewer/pull/178), and
  [visible source matches #191](https://github.com/Chris0Jeky/MDviewer/pull/191).
  Their reviewed heads completed CI and Windows Desktop qualification. Documents
  remain in memory, reader startup stays lazy, and Save Markdown still saves a copy.
  #174/#189/#190 are closed. The final combined authoring head `e8ef574a` passed
  all five jobs: 830 units, 130 web cases with five optional performance skips,
  27 desktop cases and 22 Rust tests plus native smoke. Independent review inspected
  corrected match alignment, short/laptop-window screenshots and the source TREE.
  Offline capture uses exact html2canvas-pro 2.6.0; review verified saved-PDF pixels,
  real CSS/font failure and recovery evidence, both native Save dialogs, exact
  Markdown/PDF files and clean teardown. Main `85f7361e` postmerge checks also passed.
  [Shiki dependency qualification #193](https://github.com/Chris0Jeky/MDviewer/pull/193)
  records the initial jsdom `Blob.stream()` finding, test-environment correction and
  final qualification receipts separately; consult that PR for its final head/merge.
  See `docs/design/2026-11-05-authoring-checkpoint.md` for source and evidence anchors.
  **AI-6/AI-7/AI-8/AI-9 and #169 remain OPEN.** No live deployment, signed release or
  representative performance result is claimed. The deployed-source anchor and exact
  human checklists below are unchanged.

- **2026-11-05 (Windows preview integrated; acceptance open)** — the experimental
  Windows reader is merged through [#158](https://github.com/Chris0Jeky/MDviewer/pull/158),
  with highlighting admission in [#162](https://github.com/Chris0Jeky/MDviewer/pull/162)
  and selective reader grammar preparation in [#172](https://github.com/Chris0Jeky/MDviewer/pull/172).
  Independent review and all five exact-head web, desktop-browser and native Windows
  checks passed before those merges. The native smoke verifies actual Markdown/PDF
  saves and records the complete observed WebView2 process tree. Dependency PRs
  #166, #168, #170 and the scoped development dependency follow-up
  [#173](https://github.com/Chris0Jeky/MDviewer/pull/173) also merged after review and green exact-head checks.
  The workspace label correction for [#171](https://github.com/Chris0Jeky/MDviewer/issues/171)
  completed in merged [#177](https://github.com/Chris0Jeky/MDviewer/pull/177).
  The narrow dependency split in [#165](https://github.com/Chris0Jeky/MDviewer/pull/165)
  merged as [2a26940d](https://github.com/Chris0Jeky/MDviewer/commit/2a26940d4c1da3e6c770b47111538726fc882d12)
  after all five exact-head checks passed. It pins html2canvas-pro 2.5.2, advances KaTeX to 0.19.1
  and limits the temporary Dependabot exclusion to html2canvas-pro 2.6.0.
  [#174](https://github.com/Chris0Jeky/MDviewer/issues/174) tracks offline raster PDF styling
  and the blocked html2canvas-pro 2.6 follow-up; retaining 2.5.2 does not establish offline visual fidelity.
  These are unsigned CI previews; no live web deployment or comparative RAM/startup
  result is claimed. [Issue #169](https://github.com/Chris0Jeky/MDviewer/issues/169)
  tracks ordinary Windows install/uninstall, Explorer associations, keyboard/Narrator,
  print drivers, representative hardware measurements and signing/distribution decisions.
  **AI-6/AI-7/AI-8/AI-9 remain OPEN.** The deployed application's source anchor remains
  the historical record below until an actual deployment is verified.

- **2026-10-02 (reviewed fixes deployed)** — application source
  `51b9758fa4e6b265f4376edf02d3f56821b9de8e` is live as `bf04155f`
  (`https://bf04155f.mdviewer-c9r.pages.dev/`, id
  `bf04155f-f343-4f8a-b5cd-9bc78fff2977`). Exact-main Windows 529 unit/four
  server tests, build and 109 one-worker Chromium cases passed, as did all three
  hosted checks. Stable/immutable bytes, full SOURCE, SDK 3.3.1 hash, headers,
  seven-sheet clean boot and both-export egress smoke passed (498 same-origin
  requests). #119/#120/#121 are closed; both late development-only dependency
  alerts are fixed via #127. The prior `f97778db`/`df50e7a` is the rollback and
  pending stable-origin update-toast predecessor. Real dry runs passed without
  approval or production records; AI-9 still holds the first live automated
  promotion. **AI-6/AI-7/AI-8/AI-9 remain OPEN.** Later development-lock and
  record commits do not change the deployed application's source anchor.

- **2026-09-27 (deploy workflow hardening)** — post-merge review of PRs #106 to #116
  found a shell injection in `deploy.yml`'s main-only guard and that the guard is not
  the real control. The fix PR passes the ref via `env` and documents the
  `production` environment hardening; new operator item **AI-9** tracks it before the
  first live automated deploy. OPEN AI-6/AI-7/AI-8/AI-9.

- **2026-09-27 (MD3 egress proof shipped)** — PR #114 (offline export proofs +
  two-part production-egress proof) merged as `df50e7a` with green exact-head CI;
  one Codex P2 fixed in-PR and a self-review vacuous-probe gap reworked into the
  split proof (`tests/pulse-egress.test.ts` in CI + `scripts/smoke-egress.mjs`
  per-deploy). Production was deployment `f97778db` from that anchor
  (immutable URL `https://f97778db.mdviewer-c9r.pages.dev`), smoke-verified live
  with SDK 3.3.0 byte-matching the lock, a clean Chromium boot, and an egress
  probe PASS (498 requests, all same-origin). Superseded by `bf04155f` above.
  OPEN AI-6/AI-7/AI-8 unchanged.

- **2026-09-27 (perf budget + SDK 3.3 shipped)** — PR #110 (large-doc performance
  budget, 250 kB confirm gate on all ingestion paths) merged with green exact-head
  CI and twelve triaged threads over seven review rounds; owner PRs #111/#112
  (SDK version from lock, SDK 3.3.0 sync) rode along and were reviewed
  retrospectively. `main` was `a56b2f5` and production was deployment `c3509120`
  from that anchor (immutable URL `https://c3509120.mdviewer-c9r.pages.dev`),
  smoke-verified live. Superseded by the `f97778db` deploy above.

- **2026-09-26 (SDK 3.2 shipped)** — PR #107 (Pulseboard SDK 3.2.0 rebuild: campaign
  allowlist, preview-pane scroll depth, no cross-tab focus steal) merged with green
  exact-head CI, a completed Codex Cloud review, and an owner coordinator gate. `main`
  is `b566e23` (CI run `36278869189` green) and production is now deployment
  `f73c4f85` from that anchor (immutable URL
  `https://f73c4f85.mdviewer-c9r.pages.dev`), smoke-verified live with SDK 3.2.0
  sending `campaign: "other"` and no verbatim leak. OPEN AI-6/AI-7/AI-8 unchanged.

- **2026-09-26 (Pulseboard SDK shipped)** — PR #105 (Pulseboard SDK 3.1 install with
  the consented Beta bar, inline pill slot, runtime enum guards) merged with green
  exact-head CI and nine triaged Codex threads, shared-review with the owner. `main`
  is `0da2e26` (CI run `36277132449` green) and production is now deployment
  `cdc831b1` from that anchor (immutable URL
  `https://cdc831b1.mdviewer-c9r.pages.dev`), smoke-verified live including a real
  bar render. New operator item AI-8 (Beta-bar acceptance) joins OPEN AI-6/AI-7.

- **2026-09-26 (improvement loop shipped)** — PRs #100 (docs-sync), #101 (TECH-1
  phone toolbar strip), #102 (theme-color follow, incl. a prototype-chain fix),
  and #103 (running-header/titlePage e2e) all merged with green exact-head CI and
  reviewed threads. `main` is `578590c` (CI run `36271782617` green) and production
  is now deployment `c3dee6ad` from that anchor (immutable URL
  `https://c3dee6ad.mdviewer-c9r.pages.dev`), smoke-verified live. AI-6 and AI-7
  remain OPEN for the operator.

- **2026-09-26 (checklist fix merged; redeploy pending)** — PR #98 (deploy record for
  `f353480c` from `4e7d99a`) and PR #99 (checklist pagination fix: `li` fragments like
  `p`, inline code no longer hyphenates; the 610-line owner todo list went 20→16 pages
  with worst non-last trailing blank 76%→4%) both merged with green exact-head CI and
  reviewed threads. `main` is now `4115563` (CI run `36267035533` green) but production
  still serves `f353480c` from `4e7d99a` — the checklist fix is not live yet. A redeploy
  is queued after the improvement loop (TECH-1 toolbar done in #101, theme-color
  done in #102, header e2e in #103; redeploy next).
  AI-6 and AI-7 remain OPEN for the operator.

- **2026-09-26 (maintenance + deploy)** — The review/dependency queue is clear and
  production is fresh: PR #94 (archive provenance via `MDVIEWER_SOURCE_ID`, closes #62),
  PR #95 (Mermaid 12 with the v11 rendering pinned; supersedes #74), PR #96 (orchestrator
  header refresh, #59 part A), and PR #97 (6-package patch sweep) all merged with green
  exact-head CI and reviewed threads. `npm audit` reports 0 vulnerabilities. Production is
  now deployment `f353480c` from `main` `4e7d99a` (immutable URL
  `https://f353480c.mdviewer-c9r.pages.dev`), smoke-verified live: identical stable/immutable
  bytes, immutable hashed assets, `max-age=0, must-revalidate` on `/sw.js` and
  `/manifest.webmanifest`, immutable `/workbox-*.js`, security headers present, and a real
  Chromium boot to the empty state. The #59B header disagreement is superseded by this dated
  record; what remains is the real-browser install/update-toast half (AI-7 step 5), which
  this redeploy freshly enables. TypeScript 7 is deliberately deferred (major version).
  AI-6 and AI-7 remain OPEN for the operator.

- **2026-08-16 (QA sweep)** — The manual QA report (`mdviewerqareport.md`, run against the
  outdated July deployment `7f4eedf`) drove a full fix sweep on branch `qa-sweep-20260816`:
  all 9 functional bugs, the UX-feel items, and the tech items addressed or explicitly
  ledgered (see `docs/agentic/failure_ledger.jsonl` 2026-08-16 entries for the four accepted
  deferrals). The app is now an installable PWA that works fully offline. Verified locally:
  typecheck, lint, 334+ unit tests, full Chromium E2E on dev and production-preview targets
  including both no-cutoff tests and the new offline test. The sweep merged into `main` as
  PR #48 (merge commit `8a9c942`, CI green after pinning a 1600×900 viewport for the two
  single-row toolbar E2E assertions that wrapped on CI Linux's wider fonts) and **is now the
  live deployment** — `wrangler pages deploy` ran 2026-08-16, immutable URL
  `https://3378378d.mdviewer-c9r.pages.dev`, smoke checks green (AI-7 steps 1–3).
  What remains of AI-7 is the in-browser manual acceptance (steps 4–8).

- **2026-08-12 (licensing)** — Current and future owner-authored MDviewer code is
  `GPL-3.0-only`; the historical MIT grant remains valid for earlier revisions.
  Production builds now carry the GPL text, exact corresponding-source link,
  project notice, and installed dependency licence texts. AI-6 remains OPEN.

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

- **#169 (signing box) — Decide code-signing and distribution policy before a public release.** PARKED
  until a public release is planned. Owner decision only; agents prepare the options when asked.
  Track it in [#169](https://github.com/Chris0Jeky/MDviewer/issues/169).

- **AI-9 — Harden the `production` environment before the first live automated deploy.**
  `.github/workflows/deploy.yml` has only run as `dry_run`. The old PR #116 path
  created an **unprotected** `production` environment; PR #126 now isolates dry runs
  from environments/credentials and transfers the exact tested artifact. Real dry
  acceptance passed on 2026-10-02 (runs 37075799089 and 37076144920), with live jobs
  skipped, no pending approvals or new production records. The in-workflow main-only
  guard is not a control (a dispatch runs the workflow file from its own branch), so the
  environment settings are what keep the Cloudflare token off other branches. Full
  steps: docs/DEPLOYMENT.md "Automated deploy".
  1. GitHub → Settings → Environments → `production` (create it if absent).
  2. Deployment branches and tags → Selected branches → add `main` only.
  3. Required reviewers → add yourself (live runs wait; the separate dry job has no environment).
  4. Environment secrets → add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
     If you already added them as repository secrets, delete those copies.
  5. Actions → Deploy → Run workflow on a reviewed branch or `main` with `dry_run=true`;
     confirm it goes green without production approval or a new deployment record.
     Then run once live from `main`, approve, and run the live smoke in
     docs/DEPLOYMENT.md.
  6. Reply "AI-9 is done" (or report what failed).

## Delegated to agent QA (owner decision 2026-11-13)

On 2026-11-13, two minutes into AI-10, the owner found two bugs the automated suites had missed
(#334, #335) and decided, in the owner's words: "these checks... I think we can automate them via QA testing
and sessions with agents. This is not a good use of my limited time at the moment, clear the action
points like these, please". This supersedes the same day's choice to defer AI-6 and AI-7 until after
the web redesign.

**Delegated is not accepted.** These items left the owner's list; they did not pass. Each shows its
status: *not run*, *automated in CI* (with a link), *agent session run* (with evidence) or *defect
filed* (with issue numbers). The QA lane owns them; charters and latest results live in
`docs/qa/ACCEPTANCE.md`. Anything no agent can check is recorded as "not verified (no agent can check it; owner decision 2026-11-13 not to be asked)" and never sent back to the owner. In the former owner steps below, "you" and
"your own files" now mean the QA agent working on invented files only (never the owner's documents),
and the "Reply ... is done" and "only you can close this item" lines no longer apply: rule 5 above
says when a delegated item closes.

- **AI-10 — Try the Windows build on realistic (invented) files.** Delegated 2026-11-13.
  - **Status:** defect filed: the owner ran steps 1 to 4 on the CI portable build from `722cbbd` (run 43342508614) and found [#334](https://github.com/Chris0Jeky/MDviewer/issues/334) (a tick scrolls the reader) and [#335](https://github.com/Chris0Jeky/MDviewer/issues/335) (write-back Undo hard to find). Agent session run on `df946bc`: #334 reproduced (failing test attached), new #341, #342, #343; results in `docs/qa/ACCEPTANCE.md`.
  - **Not verifiable by an agent:** the owner's own documents stay private, so agents use an invented corpus modelled on agent-written Markdown; "confusing or missing" is judged by the agent, not the owner.
  - **Former owner steps** (charter source; no owner reply is expected any more):

  The reader can now
  change your Markdown (tick a task box, edit a line, save) and show JSON and transcripts as readable
  documents. Automated tests prove this on invented files; only you can judge it on real ones. Work
  on files you can afford to change: first make a backup copy of each one (or use a file in a Git
  folder, where `git diff` shows exactly what changed).
  1. Get the current Windows build: open [docs/WINDOWS_DESKTOP.md](docs/WINDOWS_DESKTOP.md), section
     "Get the app". In short, open the Windows Desktop workflow on GitHub, pick the latest successful
     run on `main` (artifacts expire after 30 days, so pick a recent one), download
     the `mdviewer-windows-x64` artifact (GitHub may ask you to sign in), extract it, and run the
     `*-setup.exe` installer or the portable `mdviewer.exe`. Windows may show an unknown-publisher
     prompt: these builds are unsigned previews.
  2. Open one of your own Markdown files that has a task list (lines like `- [ ] something`) with
     **Open** (Ctrl+O) or from Explorer. Do not drag it onto the window: a dropped file has no
     file of its own to write back to. Click one empty box. It should become ticked at once.
  3. Check the file on disk: open it in another program and compare it with your backup (or run
     `git diff`). Exactly that one box should have changed (`[ ]` to `[x]`) and nothing else,
     including line endings and blank lines at the end.
  4. Back in MDviewer, tick a second empty box and, **within about 10 seconds**, click **Undo** in the
     small notice that appears (it closes by itself after about 10 seconds unless the pointer rests
     on it). Compare the file on disk again: the second box should be empty again, exactly as before.
  5. Press **Edit** (Ctrl+E), change a line of text, and press Ctrl+S. Check on disk that your
     change was saved and the rest of the file is the same.
  6. Open one of your own `.json` files. It should appear as a readable document (a title, an overview
     line, tables or sections) rather than raw text. Press **Edit** to see the raw text, which Save
     writes unchanged.
  7. Open an agent or chat transcript (a `.jsonl` file, for example one a coding agent wrote). It
     should show a line such as "4 turns: 2 user, 2 assistant" and then one section per turn headed
     User or Assistant. Note anything confusing or missing.
  8. Reply "AI-10 is done" (or report what looked wrong: which file type, what you did, what you saw).

- **AI-8 — Pulseboard Beta bar on the live site.** Delegated 2026-11-13.
  - **Status:** agent session run on the live site 2026-11-13: steps 1, 2, 3 (payloads) and 5 (GPC) pass; step 4 passes on print CSS only (no print preview inspected). Delegated, not accepted: Pulseboard storage is not verified. Details in `docs/qa/ACCEPTANCE.md`.
  - **Not verifiable by an agent:** whether Pulseboard stores the events (a Pulseboard-side change); the SDK is inert under automation, so this needs a real browser session on the live site.
  - **Former owner steps** (charter source; no owner reply is expected any more):

  The
  Pulseboard SDK 3.1 install (PR #105, Pulseboard#105) is proven by unit
  tests and the artifact guard, but the SDK is deliberately inert under Playwright and off the
  production origin, so only the live site shows the real bar. Nothing is stored until Pulseboard
  lists `mdviewer` in `COLLECT_STAT_PROJECTS` and `COLLECT_PRODUCT_PROJECTS` (a Pulseboard change).
  After the merge is deployed to https://mdviewer-c9r.pages.dev:
  1. Open the site in a fresh private window. A one-line **Beta** bar sits at the top; the toolbar
     is directly below it and the page does not scroll.
  2. Open DevTools → Network. Click **Choose**: three switches appear. Click **OK**: the bar
     collapses to a small **Beta** button beside "Local session" in the toolbar (never over
     the editor or the page chip), and the toolbar moves up to the top. Click it: the switches open
     as a row under the strip; Escape closes them and returns focus to the button.
  3. Load the sample, switch view and theme, Print, and Download PDF. In Network, open each request
     to `pulseboard-observatory.commit-atlas.workers.dev` and confirm the payloads contain only the
     enums listed in README "Privacy and usage data" — no Markdown text, file name or heading.
  4. In the print preview, confirm neither the bar nor the Beta button appears on any page.
  5. With Global Privacy Control on (Brave, or Firefox's setting), reload: no bar, no request.
  6. Reply "AI-8 is done" (or report what looked wrong).

- **AI-7 — QA-sweep fixes on the live site.** Delegated 2026-11-13.
  - **Status:** partly run 2026-11-13 (steps 1 to 3 done for `bf04155f` on 2026-10-02): PWA installability and offline precache pass on the live site; most step-4 checks run in CI on the bundle; the install dialog, a network-off reload, print output and the update toast (waits on AI-9) are not run. Details in `docs/qa/ACCEPTANCE.md`.
  - **Not verifiable by an agent:** the stable-origin update toast (step 5) needs a second live deployment, which waits on AI-9.
  - **Former owner steps** (charter source; no owner reply is expected any more):

  Steps 1–3 are done
  again for the current deployment (2026-10-02): application `main` `51b9758`
  passed exact-head hosted CI and Windows qualification; deployed via the existing
  direct-upload path (immutable URL `https://bf04155f.mdviewer-c9r.pages.dev/`,
  id `bf04155f-f343-4f8a-b5cd-9bc78fff2977`);
  smoke checks passed — stable/immutable bytes match the qualified directory, entry title,
  security headers, `Cache-Control: max-age=0, must-revalidate` on both
  `/sw.js` and `/manifest.webmanifest`, immutable hashed Workbox, `/pulseboard.js`
  serving SDK 3.3.1 byte-identical to the lock hash, `/SOURCE.txt` naming the full
  `51b9758` revision, a clean Chromium boot (7 sample sheets, zero console/page
  errors), and an egress probe
  PASS (498 requests, all same-origin).
  (The `df50e7a`/`f97778db`, `a56b2f5`/`c3509120`, `b566e23`/`f73c4f85`, `0da2e26`/`cdc831b1`,
  `578590c`/`c3dee6ad`, `4e7d99a`/`f353480c`, and `8a9c942`/`3378378d` records
  are superseded but retained in `docs/DEPLOYMENT.md` history.)
  Remaining manual steps on **https://mdviewer-c9r.pages.dev/**:
  4. In a real browser on the live site: zoom 50%/100%/Fit works and `aria-pressed` follows;
     the page chip tracks scrolling; drop a `.txt` file → visible "skipped" banner; Download
     PDF shows progress and disables both export buttons; a settings change no longer resets
     your scroll position; footnotes sit at the foot of the page; a doc without `[[toc]]` gets
     its TOC after the H1 with dotted leaders ending at right-aligned numbers; task-list checks
     are clearly visible; an empty `.md` shows the "document is empty" notice.
  5. PWA: install from the address bar (icon + name correct), DevTools → Network → Offline →
     reload → load the sample → Print/Save-as-PDF still produces page sheets. For the update-toast
     check, use a stable-origin session still running previous `f97778db`, then confirm the
     `bf04155f` update toast appears and Reload applies it. Immutable URLs have separate origins
     and cannot prove this stable-origin transition. If no older session remains, leave this
     step OPEN for the next operator-controlled upgrade.
  6. Theme/WYSIWYG: switch the app to the Dark screen theme — code on the page sheets must
     stay light (print-accurate), and a Download PDF taken in dark theme must contain light
     code. The theme control is now labelled "Screen" and sits at the right, before Export.
  7. Turn the new "Title page" toggle OFF — page 1 must now show the running header and page
     number (with it ON, current behavior: page 1 shows neither).
  8. Reply "AI-7 is done" (or report what looked wrong).
     Resolved 2026-09-26 (PR #101, closes QA TECH-1): the primary toolbar row is now
     a single-row strip at ≤760px (204px toolbar on a 375x667 phone, automated cover
     in `tests/e2e/responsive-toolbar.spec.ts`) — phone/tablet layout is no longer
     the deferred QA item. Residual trade-off: Export sits off the initial phone
     viewport until swiped or focus-scrolled into view.

- **AI-6 — Split workspace in a real browser.** Delegated 2026-11-13.
  - **Status:** not run by an agent; Chromium and Firefox authoring regressions run in hosted CI (`docs/design/AUTHORING_QUALITY.md`).
  - **Not verifiable by an agent:** how typing *feels* to a person; agents measure the proxies (input-to-paint latency, caret and token alignment) instead. Safari on macOS (no Mac on this host).
  - **Former owner steps** (charter source; no owner reply is expected any more):

  The split editor is
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

- **[#169](https://github.com/Chris0Jeky/MDviewer/issues/169) hands-on boxes — Windows install and uninstall, Explorer associations, keyboard and Narrator, printing.** Delegated 2026-11-13.
  The boxes stay unticked in #169 until agent evidence is recorded there. Install, uninstall and
  Explorer-association checks run only in Windows Sandbox, a virtual machine or a separate Windows
  account, never on the owner's account: the installer registers file associations and can replace
  the owner's installed copy and its app data. Where no such place is available they stay not run.
  - **Status:** not run. The native Windows smoke in hosted CI covers launch, Unicode paths, second-instance forwarding and saves ([WINDOWS_SMOKE.md](docs/design/WINDOWS_SMOKE.md)).
  - **Not verifiable by an agent:** a physical printer; the quality of real speech output; first-run behaviour on the owner's own ordinary account (agents never install there; they use Sandbox, a VM or a separate account).
  - The #169 performance boxes were never owner steps: they are agent measurement work tracked in #169 and #202.

- **AI-11, AI-12, AI-13 — web shell, PDF editing, new readable kinds.** Planned by the
  [complete push](docs/design/2026-11-13-complete-push.md) as owner tasks; they are QA charters instead.
  - **Status:** not run (the features have not shipped yet). The QA lane runs each charter on the first green build after its lane reports the feature merged.


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

- **AI-3 — Decide license and author** — DONE 2026-06-25; **SUPERSEDED 2026-08-12.**
  The repository owner's later decision licenses current and future owner-authored MDviewer code
  under `GPL-3.0-only`. The earlier MIT placeholder remains relevant only to revisions already
  published under it; see `RELICENSING.md` and `LICENSES/MIT.txt`.

- **AI-2 — Install Playwright browsers + run the E2E suite** — DONE 2026-06-25. Ran
  `npx playwright install chromium` + `npm run test:e2e` → **15/15 passing**, including
  `e2e/nocutoff.spec.ts` (no atomic block straddles a page boundary).

---

## Known dev follow-ups (agent-doable, tracked in the roadmap)

- **Bundle size:** Paged.js and curated extra Shiki grammars load on demand. Measured at `main`
  `87249e0`, the entry chunk is **1,603.59 kB** (512.43 kB gzipped) — the "~1.46 MB" figure carried
  here previously was stale. Further main-thread and Mermaid/Shiki splitting remains possible.
