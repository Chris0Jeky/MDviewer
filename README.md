# MDviewer

<p align="center"><img src="docs/assets/mdviewer-loop.svg" alt="MDviewer workflow, animated" width="100%"></p>

A local Markdown reader and editor with a paginated PDF preview. Code blocks, figures, tables and callouts stay whole when they fit on a page.

[![CI](https://github.com/Chris0Jeky/MDviewer/actions/workflows/ci.yml/badge.svg)](https://github.com/Chris0Jeky/MDviewer/actions/workflows/ci.yml)
[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](package.json)
[![Node](https://img.shields.io/badge/node-24%20%7C%2026%2B-339933?logo=nodedotjs&logoColor=white)](package.json)

**Live app:** https://mdviewer-c9r.pages.dev/

**Windows desktop preview:** read local files in a continuous view, write in **Edit**
(`Ctrl+E`: the source beside the live document, with Find/Replace and Format), start a
blank note with **New**, or choose **Export PDF…** (More, `Ctrl+Shift+E`) for the paginated preview and export.
Session positions and keyboard document navigation help you move among open notes.
Explorer file opening, multiple documents and screen themes are built in. The source
editor loads only when you edit, and pagination only when you choose Export PDF… or print.
[Download/build instructions, shortcuts and current limits](docs/WINDOWS_DESKTOP.md).

**Next development:** [prioritized work and acceptance criteria](docs/FUTURE_WORK.md),
tracked in [#195](https://github.com/Chris0Jeky/MDviewer/issues/195). Save/Save As and
optional crash recovery have reviewed designs and remain implementation work; the current app saves explicit
copies and keeps open documents in memory.

- [What it is](#what-it-is)
- [Why it exists](#why-it-exists)
- [Privacy and usage data](#privacy-and-usage-data)
- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [How export works](#how-export-works)
- [Tech stack](#tech-stack)
- [Status and roadmap](#status-and-roadmap)
- [Security](#security)
- [For contributors and agents](#for-contributors-and-agents)
- [License](#license)
- [Links](#links)

![MDviewer rendering its bundled sample as a seven-page, print-ready document.](docs/assets/mdviewer-preview.png)

## What it is

MDviewer is a **local-first Markdown editor and paginated PDF preview**. Write in the source pane, drop a `.md` / `.markdown` file, paste Markdown, or use the file picker. JSON, JSON Lines and plain text files (`.json`, `.jsonc`, `.jsonl`, `.ndjson`, `.txt`, `.log`) open as a **readable view**: tables, sections and an overview derived on the device, while Edit and Save keep the raw text ([Readable data](docs/design/READABLE_DATA.md)). The preview is the real page geometry — A4 or US Letter, with the breaks you will get in the PDF.

The web app runs entirely in the browser; the experimental Windows distribution uses a local WebView2 window. Document text, file names, headings, URLs and exports never leave the device. Apart from explicit user-requested Markdown/PDF saves, app-managed user state consists of a small settings object in `localStorage` (`mdviewer.settings.v1`) and the public-site SDK keys described below. The PWA separately caches application assets for offline use. There is no conversion API, no automatic document storage, and no account.

The public site also sends pseudonymous, content-free usage data to the owner's first-party Pulseboard collector — never document text, file names or exports. See [Privacy and usage data](#privacy-and-usage-data) for exactly what, and how to turn it off.

Same-origin application assets (Paged.js, Mermaid, extra Shiki grammars, KaTeX fonts) may load lazily as features run. The production build is an installable PWA and works offline once those assets are cached.

Production-build Chromium tests cover offline PDFs saved with **Download PDF**,
including styled output, refusal when required CSS or fonts are missing, and retry
after those cached assets are restored. See [offline capture evidence and limits](docs/design/RASTER_OFFLINE_CAPTURE.md).

## Why it exists

Typical Markdown-to-PDF converters render HTML and let the print engine break pages wherever it likes. A listing gets cut in half. A table header is stranded. A diagram is sliced down the middle. Fine for a grocery list. Not fine for a paper or a code-heavy design note.

MDviewer is built around the opposite contract: **atomic blocks stay whole**. When a block is genuinely taller than one page, it degrades on purpose — repeated table headers, continuous frames, a tight shrink-to-fit (≤ 1.15× page height), then a clean forced split — instead of being chopped. That tiered rule is specified in [`docs/design/IMPLEMENTATION_SPEC.md`](docs/design/IMPLEMENTATION_SPEC.md) §4 and asserted in [`tests/e2e/nocutoff.spec.ts`](tests/e2e/nocutoff.spec.ts).

The full rationale is in [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md).

## Privacy and usage data

Your documents stay private. Markdown text, file names, titles, headings, links or URLs that appear
in a document, and PDF or print contents **never leave your browser** — not to Pulseboard, not to
anyone. The Windows app sends nothing at all; on your own disk it keeps `library.json` (recent, pinned,
last-opened and last-session file and folder paths with timestamps, never content; capped) besides its display
settings, and **Clear library** empties it. This is enforced in code: every usage call goes through one module
([`src/app/pulse.ts`](src/app/pulse.ts)) whose functions accept only fixed choices, and
[`tests/pulse.test.ts`](tests/pulse.test.ts) opens documents full of marker text and fails if any of
it reaches a usage call.

**What is sent.** The live site (https://mdviewer-c9r.pages.dev only; local runs, previews and
self-hosted copies send nothing) loads the Pulseboard SDK 3.3.1 from its own origin
(`/pulseboard.js`) and sends data only to `https://pulseboard-observatory.commit-atlas.workers.dev`,
the owner's first-party collector. A one-line **Beta** bar at the top of the page explains it and
offers **Choose** and **OK**. There are three categories:

| Category | What MDviewer sends | Default outside the EEA | Default in the EEA (or unknown) |
| --- | --- | --- | --- |
| **Usage counts** | Daily aggregate counts: page views and the two export events (print dialog requested, PDF download completed), with device class (mobile/tablet/desktop), referral category and the referring platform from a fixed allowlist such as google.com or github.com (any other site is sent as `other`; never a path), whether a `utm_campaign` tag was present (MDviewer registers no campaign tags, so only `none` or `other` is sent, never the tag itself), light/dark preference and new/returning visit | On | On |
| **Diagnostics** | Page-load timings (web vitals) and engagement (visible seconds, deepest scroll % of the preview pane). MDviewer deliberately sends **no JavaScript error reports**, because an error message can quote document text | On | Off until you click OK |
| **Journeys and product data** | A random per-tab session id and these events only: `doc.opened` with `source` (`file`, `paste`, `sample`, `typed`) and `sizeBucket` (`<1k`, `1-10k`, `10-100k`, `>100k` characters); `view.mode` (`editor`, `split`, `preview`); `theme.changed` (`light`, `dark`, `sepia`); `export.print_requested` (a dialog request, never a claim a PDF was saved); `export.pdf_completed` with the page count; page views for the `home` and `editor` screens | On | Off until you click OK |

**Never sent:** document text, file names, titles, headings, URLs from documents, export contents,
your IP address (the collector sees it in transit and stores none), user agent (the browser
attaches it to every request and the collector stores none — the SDK never reads it), the page
URL or path, cookies, or any identifier other than the per-tab session id.

**Kept:** detailed data (diagnostics and journeys) for 90 days; aggregate counts currently for 14
days (planned to move to 400 days).

**How to turn it off.** Any of these works, and each is respected immediately:

- Click **Choose → Turn all off** in the Beta bar, or the small **Beta** button beside "Local session" in the toolbar once
  a choice is recorded. Turning a category off deletes its local keys and drops anything queued.
- Turn on **Global Privacy Control** or **Do Not Track** in your browser: every category is off,
  no bar is shown and no request of any kind is made.
- Block `/pulseboard.js` or the collector with a content blocker, or run MDviewer locally
  (`npm start`) — MDviewer works exactly the same without it.

**On your device** the SDK stores your choice (`pulseboard:consent:v3:mdviewer`), a visit marker
(`pulseboard:visit:mdviewer`: in `localStorage` only the month of your last visit, and in
`sessionStorage` a copy of this tab's answer, `new` or `returning`, gone when the tab closes; neither
is written in the EEA until you click OK), a region hint (`pulseboard:region:mdviewer` in `sessionStorage`, just `eea` or `other`, gone when
the tab closes), and the per-tab session record in `sessionStorage`. Details of the SDK and collector:
[Pulseboard `observatory/docs/SDK.md`](https://github.com/Chris0Jeky/Pulseboard/blob/main/observatory/docs/SDK.md).

## Features

Only what the code actually does:

- **Readable data.** A JSON, JSON Lines or plain text file renders as a readable document (title, overview, key/value tables, one section per object or record; plain text as one literal block). An invalid file names the problem with line and column, then shows the raw text; a long view offers Show more and Show all. Edit shows the raw text beside the live view; Save writes it byte for byte; Export PDF paginates the view. Nothing is uploaded or guessed by a model.
- **No-slice pagination.** Code blocks, figures, tables and callouts stay on one page when they fit. Oversize blocks shrink slightly (≤ 1.15×) or split cleanly; tables repeat their header. List items fragment like paragraphs so a long checklist does not leave half-blank sheets.
- **Live split workspace.** Markdown / Split / Preview. A syntax-coloured source pane (`textarea` over a Shiki backdrop) beside the paginated pages. The divider is draggable and keyboard-operable; the ratio persists. Switching views does not re-render or re-paginate. The editing surface is stripped out of the printed PDF.
- **New documents on Windows.** **New** (`Ctrl+N`) opens a blank note in **Edit**, beside its live preview, with an available `Untitled.md` name, and keeps existing documents open. **Export PDF…** loads the paginated workspace on demand; **Reading view** returns with your open documents and edits preserved.
- **Find and Replace.** Choose **Find** or press `Ctrl/Cmd+F` in the source workspace. Search literal text, match case, see result counts and wrap through matches; the current match stays visibly marked while Find keeps keyboard focus. `Ctrl/Cmd+H` opens replacement controls. In the Find field, `Enter` / `Shift+Enter` moves forward / backward and `Escape` returns to the source. Replace all is one undoable edit. Reader and Preview-only modes keep the host's normal Find.
- **Markdown formatting.** Open **Format** beside Find for Bold, Italic, inline/fenced code, H1–H3, links and bullet/number/task lists. Source-only `Ctrl/Cmd+B/I/K` shortcuts preserve native Undo. Ambiguous marker boundaries are refused without changing source or selection.
- **Session navigation.** Caret, selection and source/preview/reader positions follow stable document IDs in a bounded memory cache. Equal names are distinguished; Windows/Linux use `Alt+Shift+P/N/D` for previous/next/picker. Closing the app clears session positions.
- **Visible PDF progress.** Actual completed-page counts and save outcomes remain visible and politely announced even in Markdown-only and short Find layouts, while source/Find focus stays put. Browser handoff says “download requested”; native Save reports its actual result.
- **Two PDF paths from one layout.** [Print / Save as PDF](#how-export-works) is the vector path. Download PDF is the raster fallback. Both consume the same already-broken page DOM. The PDF is always dark-on-white, whatever screen theme you are using.
- **Syntax-highlighted code** via [Shiki](https://shiki.style/) — TextMate grammars, six theme families (GitHub, VS Code, Nord, Min, One, Catppuccin), each a light/dark pair. Print forces the light side. Optional CSS line numbers. Unknown fence languages fall back to plain text and surface a warning.
- **Math** via [KaTeX](https://katex.org/) (inline and display). Bad TeX renders as a red inline error instead of aborting the document.
- **Diagrams** via [Mermaid](https://mermaid.js.org/) — rendered to a fixed-size SVG *before* pagination measures heights, then sanitized again. Print stays on the light diagram theme.
- **Callouts** — `:::note`, `:::tip`, `:::warning`, `:::danger`.
- **Footnotes** collected at the foot of the page that cites them (Paged.js `float: footnote`), with citation hrefs repaired after preview.
- **Table of contents** with real `target-counter` page numbers. An author-placed `[[toc]]` stays put; otherwise a TOC is synthesized after the first `h1`.
- **Task lists**, block quotes, and markdown-it's typographer (quotes, dashes). Pipe tables in the sample and fixtures render as real `<table>`s and are treated as atomic blocks.
- **Page furniture.** A4 or US Letter; narrow / normal / wide margins (12.7 / 20 / 30 mm); body font serif / sans / slab; 10–13 pt; optional running header, page numbers, title-page (blank header and folio on page 1), and code line numbers.
- **Screen chrome only:** light / dark / sepia. Does not recolour the page sheets or the PDF.
- **Preview zoom** — Fit / 100% / 50%. Paint-only (`transform: scale`); it never changes page breaks. A pinned page chip tracks which sheet you are on.
- **Ingestion.** Drag-and-drop, paste, file picker, or **Open Markdown** (`Ctrl/Cmd+O`). Non-Markdown files are skipped with a banner; reads that fail are reported as unreadable, not as the wrong type. Soft confirm at 250 kB; hard refuse at 25 MB.
- **Source download.** **Save Markdown** (`Ctrl/Cmd+S`) writes the exact in-memory text to a file. It does not persist the document in the app. On the Windows app, **Save** (`Ctrl+S`) and **Save As** (`Ctrl+Shift+S`) write the open document back to its own file, keeping its encoding and line endings, and refuse to overwrite a file another program changed; **Save Markdown** stays a copy.
- **Close recovery.** Undo the latest close in this tab. Reload or closing the tab clears it. No history store.
- **Installable PWA** with a prompt-based update (never an unattended swap under a live document) and a Workbox precache of the lazy feature chunks and KaTeX fonts, so Print and math still work offline.
- **Sanitized HTML.** `markdown-it` runs with `html: true` for KaTeX/Mermaid output; every fragment is run through DOMPurify and a second pass that strips automatic remote-resource loads. Embedded raster data URLs are the only images allowed in the browser; the Windows app also shows local images a document references by a relative path (PNG, JPEG, GIF, WebP, SVG as an image; `../` may reach elsewhere on the same drive), read from disk, never fetched, and shown only in its own window.

## Architecture

Pagination measures real, laid-out heights. Anything that still has to load — a grammar, a diagram, a font — changes those heights. So the pipeline is strict, and **pagination runs last**.

```mermaid
flowchart TD
  ingest["Editor / drop / paste / picker<br/>ui/Editor.ts · app/input.ts"]
  store["DocStore + Settings<br/>app/state.ts · settings.ts"]
  appNode["App.runPipeline<br/>app/App.ts"]
  hl["Shiki + curated grammars<br/>render/highlight.ts"]
  md["markdown-it + KaTeX<br/>render/markdown.ts · math.ts"]
  san["DOMPurify + remote-URL strip<br/>render/sanitize.ts"]
  src["TOC + inline footnote floats<br/>render/buildSource.ts"]
  mer["Mermaid fixed-size SVG<br/>render/mermaid.ts"]
  wait["await fonts and images"]
  page["Paged.js paginate LAST<br/>paginate/paginate.ts · handler.ts<br/>cssBuilder.ts · shrinkToFit.ts"]
  repair["href-only footnote repair<br/>paginate/footnoteLinks.ts"]
  print["print.ts · vector window.print"]
  raster["download.ts · html2canvas-pro + jsPDF"]
  save["export/markdown.ts · source download"]

  ingest --> store --> appNode
  appNode --> hl --> md --> san --> src --> mer --> wait --> page --> repair
  repair --> print
  repair --> raster
  store --> save
```

Re-pagination (paper, margins, font, TOC, headers, line numbers) re-runs the full render pipeline: Markdown, Mermaid, fonts and images, then pagination. Screen theme, zoom, view mode and split ratio are CSS-only and are not reflow keys.

Renders are **serialized**, not just debounced: two overlapping pipeline runs would share one Paged.js host and page counter. Both export paths capture the document and settings at click time and `await` a render lock, so an export mid-keystroke cannot ship the previous pages.

```
src/
  main.ts          Vite entry — boots the app, wires drag/drop/paste, PWA prompt
  app/             App controller, DocStore, settings, input, Pulseboard seam
  ui/              toolbar, source editor, splitter, canvas, empty state, banner
  render/          markdown-it + Shiki + KaTeX + Mermaid + sanitize + source builder
  paginate/        Paged.js engine, @page CSS, measure, shrink-to-fit, footnote hrefs
  export/          print (vector), download (raster), Markdown source save
  styles/          app / workspace / editor / preview / document / print / shiki / PWA
  types/           local ambient shims
tests/             Vitest unit + Playwright Chromium e2e (incl. no-cutoff)
docs/              vision, architecture, roadmap, design contract
```

Deeper map: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`autodoc/AGENT_INDEX.md`](autodoc/AGENT_INDEX.md).

## Quick start

Requires Node `^24.15.0 || >=26` ([`package.json` `engines`](package.json)). Production builds and Chromium verification use Node 24 with strict engine checks. CI retains its existing Node 22 check as a legacy compatibility probe until branch protection is updated; Node 22 is not a supported installation target.

```bash
npm install      # install dependencies
npm run dev      # Vite dev server (default http://localhost:5180 — use the URL it prints)
npm run build    # typecheck + production bundle in dist/ + licence bundle
npm start        # build, then serve dist/ on 127.0.0.1:4173 and open it
```

`npm run serve` serves an already-built `dist/` (default `127.0.0.1:4173`) without rebuilding. On Windows, `Start MDviewer.cmd` is a double-click wrapper around `npm start`.

The app opens in **Split**: source on the left, paginated preview on the right. Type, or drop a `.md` / `.markdown` file. **View** switches Markdown / Split / Preview. **Document layout** holds typography, paper and page furniture. **Print / Save as PDF** is the quality path — in the browser dialog, set the destination to **Save as PDF**.

For public hosting, Tailscale, and tunnels, see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). A git push does not deploy; production is a reviewed promotion of a tested `dist/`.

Useful checks (CI runs these on Node 24, plus the legacy Node 22 probe and Chromium against the production bundle):

```bash
npm run typecheck
npm run lint
npm run test          # Vitest
npm run build         # production dist/, which the preview e2e target serves
E2E_TARGET=preview npm run test:e2e  # Playwright Chromium against the production bundle, incl. tests/e2e/nocutoff.spec.ts
npm run agent:check   # typecheck + lint + unit + serve tests + observatory guard
```

## How export works

MDviewer paginates once with [Paged.js](https://pagedjs.org/) and feeds that single, already-broken page layout to **two** export paths:

1. **Print / Save as PDF (primary).** `window.print()` plus print-media CSS. Vector: selectable text, crisp code, smallest file. The breaks in the preview are the breaks in the PDF. In the browser print dialog, choose **Save as PDF**.
2. **Download PDF (fallback).** Rasterizes each already-paginated page with html2canvas-pro and assembles a PDF with jsPDF. Text is not selectable and the file is larger. Same page-break safety. Best-effort; use the print path when you can.

The exported PDF is **always dark-on-white**, regardless of the screen theme. Closing the last document tears down injected Paged.js styles so a later print cannot pick up stale sheets.

## Tech stack

Versions from [`package.json`](package.json) at this commit. CI (`.github/workflows/ci.yml`) verifies Node 24, retains the legacy Node 22 required check, and runs Playwright Chromium against `vite preview` of the production bundle on Node 24.

| Layer | What |
| --- | --- |
| Language / build | TypeScript 6, Vite 8, ESLint 10, `engines.node` `^24.15.0 \|\| >=26` |
| UI | Vanilla TypeScript. No React/Vue/Svelte. Toolbar, editor, splitter and canvas are small DOM builders. |
| Markdown | markdown-it 15 + footnote, anchor, toc-done-right, container, attrs, task-lists. `html: true`, then DOMPurify. |
| Highlight / math / diagrams | Shiki 4 (fine-grained core + Oniguruma WASM; extra grammars on demand), KaTeX 0.19, Mermaid 12 |
| Pagination | Paged.js 0.4.3 — the only pagination engine |
| Export | `window.print()`; html2canvas-pro + jsPDF 4 as fallback; Blob download for source `.md` |
| Tests | Vitest 5 + jsdom; Playwright Chromium e2e, including the no-cutoff geometry check |
| PWA | `vite-plugin-pwa`, Workbox precache, prompt-based updates |
| Hosting | Static files on Cloudflare Pages. No document backend. |

## Status and roadmap

From [`docs/Project_Roadmap.md`](docs/Project_Roadmap.md) and the open GitHub issue list.

| Phase | Status | Notes |
| --- | --- | --- |
| P0 Scaffolding | Done | Repo, Vite/Vitest/Playwright, pinned design specs |
| P1 Core pipeline | Done | Render → paginate → both export paths; no-slice e2e; Gate 3 (manual Chrome PDF inspection) accepted |
| P2 Desktop authoring and UX | In progress | New, Format, guarded undo, Find/Replace, session positions/navigation, visible PDF progress and second-engine/accessibility regressions are shipped. File ownership/recovery implementation and human acceptance remain in [Future work](docs/FUTURE_WORK.md). |
| P3 Hardening and distribution | In progress | Windows reader/installer preview, sanitization, offline PDF qualification and performance tooling are shipped. [#169](https://github.com/Chris0Jeky/MDviewer/issues/169) retains native acceptance; [#201](https://github.com/Chris0Jeky/MDviewer/issues/201)/[#202](https://github.com/Chris0Jeky/MDviewer/issues/202) track cancellation and measured responsiveness. Live/PWA and first automated promotion remain human gates. |
| P4 Stretch | Deferred | Extra paper sizes/orientations; custom user themes |

**Windows direction:** a simple, efficient desktop Markdown reader/editor with dependable local files and page-safe PDFs. The [future-work map](docs/FUTURE_WORK.md) separates delivered writing improvements, reviewed storage designs and remaining implementation gates. Native acceptance and measured memory work remain in [#169](https://github.com/Chris0Jeky/MDviewer/issues/169); the live [issue list](https://github.com/Chris0Jeky/MDviewer/issues) owns execution status.

Operator-only live-site and deploy gates (split-workspace feel, PWA update toast, Beta-bar acceptance, first automated promotion) live in [`ACTION_ITEMS.md`](ACTION_ITEMS.md). They are not product gaps in the code path above.

## Security

- **Documents do not leave the device.** No document `fetch` / XHR / WebSocket. No automatic or app-managed document/session storage; explicit user-requested local saves are supported. The one runtime network exception is the Pulseboard SDK on the production origin, reached only through [`src/app/pulse.ts`](src/app/pulse.ts) with closed enums, size buckets and counts. [`tests/pulse.test.ts`](tests/pulse.test.ts) and [`tests/pulse-egress.test.ts`](tests/pulse-egress.test.ts) guard that seam.
- **Untrusted Markdown is sanitized** before it hits the DOM (`src/render/sanitize.ts`). Executable tags, event handlers and automatic remote resource URLs are stripped; Mermaid SVG is sanitized again. User-initiated `https:` links remain clickable.
- **Error messages are kept off telemetry.** `installErrorShield` stops `error` / `unhandledrejection` reaching the SDK so a KaTeX or Mermaid parse error cannot leak document text.
- **Production `dist/` carries the GPL text**, the exact corresponding-source link, the project notice, and installed dependency licence texts (`THIRD_PARTY_NOTICES.md`; written by `npm run build`). Preserve those files when you redistribute a build.
- There is no `SECURITY.md` in this repo. Report a document-exfiltration or XSS path to the owner rather than in a public issue.

## For contributors and agents

Start with [`ACTION_ITEMS.md`](ACTION_ITEMS.md) (human-only gates + current-state snapshot) and the resumable [`ORCHESTRATOR.md`](ORCHESTRATOR.md). Repo-wide rules: [`AGENTS.md`](AGENTS.md). Then the design contract:

- [`docs/design/IMPLEMENTATION_SPEC.md`](docs/design/IMPLEMENTATION_SPEC.md) — pinned signatures, the load-bearing render order, CSS/DOM names, no-slice tiers.
- [`docs/design/LIBRARY_NOTES.md`](docs/design/LIBRARY_NOTES.md) — version-correct integration notes for each library.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — pipeline, module responsibilities, CSS split.
- [`docs/Project_Roadmap.md`](docs/Project_Roadmap.md) — phase status and gates.
- [`docs/FUTURE_WORK.md`](docs/FUTURE_WORK.md) — prioritized issues, dependencies, acceptance and deferred choices.
- [`autodoc/AGENT_INDEX.md`](autodoc/AGENT_INDEX.md) — code-seam map.

Do not reorder the render pipeline or add a document network call. Current document writes are explicit user-requested saves; automatic storage remains outside the shipped contract. The proposed file/recovery work must update that contract and privacy documentation through review before implementation. PRs merge with a merge commit (no squash). `main` is protected: no rebase, force-push, or history rewrite.

## License

GNU General Public License version 3 only (`GPL-3.0-only`). See [`LICENSE`](LICENSE) and
[`RELICENSING.md`](RELICENSING.md). Versions published before 12 August 2026 remain available
under their existing MIT grant ([`LICENSES/MIT.txt`](LICENSES/MIT.txt)). Dependencies keep their
own licences; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Links

- Live app: https://mdviewer-c9r.pages.dev/
- Product vision: [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Implementation spec: [`docs/design/IMPLEMENTATION_SPEC.md`](docs/design/IMPLEMENTATION_SPEC.md)
- Roadmap: [`docs/Project_Roadmap.md`](docs/Project_Roadmap.md)
- Deployment: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- Performance budget: [`docs/PERF_BUDGET.md`](docs/PERF_BUDGET.md)
- CI: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- License: [`LICENSE`](LICENSE)
