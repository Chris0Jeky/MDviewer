# Failure Ledger — MDviewer

A human-readable view of recurring agent / tool / workflow failures. The source
of truth is `docs/agentic/failure_ledger.jsonl` (git-tracked, curated). Raw,
machine-captured failures land in `docs/agentic/failure_autolog.jsonl`
(gitignored) via the `PostToolUseFailure` hook.

Regenerate the table below from the JSONL with:

```
python scripts/agent_hooks/render_failure_ledger.py
```

## Classification

- **blocker** — work cannot continue until resolved.
- **non_blocking_risk** — work continues, but confidence is reduced.
- **pre_existing_noise** — unrelated but visible; do not let it mask new signal.
- **invalid_signal** — false alarm or stale; record so it is not re-investigated.

## Promotion rule

A ledger entry becomes a permanent guide update (CLAUDE.md / skill / index) only
when it is **reproducible, project-specific, and recurring**. One-off
environment hiccups stay in the ledger.

<!-- LEDGER:START -->
| Date | Class | Surface | Failure | Workaround | Future fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-06-25 | non_blocking_risk | scaffold | Bootstrap entry — ledger initialized with the project scaffold. | n/a | Replace with the first real finding. | closed |
| 2026-08-16 | non_blocking_risk | render | SLUGIFY stays ASCII-only: unicode-aware slugs would percent-encode into ids that handler.ts fillTocPageNumbers can no longer resolve after decodeURIComponent, silently killing preview TOC page numbers. Headings differing only in non-ASCII rely on markdown-it-anchor dedupe (-1 suffixes). | TOC text itself is fixed (headingText unwraps the headerLink permalink); a buildSource.test.ts test documents the ASCII-slug trade-off. | Make fillTocPageNumbers resolve encoded ids (or switch lookups to CSS.escape) before making SLUGIFY unicode-aware. | open |
| 2026-08-16 | non_blocking_risk | pagination | QA UX-10 (first half): keep-whole blocks can leave large trailing whitespace before a pushed block. Structural trade-off of the no-slice guarantee; the running-header half (wrong section title on pushed content) was fixed via string(doctitle, start). | Accepted as-is; shrink tier deliberately untouched (never shrink reflowing tables; SHRINK_LIMIT 1.15). | If revisited, only levers are SHRINK_SELECTOR/SHRINK_LIMIT in afterParsed, re-proving both nocutoff e2e tests. | open |
| 2026-08-16 | non_blocking_risk | export-ui | The export progress overlay is invisible in Markdown-only view mode because editor.css parks #canvas with visibility:hidden; disabled export buttons remain the only feedback there. | Buttons disable + aria-live announcements still fire in every view mode. | Surface export progress in toolbar/status chrome outside #canvas, or unhide a minimal progress element in Markdown mode. | open |
| 2026-08-16 | non_blocking_risk | pwa | PWA specifics unverified against the live Cloudflare deployment: /workbox-*.js splat rule in _headers, real-redeploy update-toast flow (verified only against a simulated redeploy on the local static server), and static light theme-color for dark-theme users. | Local preview-target e2e proves offline + precache; deploy smoke checklist extended in docs/DEPLOYMENT.md. | After next deploy: verify sw.js/manifest Cache-Control, workbox header match, install + offline + update-toast in a real browser (tracked as a manual gate in ACTION_ITEMS). | closed |
| 2026-08-16 | non_blocking_risk | ui | QA TECH-1 (High) deferred: no width-based media query in app.css; the toolbar (~7 groups, ~25 controls) overflows/stacks on tablet/phone widths. Session was wrapped up before implementation. | Desktop widths fixed (.toolbar-field layout, spacer right-aligns Export); the split workspace already stacks at the 720px breakpoint in editor.css. | Reuse the 720px breakpoint (never a second one): at <=720px make #toolbar a single scrollable strip - flex-wrap:nowrap, overflow-x:auto, overflow-y:hidden, overscroll-behavior-x:contain, min-width:0 on #toolbar and .toolbar-group (required: #app is an overflow-hidden grid), hide .toolbar-divider, narrow the header input and .doc-switcher, shrink --ctl-h to ~28px scoped to #toolbar, keep >=6px vertical padding so the 2px focus ring is not clipped. Add tests/e2e/responsive.spec.ts at 375x667 and 768px: documentElement.scrollWidth <= innerWidth, toolbar height cap, clickable export buttons, sample still paginates. | closed |
| 2026-08-16 | non_blocking_risk | pagination | string(doctitle, start) is unit-asserted only; no e2e proves the running header names the previous section for pushed content, and titlePage:false was not exercised end-to-end. | Both are pinned by cssBuilder unit tests; manual check added to the AI-7 gate. | E2E fixture engineered to push a tall block onto a new-heading page, asserting the .pagedjs_margin-top-right content; plus a titlePage:false e2e asserting page-1 chrome. | open |
| 2026-09-26 | non_blocking_risk | pwa | Remaining from the 2026-08-16 PWA entry (headers now verified live at f353480c): real-browser install, offline reload, and the update-toast flow were not exercised against the new deployment; theme-color is still hardcoded #ffffff (index.html, manifest) for dark-theme users. | Deploy smoke verified entry/asset/sw/manifest/workbox headers plus a Chromium boot to the empty state; offline precache is covered by preview-target e2e. | Operator runs AI-7 step 5 on the live stable URL (install, offline reload, update toast after this redeploy). Separately: make theme-color follow the screen theme or record why white stays. | open |
| 2026-09-26 | blocker | deploy | Stored Wrangler OAuth token had no pages scope: every /accounts/*/pages/* call failed with Authentication error 10000, blocking the production deploy. | Operator re-authorized via wrangler login (scope request includes pages:write); deploy f353480c then succeeded. | None required: credentials now carry pages:write. If API failures recur, re-check whoami token permissions before retrying. | closed |
| 2026-09-26 | pre-existing noise | test | tests/e2e/raster-resolution.spec.ts PNG-digest assertion fails on this Windows box (dark Markdown-only capture differs from baseline) but passes on CI Linux. | Proven unrelated to any session change: fails identically on unmodified main in an isolated worktree; hosted CI is the authority and is green. | If Windows-local raster work is ever needed, investigate headless-Chromium font/GPU rasterization differences on this machine. | open |
| 2026-09-26 | non_blocking_risk | ui | QA TECH-1 (High) CLOSED: the 2026-08-16 entry predates the workspace refresh, which had already fixed the overflow half (760px wrap rules + phone e2e) but left a 347px wrapped toolbar over a 192px preview on a 375x667 phone with a document loaded. | None needed: .workspace-actions is now a single-row horizontal strip at <=760px (flex-wrap:nowrap, overflow-x:auto, contain), reusing the existing toolbar breakpoint instead of adding one; doc-switcher capped at 168px; session row still wraps beneath. | Done: toolbar 347px->204px, workspace 320px->463px on 375x667; cover is tests/e2e/responsive-toolbar.spec.ts (verified red pre-fix at 347px). Residual trade-off: Export sits off the initial viewport mid-strip and is reached by swipe/focus scroll; accepted as the standard phone pattern. | closed |
| 2026-09-26 | non_blocking_risk | pwa | Hardcoded-white theme-color half of the 2026-09-26 PWA entry CLOSED: meta theme-color now follows the screen theme (light #ffffff, dark #1d2026, sepia #f7f0e1, mirroring --bg-toolbar) via src/app/themeColor.ts + the pre-paint script mirror. The install/offline/update-toast operator half stays OPEN under AI-7 step 5. | None needed. Manifest theme_color deliberately stays #ffffff (static manifest limitation, noted in vite.config.ts); unknown persisted themes degrade to light. | Done. Cover: tests/theme-color.test.ts, head-contract mirror pins, theme-color e2e incl. reload persistence. | closed |
<!-- LEDGER:END -->
