# MDviewer — Orchestrator State

> Single source of truth for the autonomous engineering loop. Resumable: a fresh session can
> read this file alone and continue. Keep entries terse and factual. Update at every checkpoint.

> **CURRENT CHECKPOINT — 2026-11-12 (Companion push close-out):**
> Every number below was read from GitHub (`gh pr list/view`, `gh issue list`) on 2026-11-12. Merged PRs are
> listed by area; open ones are marked **open**. Re-read GitHub before starting work.
>
> **State of main.** [`dc35c50`](https://github.com/Chris0Jeky/MDviewer/commit/dc35c5022562643888d5561c66f64d38b44ff5e1)
> (merge of #293). CI [43267320688](https://github.com/Chris0Jeky/MDviewer/actions/runs/43267320688) and
> Windows Desktop [43267320935](https://github.com/Chris0Jeky/MDviewer/actions/runs/43267320935) both completed
> **success** on it (read with `gh run list --branch main` after the push of #293). The previous main
> [`42426fe`](https://github.com/Chris0Jeky/MDviewer/commit/42426fe92f3c098890b490ac8ecb38a12b223792)
> (merge of #295) also passed CI [43266504555](https://github.com/Chris0Jeky/MDviewer/actions/runs/43266504555) and
> Windows Desktop [43266504492](https://github.com/Chris0Jeky/MDviewer/actions/runs/43266504492). Re-run
> `gh run list --branch main --limit 3` before relying on this.
>
> **What landed (merged), by area**
> - **Foundations:** native registry and command modules #225 (S0a); one document owner, command and panel
>   registries #224 (S0b); agentic setup sync #219, #220.
> - **Reader (S2):** front matter as a Properties card #221 (S2b); source map and copy toolkit #228 (S2a);
>   text first, then upgrade in place #232 (S2c).
> - **Shell (S3 to S5):** slim bar, tabs, More menu, palette, panel and status line #260 (S3); Library panel
>   #264 (S4); Edit surface, the source beside the live reader #271 (S5).
> - **Live reload and Save:** conflict-safe replace primitive #226 (S1a); owned Save and Save As #231 (S1b,
>   implements the #196 design; the issue is still open); live reload with a conflict bar #233 (S1c); relative links, `@imports`, local images
>   and back/forward #239 (S6); Library store and bounded project scan #235 (S4 native); session restore #241 (S7).
> - **Actionable Markdown** ([spec](docs/design/ACTIONABLE_MARKDOWN.md), spec PR #247): A1 parser and static
>   controls #252; A2 native line patch #244; A3 interaction with write-back and Undo #263; 1-based line fix
>   #268 (issue #266); native A3 smoke #275; A4 native template read `library_read_template` #285 (boundary
>   change); A4 New from template, picker and command #286; A4 wired to the native read #295.
> - **Readable data** ([spec](docs/design/READABLE_DATA.md)): D0 #269; D1 #270; D2 conversation lens #273;
>   D3 native #272 and webview #280; D4 parsers #281 (adds `yaml` 2.9.1), D4 native extensions #284, D4 webview
>   #288 (so YAML, TOML, CSV and TSV open as readable views); relative links open Markdown only #283; D6
>   readability pass #293; agent data files in the Library, `.claude/worktrees` skipped #290 (boundary change).
> - **Performance:** S9 part 1, tab switch back in about 50 ms and one sanitizer pass for code blocks #294.
> - **Pagination, export, CI, docs:** never drop or hide content when a block cannot stay whole #237; raster
>   PDF draws Tier 3 shrunk blocks as the preview does #261 (#258); Firefox selection scroll #267 (#227, #245);
>   code hyphenation #259; smoke progress sharing #222; Playwright install retry #238; state-docs sync for
>   Readable data and Actionable Markdown #287 (S8).
>
> **Also merged at close-out:** D5 pure copy module #289 (`src/data/copy.ts`: value, path, subtree; no webview
> yet) and the S9 polish pass #298 (library row actions, narrow drawer, sepia code). Main is 6329c7d, with CI and
> Windows Desktop green.
>
> **Open PRs from this push:** S9 part 2 #297 (native start-up numbers, first frame in the theme colour), left open
> at wind-down: its Windows build and native smoke job failed twice on head b0e3a23 (a save-dialog probe timeout
> in the export step, run 43266580940) while main's smoke was green; next step is a rerun or a look at that probe.
> Dependabot #216, #217, #218 are open with all six checks green and were not triaged in this push.
>
> **Next queue, in order**
> 1. D5 webview #299: copy menu (value, path, subtree) and Save readable view as Markdown, on the merged #289.
> 2. A5 #300: the embeddable reading element and its change event.
> 3. S9 polish pass #301: data views after D6, horizontal overflow first (the shell side merged in #298).
> 4. Native window theme background and closable during a slow start: #302, with the Core halves #304 (window
>    background follows the screen theme) and #305 (a close during webview start-up skips `canClose` and the
>    session flush). #297 supplies the webview half.
> 5. Native clippy #306: fix six lints and run clippy in the Windows desktop job.
> 6. Readable data hints and tests #296 (tera/peta byte keys, bare size, sub-second ms, line-label test); multi-document
>    YAML conversations map turns to root paths #291; Library Agent files group and batched seen marks #292 (with #265).
> 6a. Desktop e2e Ctrl+O chooser timeouts under load #303.
> 7. #197 recovery: parked, design only (see [RECOVERY.md](docs/design/RECOVERY.md)); needs fault, restart and
>    deletion evidence first.
> 8. Dependabot #216 to #218: open, green, to triage.
>
> **Other open follow-ups from this push:** #248 re-read racing a Save; #249 replace-journal recovery on open;
> #250 session-restore flush order; #251 library pin and Clear races; #254 A1 review follow-ups; #255 edits typed
> while a Reload is pending; #256 overlapping native re-reads; #257 re-read across a mode switch; #262 raster PDF
> nested Tier 3 container; #265 and #292 Library batching (`library_mark_seen`, bound the Agent files group);
> #276 live reload starving on a fast-appended log; #277 alternate-data-stream name in launch arguments; #278
> conversation lens accuracy; #282 memory before the display budget and YAML/CSV fidelity; #291 multi-document YAML
> conversations; #303 desktop e2e Ctrl+O chooser timeouts under load; #229 `replace.rs` hardening; #234 live reload; #236
> Library scan and store hardening; #240 file-policy device names; #242 pagination follow-ups from #237.
>
> **Human items:** AI-6, AI-7, AI-8, AI-9, AI-10 and [#169](https://github.com/Chris0Jeky/MDviewer/issues/169)
> are all **OPEN**; none was cleared. Nobody has accepted the companion features on real files (AI-10).
> Documents stay in memory except explicit saves and the Windows Library/session files of paths only. No
> signing, updater, deployment or performance claim follows. Local Windows builds and native checks:
> [WINDOWS_DESKTOP.md](docs/WINDOWS_DESKTOP.md#local-windows-builds-and-native-checks).
> Queue: [Future work](docs/FUTURE_WORK.md) / [#195](https://github.com/Chris0Jeky/MDviewer/issues/195).

## Historical checkpoints

> **HISTORICAL CHECKPOINT — 2026-11-12 (companion push; Readable data and Actionable Markdown):**
> Main [8984b9b](https://github.com/Chris0Jeky/MDviewer/commit/8984b9b7fa29a7d5bafc16f56b96597ef1c454ed)
> (merge of #281). CI [43221710538](https://github.com/Chris0Jeky/MDviewer/actions/runs/43221710538) and
> Windows Desktop [43221710658](https://github.com/Chris0Jeky/MDviewer/actions/runs/43221710658) passed on it.
> The Windows app is now a companion reader: Read, Edit, owned Save/Save As, live reload, Library, relative
> links and session restore are merged (#221, #224–#226, #228, #231–#233, #235, #239, #241, #260, #264, #271).
> **Actionable Markdown** ([spec](docs/design/ACTIONABLE_MARKDOWN.md)): A1 #252, A2 #244 and A3 #263
> are merged; #268 fixed the 1-based write-back line (#266) and the native A3 smoke #275 proves toggle and
> Undo with exact CRLF bytes in the Windows job. A4 templates is in progress: native template read #285 is merged and
> the picker/command #286 is open. A5 (embeddable element) is later.
> **Readable data** ([spec](docs/design/READABLE_DATA.md)): D0 #269, D1 #270, D2 #273, D3 native #272 and
> webview #280, D4 parsers #281 and Markdown-only relative links #283 are merged. The app opens `.json`,
> `.jsonc`, `.jsonl`, `.ndjson`, `.txt` and `.log` as readable views. D4 native extensions #284
> (YAML, TOML, CSV, TSV) merged. **Next:** the Experience-lane webview follow-up for D4 (await
> `prepare(kind)` at admission, widen `OPENABLE` in `src/app/renderText.ts`, the pickers), then D5 (copy
> value/path/subtree, agent data files in the Library, save the readable view as Markdown).
> Open issues from these slices: #276 (live reload starves on a fast-appended log), #277 (alternate data
> stream name in launch arguments), #278 (conversation lens accuracy), #282 (memory before the display
> budget; YAML/CSV fidelity), #254 (A1 review follow-ups); #262 (raster PDF, nested Tier 3 block) is
> separate. Queue: [Future work](docs/FUTURE_WORK.md) / [#195](https://github.com/Chris0Jeky/MDviewer/issues/195).
> **New human item AI-10** (try the build on your own files) joins #169 and AI-6/AI-7/AI-8/AI-9, all OPEN.
> Documents stay in memory except explicit saves and the Windows Library/session files of paths only. No
> signing, updater, deployment or performance claim follows. Re-read GitHub before starting work.

> **HISTORICAL CHECKPOINT — 2026-11-05 (Windows editor follow-up qualified):**
> Application revision [18afeeb8](https://github.com/Chris0Jeky/MDviewer/commit/18afeeb8df7f7448d5241de50ff00db1d56f9697),
> tree `2ede86cc07caf53a8afb3106716ece69c49d8a41`. #209/#210/#208/#213/#212/#211/#214 are merged.
> Delivered: compact native-Undo Markdown commands; bounded in-session source,
> preview and reader positions; document switching; visible PDF progress/save
> outcomes; production Firefox/accessibility regressions; authored-heading
> isolation from app CSS and feedback. Native reader startup remains lazy.
> [CI 42107298155](https://github.com/Chris0Jeky/MDviewer/actions/runs/42107298155)
> and [Windows 42107298588](https://github.com/Chris0Jeky/MDviewer/actions/runs/42107298588)
> passed all six jobs: 1,073 units per Node lane, 178 web cases
> with five existing optional performance skips, 94 Firefox,
> 36 desktop cases, 22 Rust and 21 probe-policy tests, 117 publication
> assertions in each PowerShell runtime, and actual native saves. Exact source,
> binary, saved-output and review receipts are in the
> [editor follow-up checkpoint](docs/design/2026-11-05-editor-followup-checkpoint.md).
> **Next:** [Future work](docs/FUTURE_WORK.md) / [#195](https://github.com/Chris0Jeky/MDviewer/issues/195).
> #196/#197 designs are merged; owned writes require the Windows compare/replace
> proof, and recovery requires identity/fault/deletion and measured-write evidence.
> #201 cancellation, #202 profiling, #204 Unicode IDs, #206 upstream accounting
> and #205 pagination research remain open. Documents stay in memory except
> explicit Save Copy/PDF operations; no recovery storage was added.
> **#169 and AI-6/AI-7/AI-8/AI-9 remain OPEN.** The deployment anchor is unchanged.
> No signing, updater, human acceptance or comparative performance claim follows.
> Re-read GitHub before starting work; older checkpoints below are historical.

> **HISTORICAL CANDIDATE SLICE — 2026-11-05, #203:** production Firefox authoring lane and
> accessible keyboard/contrast/reflow regressions prepared from main `5cb2dbb3`.
> Local 832 units, four server tests, types/lint/Observatory, both builds and 39
> Firefox 157.0 cases pass. Forced-colors Find visibility is corrected. Exact-head
> hosted CI and independent review are still required before merge; see the PR
> and `docs/design/AUTHORING_QUALITY.md`. This does not clear any human gate or
> change the verified application/deployment anchors below.

> **HISTORICAL CHECKPOINT — 2026-11-05 (verified application and explicit future backlog):**
> Application baseline [main `203c0979`](https://github.com/Chris0Jeky/MDviewer/commit/203c09798b01061ceb0c00f0937c22beeafb1a55),
> tree `8fe8e94f9cde0a52f3344075f0c272f140825ccb`. All nine PRs
> #183/#187/#185/#188/#192/#178/#191/#193/#194 are merged. Postmerge
> [CI 42053738540](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053738540)
> and [Windows 42053740244](https://github.com/Chris0Jeky/MDviewer/actions/runs/42053740244)
> passed all five jobs: 832 units per Node lane, 130 web cases with five optional
> performance skips, 27 desktop cases, and 22 Rust tests plus actual native smoke.
> All 330 source blobs match the authoritative tree; the portable executable hash
> matches the native-tested executable. Exact downloads/checksums are in #169.
> New, guarded undo, Find/Replace and visible matches, compact desktop controls,
> readiness-safe Save, offline PDF qualification and Shiki 4.6 are implemented.
> Documents remain memory-only except explicit user-requested saves; Save Markdown
> writes a copy and does not reset the original-source dirty baseline.
> **Next work:** [docs/FUTURE_WORK.md](docs/FUTURE_WORK.md) and [tracker #195](https://github.com/Chris0Jeky/MDviewer/issues/195).
> Start with hidden-preview export feedback (#200) or the file-lifecycle design
> (#196); optional recovery (#197) depends on a reviewed identity/storage contract.
> Formatting (#198), in-session navigation (#199), second-engine/accessibility
> regressions (#203), raster cancellation (#201) and measured responsiveness (#202)
> have separate acceptance criteria. The tracker also links the remaining ledger work.
> **#169 and AI-6/AI-7/AI-8/AI-9 remain OPEN.** No live deployment, signed release,
> automatic updater or comparative RAM/startup claim follows. Older checkpoints below
> are history, not live queue state; re-read GitHub before starting any issue.

> **HISTORICAL CHECKPOINT - 2026-11-05 (authoring and offline PDF capture qualified):**
> Last merged authoring baseline verified for this record:
> [280c73e2](https://github.com/Chris0Jeky/MDviewer/commit/280c73e26487b16d7de607c269b2839636b0b969),
> tree `89d93bf31fbdff3db87725cd6726d57199a09b56`. New (#183), guarded editor
> mutations (#185), compact writing space (#187), Find/Replace (#188), and desktop
> entry readiness (#192) are merged. Save Markdown continues to save a copy; reader
> startup stays lazy and human acceptance remains separate from automated checks.
> Offline [#178](https://github.com/Chris0Jeky/MDviewer/pull/178) merged from reviewed
> head `a9664f9b`; #174 is closed. The exact html2canvas-pro 2.6.0 pin and removal of
> its temporary Dependabot exclusion are now on main. All five final jobs passed:
> 818 units, 127 web cases with five existing optional performance skips, 27 desktop
> cases, and 22 Rust tests plus actual native smoke. Review checked saved-PDF pixels,
> damaged-output controls, real CSS/font cache-loss refusal and restored-cache recovery,
> persisted recovery JSON, the 323-blob source artifact/TREE, two native Save dialogs,
> exact Markdown bytes, PDF header/EOF and clean teardown. See
> `docs/design/RASTER_OFFLINE_CAPTURE.md` and PR #178 for the evidence and scope.
> Main `85f7361e` postmerge CI `42046588461` and Windows `42046589174` also passed all five jobs.
> Active-match [#191](https://github.com/Chris0Jeky/MDviewer/pull/191) is merged and
> #189 closed. Reviewed head `e8ef574a` includes capture/readiness and the measured line-height correction.
> The original green candidate was held because real screenshots showed the cue
> below matching text in a large plain source. All five corrected-head jobs passed:
> 830 units, 130 web cases with five optional skips, 27 desktop cases, and 22 Rust tests plus native smoke.
> Independent source/visual review approved the actual corrected screenshot and matched
> all 327 source blobs/TREE, including desktop screenshots at short and laptop sizes.
> Shiki 4.6 dependency qualification is recorded separately in
> [#193](https://github.com/Chris0Jeky/MDviewer/pull/193). Its initial Node failure was
> traced to jsdom's missing `Blob.stream()`; a normal supported-Node install worked.
> Consult that PR for the test-environment correction, final head and qualification receipts.
> Windows acceptance/performance #169 and AI-6/AI-7/AI-8/AI-9 remain OPEN. No live
> deployment, signed release, automatic updater or comparative RAM/startup claim follows.
> Exact anchors and remaining work: `docs/design/2026-11-05-authoring-checkpoint.md`.

> **HISTORICAL CHECKPOINT - 2026-11-05 (desktop authoring and offline capture):**
> Integration basis is merged main `7f6db5d2d6ee541e6ab2fc7baf8250f03f76fd78`.
> New documents (#183), guarded native editor mutations (#185), compact desktop
> writing space (#187), Find/Replace (#188), and desktop entry readiness (#192)
> are merged. #192 fixes controls becoming available before their transition could
> accept a Save click. Its five hosted jobs passed, including both real native Save
> dialogs, exact Markdown bytes and PDF header/EOF; its verified source TREE matches
> the reviewed head. The failing main and PR-integration artifacts remain in #190.
> This source tree integrates #178's exact html2canvas-pro 2.6.0 capture adapter and
> removes the temporary 2.6.0 Dependabot exclusion. Offline controlled sources use
> an owned controlled `srcdoc` destination; real CSS/font failures still save no PDF.
> Browser checks associated with `268bcb8f` passed 127 cases with five existing optional
> skips, including saved-PDF pixels, damaged controls and actual CSS/font cache-loss
> recovery. Its native readiness failure is addressed by the inherited #192 fix.
> Final combined-head review, all five checks and source provenance remain mandatory
> before this integration merges; PR #178 records those final receipts. See
> `docs/design/RASTER_OFFLINE_CAPTURE.md` for lifecycle evidence and limits.
> Active-match visibility #189 / draft #191 remains separate: its initial jobs passed,
> but screenshot review found large plain-source misalignment. The stronger geometry
> regression must pass and the actual screenshots must align before that work merges.
> Windows acceptance/performance #169 and AI-6/AI-7/AI-8/AI-9 remain OPEN. No live
> deployment, signed release, automatic updater or comparative RAM/startup claim follows.

> **HISTORICAL CHECKPOINT - 2026-11-05 (recoverable export error feedback):**
> Based on merged main 8265edd4, including the workspace correction #177 and CLI
> update #176. This checkpoint implements #179 in PR #180: fatal feedback is visible
> and actionable in Markdown-only mode while the preview remains parked. Showing
> a fatal error returns only the canvas to its origin instantly; view mode, Markdown
> text, and the source editor's selection and scroll remain unchanged. A successful
> raster save clears only fatal feedback before releasing export ownership, preserving
> render warnings and ingestion notices. Failed or canceled saves retain feedback.
> Test-only head 59a5166 reproduced hidden and stale cards in
> [CI 41960323747](https://github.com/Chris0Jeky/MDviewer/actions/runs/41960323747).
> The second test-only head dcb9ef5 reproduced an error above the scrolled canvas
> before any test click/focus in [CI 41961453874](https://github.com/Chris0Jeky/MDviewer/actions/runs/41961453874).
> Local qualification passes 706 unit tests, four server tests, typecheck, lint,
> Observatory and both production builds. Final exact-head hosted qualification
> and failure/recovery screenshot review are recorded in PR #180.
> html2canvas-pro remains pinned to 2.5.2. Draft #178 and offline raster fidelity
> issue #174 remain blocked/open; this feedback fix does not qualify their output.
> Windows acceptance/performance issue #169 and AI-6/AI-7/AI-8/AI-9 remain OPEN.
> No deployment, signed-release or comparative performance claim is made.

> **PREVIOUS CHECKPOINT - 2026-11-05 (workspace labels and dependency handoff):**
> Base main 2a26940d includes merged reader grammar PR #172 and development dependency
> PR #173. This checkpoint implements the independently reviewed workspace/shared
> parsed-fence correction for #171. Final exact-head hosted qualification is recorded
> in its PR. Local qualification passed 704 unit tests, four server tests, typecheck,
> lint, Observatory, both production builds, hook smoke checks and validation of all
> 14 skills after a clean engine-strict offline install. The production precache
> matches all 181 expected assets without duplicate, missing or incorrect revisions.
> Production audit reports zero findings; the full audit retains four low entries
> from the rejected deepmerge CVE described in docs/DEVELOPMENT_DEPENDENCIES.md.
> PR #165 merged as [2a26940d](https://github.com/Chris0Jeky/MDviewer/commit/2a26940d4c1da3e6c770b47111538726fc882d12)
> from reviewed head [bd9d0769](https://github.com/Chris0Jeky/MDviewer/commit/bd9d0769cbbc4976b7d8b2bd360bb3277774330c)
> after all five exact-head checks passed: [CI 41956789157](https://github.com/Chris0Jeky/MDviewer/actions/runs/41956789157)
> and [Windows 41956789138](https://github.com/Chris0Jeky/MDviewer/actions/runs/41956789138).
> It keeps the exact html2canvas-pro 2.5.2 pin, advances KaTeX to 0.19.1 and excludes
> only html2canvas-pro 2.6.0 from Dependabot pending #174. The 2.6 capture candidate passed the online CSS regressions
> but failed an offline stylesheet request; issue #174 tracks both its follow-up and
> offline saved-PDF visual fidelity on the current exporter. Pinning 2.5.2 does not
> prove that offline styles/assets are captured correctly.
> AI-6/AI-7/AI-8/AI-9 remain OPEN. Windows human acceptance and representative
> performance work remain open in #169; no comparative RAM/startup, signed-release
> or deployment claim is made. The historical deployed-source anchor is unchanged.

> **PREVIOUS CHECKPOINT - 2026-11-05 (workspace fence preparation, unpublished follow-up):**
> Prepared after reader grammar PR #172 head 42244b9, merged as e4711f54, for issue #171.
> Real App/engine tests reproduced missing first-render colors for escaped/entity C#
> labels and blockquote fences, plus unwanted grammar loads from literal code examples.
> App now parses once without installing Shiki, prepares the actual decoded fence
> languages, checks its render token, then installs Shiki and renders the same tokens
> and environment. Late installation preserves Shiki's loaded-language snapshot.
> Shared fence rendering now matches preparation for uppercase/prefixed labels and
> encoded Mermaid. Single-decode guards retain unknown literal labels, existing
> lowercase alias classes and metadata. Reader and eager output both have controls.
> List/footnote rendering, delayed preparation, captured settings, stale renders,
> export ownership and notice/telemetry controls retain regression coverage.
> This follow-up remains unpublished pending independent review and fresh exact-head
> hosted checks. It makes no deployment, RAM/startup or manual-acceptance claim.

> **PREVIOUS CHECKPOINT - 2026-11-05 (scoped development dependency advisories, prepared):**
> Reader grammar PR #172 is merged; this follow-up is based on main
> e4711f54b4dc3f0fd8fd37711a9cbb4721781b94 and preserves that grammar source,
> workspace behavior and status documentation. Four parent-scoped overrides
> coordinate minimatch 11.0.4 for ESLint/config-array/typescript-estree with glob
> 14.0.3 for Workbox. The production dependency graph and unaffected filelist /
> minimatch 5 branch are preserved. Five bounded advisory regressions failed on
> the earlier baseline while three actual-consumer compatibility controls passed;
> all eight pass after the migration. Checks cover ESLint discovery/ignores,
> Workbox precache revisions/exclusions/directory links, globstar budgets and
> cancellation. The primary CVE record rejects deepmerge CVE-2026-93753; retain
> and explain stale audit residue rather than suppressing it. Sources and override
> removal criteria are recorded in docs/DEVELOPMENT_DEPENDENCIES.md.
> Combined local qualification passes typecheck, lint, 686 unit tests, four server
> tests, Observatory and both production builds. The generated precache contains
> exactly 181 expected files. A clean engine-strict offline installation passes.
> The production audit reports zero findings; the full audit retains four low
> entries from the rejected deepmerge CVE. Independent final review and exact-head
> hosted CI remain required before merge; this checkpoint claims no publication
> or deployment. Existing human acceptance items remain open.

> **PREVIOUS CHECKPOINT - 2026-11-05 (reader grammar preparation, unpublished follow-up):**
> Prepared on #162's final tree 4f64b676, now main d09817cd, including its decoding
> and notation fixes. Reader code prepares requested grammar modules and their bundled
> dependencies; all existing themes remain ready. A separate workspace readiness
> promise preserves the eager common-grammar contract on the same engine. Concurrent
> aliases share registration; engine, grammar and workspace failures remain retryable.
> Modules with optional embeds retain the common-language compatibility set: Markdown,
> Ruby/HAML, Vue, Svelte and LaTeX. The workspace path bypasses that fallback to avoid
> waiting on its own promise. Real-engine tests cover handoff orders, concurrency,
> retries, plaintext transformers and embedded-language output parity. Desktop browser
> coverage checks C# asset admission followed by the full Edit & PDF workspace.
> This is prepared source, not a published PR, measured RAM/startup result or deployment.
> Fresh independent review, exact-head hosted web/desktop checks and native smoke remain
> required. Existing manual acceptance items remain open.

> **PREVIOUS CHECKPOINT - 2026-10-26 (Windows reader action notices):**
> PR #158 head 2dda4de reproduced three mixed-notice failures locally: workspace-entry
> errors disappeared after recovery warnings/failures, and Sample admission errors
> disappeared after retained-document warnings. Both handlers now pass their action
> errors to the existing render path; notice/render generation fences are unchanged.
> The existing regressions remain intact. Fresh exact-head CI, production browser
> checks, Windows native smoke and independent review remain the merge gates; consult
> PR #158 for their current results. This repair includes no #162 performance work,
> deployment or human acceptance. AI-6/AI-7/AI-8/AI-9 remain OPEN.

> **PREVIOUS CHECKPOINT — 2026-10-21 (Windows reader ownership and native verification):**
> All original open issues/PRs are resolved: #155/#156/#157/#159/#160 merged;
> #136 closed after the PDF readiness/footnote and dependency fixes. Main at this
> checkpoint is 22435ce. Windows reader PR #158 remains the active feature review.
> Its final review found retained closed source text and an Undo Close admission
> bypass. The reader now releases its old sources after a safe workspace handoff;
> workspace baselines follow current document IDs and are cleared on successful
> return. Undo checks current document count and UTF-8 bytes before consuming its
> one retained recovery offer. Unknown restored identities remain dirty. Failed
> return validation preserves the workspace; failed teardown restores the same
> document objects, selection and baselines. Inert workspace controls and captured
> shortcut clicks prevent last-moment actions racing that ownership transaction.
> The frozen correction passed 624 unit tests, four server tests, typecheck/lint,
> Observatory, both production builds, all 15 desktop browser scenarios, and six
> existing web Undo Close scenarios. Independent review verified all eleven file
> hashes and reran 21 focused ownership/recovery/session tests successfully.
> Windows runs at 24716610 and 734c64ef verified actual first-file rendering,
> Unicode/UTF-16 second-instance forwarding, one retained host, the editing workspace
> and a native Save dialog. Its filename-control lookup remains under test; bounded
> UIA result/phase metadata and screenshots distinguish test-helper failures from
> product failures. Native tests/builds pass; native saved-file verification remains
> required before merge. Exact-head CI, independent final review and the actual
> Windows smoke are the merge contract; consult PR #158's latest checks/artifacts.
> No comparative RAM claim, signed-release claim or live deployment is made.
> Human Windows install/uninstall, default handler, print-driver and owner-hardware
> comparison remain open, as do AI-6/AI-7/AI-8/AI-9. A separate prepared follow-up
> defers reader code-engine initialization for ordinary notes; it is not included
> in this ownership correction.

> **PREVIOUS CHECKPOINT — 2026-10-21 (Windows reader integration):**
> Owner requested all-open-issue/PR review plus a lightweight Windows desktop direction.
> Production dependencies #155 merged as 7b6f527; development dependencies #156 as
> f22308b; Node 24/dependency hardening #159 as 3c4f09c. Both npm audits are clean.
> PDF fixes #157 and #160 merged as e81f785 and 22435ce, closing #136 after actual
> downloaded-PDF pixel regressions and independent review. #160's exact-head CI
> passed 602 unit tests and 113 production Chromium tests (five existing opt-in
> performance skips). Its clone stylesheet readiness, cleanup and footnote numeral
> fixes are integrated here with the native export destination preserved.
> This branch adds a separate continuous Windows reader, Tauri/WebView2 host,
> bounded native input, single-instance forwarding, explicit native exports and
> CI-built portable/NSIS artifacts. Documents remain memory-only until saved;
> the native entry loads neither the SDK nor a service worker. Editing and paginated
> PDF tools load on demand. The reviewed integration passed 58 focused units and
> all 13 desktop production browser tests, including actual PDF/CSP pixels.
> Windows CI passed 22 native tests and built the executable and a 4.75 MiB installer.
> Diagnostics traced the first smoke failure to Windows PowerShell 5.1 evaluating
> a script-directory-dependent parameter default before that directory was available.
> The default is now initialized only in the parent PowerShell 7 branch; worker exit
> codes, bounded stdout/stderr and phase records are retained for diagnosis.
> A 2026-10-21 live OSV scan covered all 253 resolved Windows dependency crates,
> including release features, with no advisory matches. Linux/BSD-only lock entries
> have separate GTK/D-Bus findings; no Linux/BSD distribution is provided here.
> All required web checks, desktop Chromium, real Windows launch/forward/native
> save smoke and independent exact-head review remain the merge contract. Consult
> the latest PR Actions logs and Windows smoke artifact for authoritative results.
> No comparative RAM claim, signed release or live web deployment is made.
> AI-6/AI-7/AI-8/AI-9 remain OPEN. Ordinary Windows install/uninstall, default-file
> handler, preferred print driver and owner-hardware comparison remain acceptance
> work. Usage/contracts are in `docs/WINDOWS_DESKTOP.md`, spec §14 and
> `src-tauri/README.md`.

> **PREVIOUS CHECKPOINT — 2026-10-21 (PDF capture readiness and footnote numerals, prepared):**
> Standalone follow-up based on main `3c4f09c8d7befb6fcd7a5a739efa72bd71cf90a2`
> after hardening #159 merged. The package pair and workflows are unchanged from
> that main. Capture now waits for cloned CSS and newly used fonts under one
> ten-second onclone readiness budget, releases a failed iframe, and paints the
> missing default Paged.js footnote numerals only in the disposable clone.
> Linked citation numbers preserve repeats/generated IDs; temporary baseline
> probes handle tall inline content and are removed before capture. Geometry
> guards reject probing or paint that would move original note content.
> Red evidence: all twelve numeral regions were blank in an actual two-page PDF;
> review also exposed top-edge placement failing for a tall inline image. Both
> are now green, with a second downloaded PDF hiding only numeral paint failing
> every marker region. Production Chromium 156.0.8078.47: 12/12 focused tests pass,
> including double digits, ID collisions, a block-first note, delayed CSS pixels,
> failure/retry cleanup, resolution and all three no-cutoff cases. Local Node
> 24.19 agent check passes typecheck/lint, 602 unit/four server tests and Observatory
> guard. Production build passes with archive label `pdf-followup-3c4f09c-uncommitted`.
> Independent review found the baseline issue, re-reviewed its correction and ran
> 11 marker/readiness units successfully. Poppler-rendered Print and downloaded
> pages were visually checked. This is not a total-export timeout or arbitrary
> CSS-counter implementation. No native save adapter is included. Remote exact-head
> CI/review and AI-6/7/8/9 remain required; no deployment or human acceptance claimed.

> **PREVIOUS CHECKPOINT — 2026-10-21 (dependency/PDF merges; hardening in progress):**
> Production dependency PR #155 merged as `7b6f5278aef96bdb9d6cfd0a4d62bfb6f076e5c6`;
> raster PDF regression PR #157 merged as `e81f785907a1f87b67d80db51c152e9b46ccd7e2`;
> development dependency PR #156 merged as current main
> `f22308bab178794ca3029c81d38ea4dcb48f1fef`. Each passed all three required
> checks on its reviewed head. #156 incorporated the preceding merges without a
> rebase; its final head `76c4e2ab730c307e9294e70ee94fabcdaf80e05b` passed 589
> unit tests on each Node lane and 111 production Chromium tests.
> Follow-up hardening from that main tree raises supported Node to
> `^24.15.0 || >=26`, uses strict Node 24 installs for production verification,
> and retains the existing Node 22 required-check context as a legacy compatibility
> probe pending branch-protection updates. A narrow `$katex` override shares the
> direct 0.19 renderer with the Markdown wrapper; `fast-uri` is locked to 3.1.9.
> Two behavioral security regressions failed on the baseline and pass after these
> fixes. Local Node 24.19 strict install, typecheck/lint, 591 unit/four server tests,
> Observatory guard, build, hook smoke and 14 skill validations passed; full and
> production-only npm audits report zero findings. The local build uses the honest
> archive label `dependency-hardening-from-f22308`. Hosted exact-head CI and final
> independent review remain required for the hardening PR. No deployment was made;
> production identity and AI-6/7/8/9 acceptance gates remain as recorded below.

> **LOCAL CHECKPOINT — 2026-10-15 (issue #131, uncommitted):**
> Worktree `C:/Users/jekyt/source/mdv-131`, branch `fix/late-file-read-focus-131`,
> base HEAD `2822ad0428135ce23c049b5b569ff5f50f399bd2`. No commit, push or deployment.
> File/paste requests now carry a monotonic focus generation; newer requests,
> active-document changes and edits invalidate older selection rights. Stale reads
> append passively through `DocStore.addBatch`; eligible batches select their first
> accepted file with one change notification. Teardown aborts subsequent batch work
> and ignores late reads, confirmations and notices. Editor's existing equal-text
> guard preserves caret/native undo for passive imports; render order is unchanged.
> Test-first evidence: baseline `npm run test` 529/529; two deferred drop/picker
> races failed on activeId before the fix. Two further teardown tests failed on late
> prompts/reads before adding lifetime cancellation. Final 546/546 unit tests pass
> (17 added), as do typecheck, lint, four server tests, Observatory guard, hook smoke
> and all 14 skill validations. Production Chromium: 110/110, no retries/skips,
> including the new focus/selection/native-undo regression, all three no-cutoff
> cases and both exports. The browser test uses one native typed character because
> Chromium need not group multiple characters into a single undo entry.
> `npm run build` passed in byte-matching source snapshot
> `C:/Users/Public/codex-shell-home/mdv-131-source-check`, labelled
> `MDVIEWER_SOURCE_ID=issue-131-uncommitted-source-snapshot`; the dirty-tree provenance
> guard was preserved. E2E used that build with `E2E_TARGET=preview`, `E2E_PORT=5195`,
> `PLAYWRIGHT_BROWSERS_PATH=C:/Users/Public/codex-shell-home/mdv-131-browsers`,
> `npm run test:e2e -- --project=chromium --workers=1`.
> Environment: per-command Git safe.directory override for sandbox ownership;
> matching Playwright revision 1248 installed in scratch after the initial missing
> executable refusal. All 110 assertions passed before Windows preview-server
> wrapper shutdown hung; stopping this run's wrapper PID 27044 let the runner
> finish with `110 passed` and exit 0. Logs: scratch `mdv-131-build.log` and
> `mdv-131-e2e.log`. Spec/API index synced; phase status unchanged.
> NOT verified: hosted CI, second browser engine, subjective/manual acceptance or
> live deployment. `ACTION_ITEMS.md` AI-6/7/8/9 remain OPEN. Already-started
> `File.text()` cannot be cancelled, but its late result is inert after teardown.
> Resume: inspect the working-tree diff; publish/review only when requested.
>
> **PREVIOUS CHECKPOINT — 2026-10-02 (reviewed fixes live as bf04155f):**
> #122 preserves ingestion notices and distinguishes unreadable Markdown, closing #121.
> #123 adds behavioral privacy/egress regression coverage with mutation controls,
> closing #119. #125 fixes the two-pixel raster antialias false positive without
> losing its actual TOC-removal control. Owner SDK sync #124 was reconciled by fixing
> stale README version literals and resolving the addressed conversation; no policy
> bypass or SDK rewrite. #126 uploads the tested artifact and isolates dry runs,
> closing #120 after real dry-dispatch proof. All were independently reviewed on
> final heads, passed all three required checks and merged with merge commits.
> Production is **bf04155f** from main **51b9758fa4e6b265f4376edf02d3f56821b9de8e**:
> `https://bf04155f.mdviewer-c9r.pages.dev/`, id
> `bf04155f-f343-4f8a-b5cd-9bc78fff2977`. Exact-main Windows agent gate passed
> 529 unit/four server tests; build, hooks/14 skills and 109 preview Chromium tests
> passed (one worker, no retries/skips/flakes). Hosted main CI run 37076417364 is green.
> The 230-file manifest matched before/after browser tests and before direct upload.
> Stable/immutable HTTP bytes, source/SDK 3.3.1 identity, security/cache headers passed;
> stable Chromium boot rendered seven sheets with zero errors. Live egress smoke
> exercised both exports: 498 requests, all same-origin. See `docs/DEPLOYMENT.md`.
> Dry runs 37075799089 and 37076144920 passed on reviewed head 25d3cca: producer/dry
> consumer green, live skipped, no approvals or new production records. No live
> automated dispatch; direct upload used existing cached Wrangler 4.114.0 auth.
> Previous production f97778db/df50e7a is the recorded rollback target (not exercised).
> **AI-6/7/8/9 remain OPEN**: manual workspace/second-engine, live PWA/toast,
> Beta-bar acceptance and production-environment hardening/live automated proof.
> Next: owner acceptance/setup; MD2 hostname selection remains blocked on ownership.
> Late Dependabot #127 patched both Moderate development-only brace-expansion
> alerts (55/56); GitHub marks both fixed. Independent exact-head review verified
> patched versions/registry integrity and all three checks passed. No runtime or
> SDK changes; this later development-lock update does not relabel the deployed build.
> No unclaimed open code issue remains from this review batch. This record updates
> repository metadata; the deployed application/source anchor remains 51b9758.

> **▶ PREVIOUS CHECKPOINT — 2026-09-27 (MD3 egress proof shipped, live as f97778db):**
> PR **#114** (offline export proofs + two-part production-egress proof, MD3
> closed) merged as `df50e7a` with exact-head CI green. One Codex P2
> (setup-only egress assertion) fixed in-PR with reply evidence; self-review
> caught a vacuous-probe gap and reworked the proof (SDK is inert under
> automation by design, so `tests/pulse-egress.test.ts` pins the vendored
> artifact to collector-only fetch in CI while `scripts/smoke-egress.mjs`
> proves per-deploy the app phones nowhere). Headless Grok review attempted 3×
> — the CLI hangs on any tool-using invocation in this environment (trivial
> no-tool prompt works); merge proceeded on self-review + Codex + green CI per
> the then-standing review order (struck 2026-11-11). Production is now deployment
> **`f97778db`** from `main` **`df50e7a`** (immutable URL
> `https://f97778db.mdviewer-c9r.pages.dev/`, id
> `f97778db-22ac-4637-b40c-758ecd96885e`), smoke-verified live: identical
> bytes/headers, SDK 3.3.0 byte-matching the lock, clean Chromium boot
> (6 sheets, zero errors), egress probe PASS (498 requests, all same-origin).
> No open PRs except this deploy-record PR, no open issues.
> Next: merge this record, then restart the loop on the next roadmap slice.
> **Three OPEN human items: AI-8 (Beta bar), AI-7 (steps 4–8), and AI-6.**
>
> **▶ PREVIOUS CHECKPOINT — 2026-09-27 (perf budget + SDK 3.3 shipped):**
> PR **#110** (large-doc performance budget: deterministic generator, opt-in
> 5-rung ladder with longtask/heap/node signals, 250 kB confirm gate on file,
> window-paste and editor-paste/drop paths) merged as `a56b2f5`. Owner PRs #111
> (SDK version from lock) and #112 (SDK 3.3.0 sync) merged concurrently, reviewed
> retrospectively. Production was deployment **`c3509120`** from `a56b2f5`,
> smoke-verified live. Standing orders update (struck 2026-11-11: reviews
> follow estate law 2g). Superseded by the f97778db deploy above.
>
> **▶ PREVIOUS CHECKPOINT — 2026-09-26 (checklist pagination fix, merged as #99):**
> Owner report: `HUMAN_TODO.pdf` (610 lines, 30 long task items) paginated with
> mostly-blank sheets (worst non-last page 76% empty, 20 pages) and hyphenated
> inline-code chips. Root causes: `li` carried `break-inside: avoid` (each long
> item pushed itself whole) and inline `code` inherited `hyphens: auto`.
> Branch `fix/checklist-pagination-flow`: `li` fragments like `p`
> (`orphans/widows: 3`, no avoid), `li` leaves `ATOMIC_BLOCK_SELECTOR`, inline
> code gets `hyphens: none` + `overflow-wrap: anywhere` + decoration-clone.
> Post-fix the real doc is 16 pages with worst non-last trailing 4%. Cover:
> `tests/e2e/list-flow.spec.ts` + `tests/fixtures/checklist.md` (fill cap 20%,
> fragmentation count, style pins, nested-pre guard) — verified red pre-fix /
> green post-fix; `tests/buildSource.test.ts` updated for the contract change;
> spec §4 carries the explicit foundation replacement. Gates all green at merge:
> typecheck, lint, 421 unit, build, hook smoke, 14 skills, dev e2e 91 passed,
> preview e2e 92 passed, exact-head CI green.
>
> **▶ PREVIOUS CHECKPOINT — 2026-09-26 (deploy done):** Cycle 4 is complete except this
> record PR and the #59 close. Merged since the last checkpoint: PR **#95** (mermaid 12,
> one Codex P2 on vacuous init-test assertions fixed with a mutation proof), PR **#96**
> (this run-header refresh, three Codex P2s fixed), PR **#97** (6-package patch sweep,
> one Codex P2 on raster-adapter revalidation fixed) — all with green exact-head CI and
> resolved threads. Production is now deployment **`f353480c`** from `main` **`4e7d99a`**
> (immutable URL `https://f353480c.mdviewer-c9r.pages.dev/`); the deploy needed one human
> step (stored Wrangler OAuth lacked `pages` scope → operator re-authorized). Live smoke
> passed on every header the #59B dispute was about, so #59B is reconciled by dated
> supersession: headers verified today, install/update-toast stays operator work under
> AI-7 step 5. `npm audit` is 0; TypeScript 7 deliberately deferred (major).
> **Two OPEN human items: AI-7 (manual live-site acceptance, steps 4–8) and AI-6.**
>
> **▶ PREVIOUS CHECKPOINT — 2026-08-16:** The QA sweep is **MERGED AND LIVE**. The manual QA
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

Follow the first-five-minutes order in `AGENTS.md`, then read
[the issue-backed queue](docs/FUTURE_WORK.md). GitHub main, issue/PR status,
review threads and current-head CI are authoritative. Verify the default-branch SHA
and relevant branches before editing. A changed head invalidates earlier CI/review.

When connected GitHub tools are available, use their repository/ref/tree/file,
issue/PR and Actions APIs first. An uploaded or connector-downloaded source archive
is a local analysis workspace only after its commit/tree is reconciled with GitHub.
Do not probe equivalent shell-network workarounds when GitHub networking is blocked.

In an already authenticated local Git checkout, inspect status and fetch the current
main before creating an isolated branch/worktree. Preserve existing work and use
merge commits, not rebases or force pushes. Read existing check results before
running or dispatching more jobs. Deployments and human environment decisions remain
separate; this session-start procedure does not authorize a live promotion.

### 2. Historical launch snapshot

The launch details below are historical. The current checkpoint above and
`ACTION_ITEMS.md` Current State supersede its repository, deployment and human-queue anchors.

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
  remain in the browser; there is no conversion API, document storage, or third-party
  document/resource request. Since the Pulseboard SDK v3 install (owner decision, Pulseboard q-13/q-21),
  the production origin sends content-free usage data only (README "Privacy and usage data"). Same-origin application chunks and fonts can load lazily as features run.
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

### 3. Hosting preparation queue — dry path done; remaining gates open

The reference-only intake in [`.hosting/manifest.json`](./.hosting/manifest.json) does not deploy
or activate anything. These follow-on tasks are part of the resumable queue and retain the
browser-only, local-document boundary:

| Task | Status | Acceptance gate |
| --- | --- | --- |
| MD1 — prepare CI-compatible direct upload | **DONE — dry acceptance; AI-9 live gate OPEN** | The reviewed artifact handoff and credential-free dry path passed on 2026-10-02. Production environment protection, scoped credentials and the first live dispatch remain AI-9. |
| MD2 — prepare canonical-origin metadata | **BLOCKED — hostname not selected/owned** | Verify direct entry, refresh and lazy same-origin assets at the proposed base before setting a canonical hostname. |
| MD3 — protect the browser-only boundary | **DONE — regression and per-deploy checks retained** | Render/export and runtime-egress checks are established; re-run the deployment smoke for each promotion. No converter backend, document upload or new runtime network path. |

Use [`.hosting/README.md`](./.hosting/README.md) for the bounded implementation notes. The existing
Direct Upload project remains authoritative; a Git push is not a production deployment trigger.

### 4. Dependabot queue — RESOLVED 2026-08-08 (historical snapshot below)

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

The launch-era suggestions in this historical section are superseded: the PWA,
Pages dry-deploy workflow and performance ladder have shipped. Current work is
explicitly linked in [Future work](docs/FUTURE_WORK.md) / #195, including the still-open
human gates. Do not reopen completed packaging work from this historical queue.

## Historical run header — 2026-09-27

This section preserves the earlier loop's bookkeeping. Use the latest checkpoint
above and refresh GitHub state for the current queue, verification and next work.

- **Start commit (static — start of record):** `fe085b0` (Initial scaffold) on `main`.
- **Cycle-2 base (static — historical):** exact `origin/main` `a0647549be99f8053732150d7ef1ff9c5e9c65c6`.
- **Launch record (static):** 14 PRs through PR #29 (`43af438`), verified by hosted Node 20/22
  and production Chromium CI run `30060892316` green; fuller product/release gate evidence at
  PR #28 / `7f4eedf`; production Pages smoke recorded in C16.
- **Goal:** Drive real, shippable improvements end-to-end (discover → plan → implement → review → verify → merge), keeping a durable resumable record.
- **Current cycle:** 5 — improvement loop (owner-authorized: fix/improve → PR → review →
  merge → repeat, then redeploy). Loop shipped (#100–#103), SDK #105/#107 merged,
  records #106/#108, follow-ups #109, SDK version #111 + SDK 3.3 #112 (owner),
  perf budget #110 merged; production is `c3509120` from `a56b2f5`. Next slice:
  next roadmap item after the P3 budget. Longer backlog plus operator-owned
  AI-6/AI-7/AI-8. Reviews follow estate law 2g.
- **Last updated:** 2026-09-27
- **Live GitHub queue snapshot (2026-09-27):** no open PRs except this deploy-record
  PR, no open issues; production is `c3509120` from `a56b2f5` (fresh).
  Refresh before use — snapshots expire at the next head change.
- **Verified `main` anchor:** `a56b2f55aca2c96bb16ce77dc7bca6d4d086032c` (PR #110 merge).
- **PRs merged to `main`:** 67 PR merges, most recently #110 (perf budget),
  #112 (SDK 3.3.0 sync), #111 (SDK version from lock), #109 (review follow-ups).
- **Current main verification (`a56b2f5`):** hosted Node 22/24 and production Chromium
  CI run `36289158995` green. Production serves `c3509120` from this anchor (see the
  current checkpoint).

## Environment / verification commands

- Stack authority: `package.json` and `package-lock.json`. Current toolchain: Vanilla TypeScript + Vite 8, Vitest 5, Playwright Chromium/Firefox and ESLint 10. Supported Node range: `^24.15.0 || >=26`; Node 24 is the strict-install CI lane.
- Package manager: npm. Default branch: `main` (protected: no force-push/rebase/amend/reset per CLAUDE.md).
- VCS host: GitHub (`Chris0Jeky/MDviewer`). Verify the active connector/checkout; do not assume a prior session's CLI authentication or native runtimes are present.
- Verification commands (the merge gate):
  - `npm run typecheck` — tsc --noEmit
  - `npm run lint` — eslint src tests
  - `npm run test` — vitest run (unit, jsdom)
  - `npm run test:e2e` — playwright (real Chromium) — **required for render/pagination/export/UI**
  - `npm run test:authoring` — bounded production Firefox authoring and accessibility lane
  - `npm run build` — tsc + vite build
  - `npm run agent:check` — typecheck + lint + unit in one shot
  - `npm run agent:hooks:smoke` / `npm run agent:skills:validate` — agentic tooling, before handoff
- `.github/workflows/ci.yml` runs Node 24 supported verification, the retained Node 22 legacy compatibility context, production web Chromium and production Firefox authoring. `.github/workflows/desktop.yml` adds production desktop Chromium and native Windows build/smoke: six qualification jobs in total. The branch-protection contexts remain the Node 22/24 and production web Chromium jobs; the broader repository merge gate requires the remaining lanes too. The five opt-in performance cases are reported separately; required checks are not skipped.

## Baseline (cycle 1 start, commit fe085b0)

- `npm run typecheck` ✓
- `npm run lint` ✓ (0 warnings)
- `npm run test` ✓ (157 unit tests, 11 files)
- `npm run build` ✓ (known 1.9 MB initial chunk warning — tracked, P3)
- `npm run test:e2e` — not yet re-run this session (ACTION_ITEMS records 15/15 from 2026-06-25 bring-up)

## OPEN human action items (from ACTION_ITEMS.md — always surface these)

- **AI-9 — Harden production before the first live automated deployment.** The operator
  must configure main-only environment branches, required reviewers and environment-scoped
  Cloudflare credentials, then approve/prove the first live dispatch. Dry acceptance has
  passed without production approval or records; it does not clear this live-promotion hold.
  The established authenticated-maintainer direct upload remains the fallback. See
  `ACTION_ITEMS.md` and `docs/DEPLOYMENT.md`; only the maintainer may close AI-9.
- **AI-8 — Accept the Pulseboard Beta bar on the live site (manual gate).** Opened 2026-09-26
  with PR #105. The SDK is inert under automation and off-origin, so only the live site shows
  the real bar: bar/pill/panel behavior, payload enums, print exclusion, GPC silence.
  Step-by-step instructions are in `ACTION_ITEMS.md`; only the maintainer may close it.
- **AI-7 — Accept the QA-sweep fixes on the live site (manual gate).** Opened 2026-08-16 with
  PR #48. Merge, deploy, and smoke (steps 1–3) are done; the remaining steps 4–8 are the
  in-browser checks on **https://mdviewer-c9r.pages.dev/** (zoom/chip/banners/export progress,
  PWA install + offline, dark-theme print accuracy, the Title-page toggle). Instructions in
  `ACTION_ITEMS.md`.
- **AI-6 — Accept the split workspace in a real browser (manual UI gate).** Opened 2026-08-08 with
  PR #36. Automated coverage cannot judge how typing feels or confirm the Print/Save-as-PDF output
  by eye. Step-by-step instructions are in `ACTION_ITEMS.md`; only the maintainer may close it.

## Historical task board

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
### Current backlog pointer

Use [docs/FUTURE_WORK.md](docs/FUTURE_WORK.md) and [#195](https://github.com/Chris0Jeky/MDviewer/issues/195).
Format (#211/#198), session navigation (#212/#199), export feedback (#210/#200),
authoring quality (#208/#203), heading isolation (#213), Shiki 4.6 (#193), reader
admission/grammars (#162/#172), offline capture (#178) and active-match visibility
(#191) are merged. Persistence designs (#209) still require implementation in
#196/#197. Historical task notes for delivered changes remain as design/evidence;
the current issue state determines pending work. Each new issue records
scope, dependency and completion evidence; every open failure-ledger row points to
one of those issues or its existing AI gate.

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
- **C20 (2026-09-03) — NODE 20 DROPPED, jsdom 30:** Owner decision on #60: Node 20 (EOL
  2026-04-30) leaves the support surface. `engines.node` is now `^22.22.2 || ^24.15.0 || >=26` (jsdom 30's own floor), the verify
  matrix is `['22', '24']` (job names unchanged), and jsdom moved 29.1.1 → 30.0.1 (its only
  breaking change is the Node floor; the rest is CSS/`getComputedStyle` fixes). Local proof on
  Node v24.13.1: typecheck, lint, 359 unit tests, build, serve tests, production-preview E2E.
  Branch protection still names the `(20)` check context — the coordinator swaps it for `(24)`
  before merging. Dependabot #43 is superseded by this PR. Lockfile `libc` fields were restored
  after the local Windows install (the W-2 gotcha).
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
- **C21 (2026-09-26) — CHECKLIST FIX MERGED:** Owner-reported `HUMAN_TODO.pdf` defects
  (blank sheets, hyphenated inline code) fixed on `fix/checklist-pagination-flow` and merged
  as PR **#99** → `4115563`: `li` fragments like `p`, leaves `ATOMIC_BLOCK_SELECTOR`, inline
  code `hyphens: none` + `overflow-wrap: anywhere`. Real doc 20→16 pages, worst non-last
  trailing 76%→4%. Evidence: typecheck, lint, 421 unit, build, hook smoke, 14 skills, dev
  e2e 91 passed, preview e2e 92 passed, exact-head CI run `36267035533` green, exact-head
  review with no findings. Just before it, PR **#98** → `7fa3a1f` recorded the `f353480c`
  production deploy. Production now predates `main`; redeploy queued after the loop.
- **C22 (2026-09-26) — DOCS SYNC MERGED, TECH-1 IN REVIEW:** PR **#100** → `4cb1635`
  (post-merge `main` CI run `36268592849` green; one self-review finding fixed).
  PR **#101** closes TECH-1: phone toolbar strip at ≤760px, 347→204px toolbar on
  375x667 with a doc loaded, `tests/e2e/responsive-toolbar.spec.ts` red→green.
  Its Codex P2 (sync ORCHESTRATOR/ACTION_ITEMS/original ledger entry) is addressed
  in-PR. Production still `f353480c`; redeploy after the loop.
- **C23 (2026-09-26) — TECH-1 MERGED, THEME-COLOR IN REVIEW:** PR **#101** →
  `ef4458d`, post-merge `main` CI run `36269689792` green. PR **#102** makes meta
  theme-color follow the screen theme (`src/app/themeColor.ts` + pre-paint mirror;
  unit, head-contract and e2e cover, red→green proven). One process lesson applied:
  tracker sync (ORCHESTRATOR/ACTION_ITEMS) now rides in the same PR preemptively.
- **C24 (2026-09-26) — THEME-COLOR MERGED, HEADER E2E IN REVIEW:** PR **#102** →
  `43baba4`, post-merge `main` CI run `36271056347` green. PR **#103** closes the
  running-header/titlePage e2e gap with `tests/e2e/running-header.spec.ts`
  (start-semantics over pushed content + titlePage chrome, mutation-proven).
  Redeploy queued right after this merge.
- **C25 (2026-09-26) — LOOP SHIPPED TO PRODUCTION:** PR **#103** → `578590c`,
  post-merge `main` CI run `36271782617` green. Production is now **`c3dee6ad`**
  from `578590c`, smoke-verified live on every header plus a Chromium boot. The
  cycle-5 loop (docs-sync, TECH-1 strip, theme-color, header e2e) is fully merged,
  reviewed, and live; only this record PR remains open.
- **C26 (2026-09-26) — PULSEBOARD SDK SHIPPED TO PRODUCTION:** PR **#105** →
  `0da2e26`, post-merge `main` CI run `36277132449` green. Production is now
  **`cdc831b1`** from `0da2e26`, smoke-verified live including a non-automation
  boot where the Beta bar renders with a resolved region. Nine Codex threads, all
  triaged; two upstream SDK defects ledgered OPEN (scroll, focus), campaign
  bucketing owner-escalated for the 3.2 re-cut. New operator item AI-8 (Beta bar).
- **C27 (2026-09-26) — SDK 3.2 SHIPPED TO PRODUCTION:** PR **#107** → `b566e23`,
  post-merge `main` CI run `36278869189` green (owner merged concurrently after the
  Codex Cloud review + coordinator gate). Production is now **`f73c4f85`** from
  `b566e23`; masked-automation live probe confirms SDK 3.2.0, `campaign: "other"`,
  no verbatim leak. Scroll/focus ledger entries closed by the PR; Grok review adds
  one upstream P2 (scrollMax latch) and one ledger-hygiene P2, both queued as the
  review-follow-ups slice.
- **C28 (2026-09-27) — PERF BUDGET + SDK 3.3 SHIPPED TO PRODUCTION:** PR **#110**
  → `a56b2f5`, post-merge `main` CI run `36289158995` green. Perf budget slice:
  generator + 5-rung ladder (wall/longtask/precise-heap/nodes), 250 kB gate on
  all ingestion paths; twelve threads over seven review rounds (Codex + Grok),
  all fixed in-PR. Owner #111/#112 rode along and were reviewed
  retrospectively (3.3.0 behavior-neutral for mdviewer). Production is now
  **`c3509120`** from `a56b2f5`: identical bytes/headers, SDK 3.3.0
  byte-matching the lock, clean Chromium boot. Reviews follow estate law 2g.
