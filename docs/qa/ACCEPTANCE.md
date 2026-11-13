# Acceptance by agent QA

Owner decision 2026-11-13: mechanical acceptance checks are agent QA work, not owner tasks (see
`ACTION_ITEMS.md`, "Delegated to agent QA"). This file maps every former human step to the strongest
check that replaces it and records the latest result. **Delegated is not accepted:** a row passes
only with evidence; a row no agent can check says "not verified (no agent can check it; owner
decision 2026-11-13 not to be asked)" and never counts as a pass.

Check kinds, strongest first: **CI** an automated test in hosted CI (web Chromium, Firefox
authoring, desktop Chromium, native Windows smoke); **Script** a scripted local run (UI Automation
under `run-all.ps1`, a real installer in an isolated place); **Session** a time-boxed exploratory
session with a written charter and evidence. A step about feel or perception names its measurable
proxy and what the proxy does not cover.

Status values: *pass* (evidence linked), *fail* (issue linked), *not run*, *not verified* (as above).

## How a QA session runs

- **Build:** the newest green Windows Desktop run on `main` (`mdviewer-windows-x64` artifact), or the
  web build at the same commit. Record the commit and run id.
- **Files:** invented only. The corpus generator models agent-written Markdown (600-line CRLF+BOM
  checklist, front matter, nested and numbered task lists, tables, callouts, code, a Unicode path,
  chat and agent JSONL transcripts, JSON, YAML with two documents, TOML, CSV, TSV, a log, an empty
  file) plus a rich file with local images, Mermaid and math above task lists
  ([make_corpus.py](make_corpus.py), [make_rich.py](evidence/2026-11-13/make_rich.py)). Never read, copy or screenshot the owner's documents.
- **Owner state (Windows):** before a launch, stop if any `mdviewer` process runs (it is the
  owner's); copy `%LOCALAPPDATA%\dev.chris0jeky.mdviewer\library.json` aside and put the exact bytes
  back after the app closes (it also holds the owner's session). Crop the tab strip out of
  screenshots: restored tabs can show the owner's file names.
- **Install, uninstall, file associations:** only in Windows Sandbox, a virtual machine or a separate
  Windows account, never on the owner's account; otherwise *not run*.
- **Live site:** read-only, in a real visible browser session (the Pulseboard SDK is inert under
  automation, on other origins and while the page is hidden). Never deploy (AI-9).
- **Findings:** one issue per finding, labelled `qa`, with build SHA, exact steps, expected, actual
  and a screenshot; product fixes go to the owning lane; a test that CI should have had is attached
  to the issue (this repository has no expected-fail marker and forbids skipped required tests).

## Latest pass

**2026-11-13.** Windows CI build `df946bc` ([run 43345194681](https://github.com/Chris0Jeky/MDviewer/actions/runs/43345194681)),
invented corpus. Live site `51b9758` (deployment `bf04155f`), read-only, in a visible real Chromium
session (`navigator.webdriver` false) and two throwaway Firefox profiles (GPC on and off).
Findings: #334 reproduced (failing test attached), #335 observed, new #341, #342, #343 (all `qa`).
Evidence: [`evidence/2026-11-13/`](evidence/2026-11-13/).

CI shorthand: **VERIFY** `Typecheck · Lint · Unit · Build` (Vitest), **E2E** `E2E (Playwright ·
Chromium · production build)`, **FF** `Authoring (Firefox · production builds)`, **DREAD** `Desktop
reader (production Chromium)`, **DWIN** `Windows build and native smoke`. `e2e/` is `tests/e2e/`,
`d-e2e/` is `tests/desktop-e2e/`. A *CI* result means the row passes at every green `main`; other
results are agent-run evidence beyond CI.

## AI-10 — Windows build on realistic files

Charter (60 min): on the newest green Windows build, open each corpus file with Ctrl+O or a
command-line launch (bound file); tick, untick and Undo boxes in long and rich documents; Edit and
Ctrl+S; change the file on disk while open; open every data kind; compare bytes after each write.

| # | Step | Strongest check | Coverage | Latest result |
| --- | --- | --- | --- | --- |
| 1 | Get the build, run it | DWIN builds and smoke-launches the portable exe | partial: installer never run (#169 A) | pass, portable `df946bc` |
| 2 | Tick a box in a bound file | DWIN `scripts/desktop-smoke.ps1` (UIA toggle); `tests/actionable-writeback.test.ts` | partial: no scroll assertion | **fail #334**: view jumps when images or diagrams sit above the box |
| 3 | Only that box changed on disk, endings kept | DWIN smoke exact CRLF bytes; Rust `only_the_patched_line_changes_in_every_encoding_and_ending_mix` | full | pass: one byte on LF, CRLF, CRLF+BOM (Script `run-all.ps1` and Session) |
| 4 | Second tick, Undo within 10 s, bytes restored | DWIN smoke `undoneExactBytes` | partial: discoverability and focus | pass on bytes; **#335** hard to find, **#342** focus lost after Undo |
| 5 | Edit, change a line, Ctrl+S in place | `tests/desktop-owned-save.test.ts`; Rust round trip | partial: no native edit + Ctrl+S | pass (Session: only the edit and the earlier tick differ) |
| 6 | `.json` readable; Edit shows raw; save unchanged | d-e2e/data.spec (two tests); DWIN smoke | full | pass (Script: JSON, YAML, TOML, CSV, JSONL, text) |
| 7 | Transcript reads as turns | d-e2e/data.spec "a transcript-shaped JSON Lines file reads as a conversation" | full for structure | pass; thinking blocks collapsed by design |
| — | Live reload while open | d-e2e reload tests | partial | pass (Session: an external append appeared in Edit) |
| — | Agent-written Markdown renders well | none | none | **#343** GitHub alerts render as text; **#341** false "Blocked N" banner for local images |

Not verified (no agent can check it; owner decision 2026-11-13 not to be asked): how the build
feels on the owner's own documents, which stay private.

## AI-8 — Pulseboard Beta bar on the live site

Charter: live site only, read-only, a visible real browser (the SDK is inert under automation, on
other origins and while the page is hidden); a fresh profile for the GPC pair. Never deploy.

| # | Step | Strongest check | Coverage | Latest result |
| --- | --- | --- | --- | --- |
| 1 | Bar at top, toolbar below, no scroll | e2e/pulseboard-bar.spec; `tests/pulse.test.ts` | partial (SDK simulated) | pass (Chromium: bar shown, `scrollHeight` equals the viewport; Firefox control profile: bar shown) |
| 2 | Choose, OK, Beta button, Escape | e2e/pulseboard-bar.spec (simulated) | partial | pass (three switches; OK collapses to "Beta" beside "Local session"; the button reopens the switches; Escape closes them and returns focus) |
| 3 | Payloads only closed enums, no content | `tests/pulse.test.ts`, `tests/pulse-egress.test.ts` (SDK stubbed) | partial | pass: 7 captured request bodies after sample, view, theme, Print and Download PDF hold only `doc.opened {source: sample, sizeBucket: 1-10k}`, `view.mode`, `theme.changed`, `page.view`, `export.print_requested`, `export.pdf_completed {pages: 4}` and counts with device, scheme, visit, referrer and campaign enums; no text, file name or heading; nothing sent before consent |
| 4 | No bar or Beta button in print | e2e/pulseboard-bar.spec (emulated print) | partial | pass on CSS: the live `@media print` rule hides `[data-pulseboard-bar]` and `#toolbar` (which holds the button); a real print preview was not inspected |
| 5 | GPC on: no bar, no request | `tests/pulse-egress.test.ts` privacy cases | full at SDK level | pass: fresh Firefox profile with GPC (`Sec-GPC: 1` sent), 384 site requests and 0 to the collector, no top bar; control profile without GPC: bar shown and 3 collector requests |

Observation (not filed): with GPC on, the small "Beta" privacy-choices button still shows in the
toolbar; it sends nothing.

Not verified (no agent can check it; owner decision 2026-11-13 not to be asked): whether
Pulseboard stores the events (a Pulseboard-side setting).

## AI-7 — QA-sweep fixes on the live site

Steps 1 to 3 were verified for `bf04155f` on 2026-10-02. E2E runs on the built bundle, not the live
site; a live Session repeats the partial rows.

| # | Step | Strongest check | Coverage | Latest result |
| --- | --- | --- | --- | --- |
| 4a | Zoom 50/100/Fit, `aria-pressed` | e2e/canvas-chrome.spec (three tests) | full | CI |
| 4b | Page chip tracks scrolling | e2e/canvas-chrome.spec; e2e/golden-path.spec | full | CI |
| 4c | `.txt` drop shows "skipped" | e2e/empty-error.spec; `tests/skippedFileWarnings.test.ts` | partial (no literal `.txt` drop) | not run live |
| 4d | Download PDF progress, both buttons disabled | e2e/export.spec; e2e/export-status.spec | partial (`.export-primary` not asserted) | Download PDF pass live (valid 4-page `%PDF-1.3` file); button states not observed live |
| 4e | Settings change keeps scroll | e2e/canvas-chrome.spec | full | CI |
| 4f | Footnotes at the page foot | e2e/footnotes.spec; e2e/footnote-targets.spec | full | CI |
| 4g | TOC after H1, leaders to right-aligned numbers | e2e/toc.spec | partial (no pixel check) | not run live |
| 4h | Task checks visible | e2e/tasklist.spec | full | CI |
| 4i | Empty `.md` notice | e2e/empty-error.spec; d-e2e/notices.spec | full | CI |
| 5a | PWA install, icon and name | `tests/head-contract.test.ts` | partial (no real install) | pass on installability: manifest `MDviewer`, `standalone`, start `/`, 192, 512 and maskable icons all 200, service worker active and controlling; the browser's install dialog was not run |
| 5b | Offline reload, print still makes sheets | e2e/offline.spec; e2e/export-offline.spec (bundle) | full on the bundle | pass on readiness: all 85 same-origin resources the live page used are in the Workbox precache (183 entries); a true network-off reload was not achieved live (the Firefox dead-proxy attempt did not prove isolation, so it is not counted) |
| 5c | Update toast, Reload applies | `tests/update-prompt.test.ts` (jsdom) | partial | not run: needs two live deployments (waits on AI-9) |
| 6 | Dark theme keeps print code light, also in Download PDF | e2e/theme-paper.spec | partial (no PDF assertion) | not run |
| 7 | Title page off shows header and number | e2e/running-header.spec | full | CI |

Print: `export.print_requested` fired with 4 page sheets present at the print call; the print
dialog's output was not inspected.

## AI-6 — Split workspace

Charter: Chromium and Firefox; typing bursts, long paste and scroll, mode and divider changes,
export straight after an edit. Feel is replaced by measured proxies: input-to-paint latency per
keystroke (median and p95 over a 200-character burst), caret-to-glyph offset between the textarea
and the highlighted backdrop (also after scrolling and at soft wraps), equal scroll offsets and box
metrics of both layers, and the repagination delay after typing stops.

| # | Step | Strongest check | Coverage | Latest result |
| --- | --- | --- | --- | --- |
| 1 | Opens in Split | e2e/editor.spec | full | CI |
| 2 | Continuous typing, caret exact | e2e/editor.spec (live typing, Shiki fence, backdrop aligned) | partial (no latency, no typed `:::note`) | not run (session interrupted) |
| 3 | Dropped file editable, preview follows | e2e/editor.spec | full | CI (E2E and FF) |
| 4 | Long paste, colours stay locked | e2e/editor.spec; e2e/editor-search.spec | full | CI (E2E and FF) |
| 5 | Markdown, Preview, Split panes | e2e/editor.spec (two tests) | full | CI (E2E and FF) |
| 6 | Divider drag persists, keys, release outside window | e2e/editor.spec; `tests/splitter.test.ts`; d-e2e/edit.spec | partial (outside-window release in jsdom only) | not run |
| 7 | Print holds only page sheets | e2e/editor.spec; e2e/export.spec | partial (emulated print) | not run |
| 8 | Edit then export at once (Print, Download PDF, empty app) | e2e/export.spec (Print); d-e2e/reader.spec | partial (web Download PDF straight after an edit) | not run |
| 9 | Print from Markdown mode not blank | e2e/editor.spec | full | CI |
| 10 | Tab then Ctrl+Z | e2e/editor-edit-safety.spec | full | CI (E2E and FF) |
| 11 | Dark theme, source colours follow | e2e/theme-paper.spec | full (Chromium) | CI |
| 12 | Steps 2, 4, 10 in a second engine | FF job | full for Firefox | CI; Safari not run |

Not verified (no agent can check it; owner decision 2026-11-13 not to be asked): how typing feels
to a person; Safari on macOS (no Mac on this host).

## #169 — Windows hands-on boxes

A box is ticked in #169 only when every one of its rows passed.

| Box | Strongest check | Coverage | Latest result |
| --- | --- | --- | --- |
| A Install and uninstall (per-user NSIS) | Script in Windows Sandbox or a VM: installer and uninstaller; record Windows and WebView2 versions, install path, SmartScreen with Mark-of-the-Web, user files kept after uninstall | none in CI | not run (needs an isolated place) |
| B Explorer Open, Open with, default for `.md` and `.markdown`, spaces and Unicode, second instance | DWIN smoke (Unicode launch, UTF-16 forward, one host); Rust argument tests | partial (associations none) | associations not run (needs an isolated place); second-instance forward pass (Session) |
| C Keyboard: Ctrl+N, Ctrl+F/H, Escape, Undo/Redo, switching, Ctrl+S | d-e2e/shell.spec, d-e2e/authoring-accessibility.spec, d-e2e/new-document.spec, e2e/editor-search.spec, e2e/document-shortcuts.spec (also FF) | partial (browsers, not WebView2; native Ctrl+S key) | not run in WebView2 |
| C Narrator | Session: UI Automation names, roles and focus order in reading and editing, plus an `accessibility-auditor` pass | partial (no speech) | not run |
| D Print vs Download PDF: code, equations, diagrams, tables, footnotes | e2e/nocutoff.spec, e2e/pagination-completeness.spec, e2e/raster-visual.spec, e2e/raster-footnotes.spec, d-e2e/reader.spec, DWIN PDF save | partial (equations in Download PDF; a Windows print driver) | not run; Session: Microsoft Print to PDF output compared page by page with Download PDF |

Not verified (no agent can check it; owner decision 2026-11-13 not to be asked): a physical
printer; the quality of real Narrator speech.

## Planned charters (features not shipped yet)

Each runs on the first green build after its lane reports the merge and names the PR.

- **AI-11 web shell (W1, W2):** Chromium and Firefox; open and Save through the File System Access
  API and its fallback; Read, Edit, PDF; Actionable Markdown in memory and bound; PWA, Beta bar and
  print exclusion unchanged. The default flip ships only after this passes.
- **AI-12 PDF (P1 to P4):** invented PDFs only (generated, or public-domain samples); open, read,
  select text, page operations, annotations other readers show, edited text stays text; untouched
  pages keep their bytes; no PDF script or action runs.
- **AI-13 new readable kinds (D7, D8) and local HTML pages:** one invented file per kind; readable
  view, Edit shows raw, an unedited save keeps the bytes, the large-file budget holds.
