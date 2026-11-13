# Complete push: finish the queue, web parity, more formats, PDF workbench

Status: **direction set 2026-11-13 by the owner; contracts written by the coordinating session.**
Baseline: main `e5e96f5` (CI and Windows Desktop green). Tracker: #195. This file is the brief for
the implementing sessions. It states goals, seams, limits and proof; it does not prescribe code.
Where it conflicts with an older design note, this file wins for the rows in "Boundary changes"
and nowhere else. The 2026-11-11 companion push contract still governs everything it covers.

## Owner direction (2026-11-13, in chat)

1. Continue the project and make sure everything is finished and complete.
2. Make this the perfect local viewer for Markdown and other hard-to-read files.
3. The web version should be just as capable as the Windows app.
4. Make it able to modify PDFs. Any engineering trick is welcome, from decompiling the PDF to
   direct modification, novel ones included.

## What the review found (first-hand, main `e5e96f5`)

1. **The queue is open, not broken.** No feature PR is open. 44 issues are: three user-visible
   slices (#299, #300, #301), a group of reload/save races on the data-loss surface (#248, #249,
   #250, #255, #256, #257, #276), native polish (#302/#304/#305, #306), and hardening notes.
2. **The web app is a different, older product.** It has the data views, the source editor and both
   PDF exports, but none of the companion shell: no tabs, palette, panel, Library, continuous reader,
   Properties card, copy toolkit, clickable Actionable Markdown, Save in place, live reload,
   relative links, local images, templates or session restore.
3. **The gap is one seam wide.** Every native call sits in the `native` object in
   `src/desktop/native.ts`; nothing else calls `invoke`. The shell already runs in a plain browser
   (`playwright.desktop.config.ts` serves `desktop.html`), falling back to a file input and Save
   Copy. A browser host that satisfies the same contract gives the web the whole shell.
4. **No PDF input exists.** PDFs are output only (print, and html2canvas + jsPDF). No PDF parser is
   a dependency. The desktop CSP has `worker-src 'none'`; the web has no CSP.
5. **Readable data stops at six kinds** (`OPENABLE` in `src/app/renderText.ts`). Notebooks, diffs,
   XML, HTML, source code, config files and Office documents still open as nothing or as raw text.

## Named assumptions (reversible by the owner)

- **Permissive licences by preference** for new runtime dependencies (MIT, BSD, Apache-2.0, OFL for
  fonts). **Owner decision 2026-11-13:** the owner accepts AGPL source-offer duties, so MuPDF.js
  (`mupdf`, AGPL-3.0-or-later) is an allowed candidate wherever PDFium cannot do the job (most likely
  P5 structured text and P6 raw content streams and object access). A permissive option that does
  the job equally well is still preferred; MuPDF is adopted only on evidence of a real capability gain,
  and the adopting PR carries the conditions in `PDF_WORKBENCH.md` ("Licence decision"). MDviewer's
  own code stays `GPL-3.0-only`. The PDFium choice for P1 to P4 is not revisited.
- **"Hard-to-read files"** means the list in track D below. Reversible: drop or add a kind.
- **The web keeps working in every browser.** File System Access features light up where the
  browser has them (Chromium); elsewhere the app keeps the file-input and download behaviour and
  says so in the UI. Nothing is hidden behind a browser check without a visible reason.
- **PDF saves default to a copy.** In-place Save for a PDF is allowed on a bound file, with the
  same conflict rules as Markdown, and the first in-place save of a PDF in a session asks once.
- **Editable source inside exported PDFs is off by default** (track P, P5). One setting.

## Boundary changes

Everything not listed stays: no document network calls, no document telemetry, the sanitizer, the
render order, the no-slice guarantee, Pulseboard through `src/app/pulse.ts` only, no deploy (AI-9).
Each slice updates `AGENTS.md`, `PRODUCT_VISION.md`, the spec and the README privacy text in the PR
that ships its row.

| Was | Now | Limits |
| --- | --- | --- |
| Web saves are downloads | Web Save and Save As write the user's chosen file through the File System Access API where available | Only a handle the user picked or dropped; check for outside changes before writing; describe it as "checks for outside changes", never "conflict-safe"; download remains |
| Web persists `Settings` and `pulseboard:*` only | Plus one IndexedDB store, `mdviewer.library.v1`: file and folder **handles**, display names and timestamps | Never content; same caps as `library.json` (500 recents, 64 pins); Clear library empties it; permission is re-requested by the browser, never assumed |
| Web has no file following | Web re-reads open bound documents | Only open documents, only while the tab is visible, by `lastModified` and size, at most once a second; no folder polling |
| Web cannot resolve relative paths | Relative links, `@imports`, local images and templates resolve inside a folder the user granted | Never above the granted folder; same file-type and size policy as `assets.rs` and `file_policy.rs`, enforced in one shared TS policy module |
| Markdown and data files only | PDF is an openable kind on Windows and the web | Parsed locally (WASM allowed, lazy chunk); never rendered through the Markdown pipeline; scripts, launch actions and embedded files in a PDF are never executed or auto-opened; external links go through the existing confirm path |
| Desktop CSP `worker-src 'none'` | `worker-src 'self' blob:` only if the PDF engine needs a worker | Decided in P0 with evidence; `script-src` stays `'self' 'wasm-unsafe-eval'`; the `tests/desktop-csp.test.ts` guard is extended, not removed |
| Native reads and writes text | Native reads and writes PDF bytes for a bound file | Same token registry and replace primitive; 200 MB cap; no new generic file command |
| Six readable data kinds | The kinds in track D | Read-only views derived as Markdown by pure functions, per `READABLE_DATA.md`; Edit shows the raw text only for text formats; containers are never written |

## Track F: finish the queue

Order is by user value, then data-loss risk, then hardening. Close each issue with its PR; an issue
whose premise no longer holds is closed with the evidence, not fixed.

1. #299 D5 webview (copy menu, Save readable view as Markdown), #300 A5 (embeddable element),
   #301 (data-view polish, horizontal overflow first).
2. Reload and save races, one PR per coherent fix with a failing test first: #248, #255, #256, #257,
   #249, #250, #276, #251, then #277 and #240 (file-policy names).
3. #304, #305 (#302), #306 clippy in CI, #303 flaky chooser, #223 Windows path separators.
4. Readable data and Library follow-ups: #296, #291, #292 with #265, #278, #282, #254.
5. Export and pagination: #262, #242, #201; then #204 Unicode heading IDs.
6. Hardening: #229, #234, #236, #230, #243. Dependabot #216, #217, #218 triaged normally.
7. #197 recovery stays parked unless its evidence gate (`RECOVERY.md`) is met; #205, #206, #202 stay
   as they are and are restated in the close-out, not silently dropped.
8. Close-out: `ORCHESTRATOR.md`, `ACTION_ITEMS.md` snapshot, roadmap, `FUTURE_WORK.md`, the two
   leftover worktrees under `.claude/worktrees/` (check `.prototype/` and `desktop-artifacts/`
   before removal, law 7).

## Track D: more readable kinds

Same contract as `READABLE_DATA.md`: `derive(kind, text) → Markdown`, pure, unit-tested on
fixtures, display budget respected, shown by the existing reader, available on web and Windows in
the same PR (native side is only the extension lists in `file_policy.rs`). No new dependency.

- **D7, text-shaped (one PR per two or three kinds):** source code by extension (one fenced block
  in the Shiki language, with a symbol outline where cheap); `.diff`/`.patch` (per-file sections,
  added and removed lines marked, stats line); `.ipynb` (Markdown cells as Markdown, code cells as
  fences, text and image outputs, execution counts; outputs are data, never executed); `.xml`
  (readable tree with attributes, namespaces kept), `.html`/`.htm` (sanitized rendering through the
  existing DOMPurify path plus a Source toggle; remote resources stay stripped); `.ini`, `.env`,
  `.properties`, `.conf` (tables; values of keys matching secret-like names are masked until
  clicked); `.srt`/`.vtt`; `.svg` and raster images as a single-image document.
- **D8, containers (read-only):** `.docx`, `.xlsx`, `.pptx`, `.odt`, `.epub` to Markdown. Zip is
  read with `DecompressionStream("deflate-raw")` and a small central-directory reader; XML with
  `DOMParser`. Caps: 200 MB archive, 50 MB per entry inflated, 10,000 entries, no nested archives,
  paths never written anywhere. Headings, lists, tables, images, links and footnotes map to
  Markdown; anything unmapped is counted and named in an overview line, not dropped silently.
  "Save readable view as Markdown" (from #299) is the conversion feature.

## Track W: web parity

Goal: the web serves the same shell as Windows, with a browser host behind the `native` seam.

- **W0, host contract (no behaviour change).** Give the `native` object a typed `Host` interface
  and move the Tauri calls behind it. One shared in-memory fake replaces the two inline Tauri fakes
  in `tests/desktop-e2e/`. Proof: every unit, desktop e2e, Rust and native smoke check passes
  unmodified.
- **W1, browser host: open and save.** `showOpenFilePicker`, drag-and-drop with
  `getAsFileSystemHandle`, PWA `file_handlers` with `launchQueue`; Save through `createWritable`
  after re-reading the file and comparing size, `lastModified` and digest; Save As through
  `showSaveFilePicker`; encoding and line endings preserved exactly as the native path does (reuse
  its TS-side contract and fixtures). Without the API: file input, download, and a status line that
  says the document is a copy. Proof: Playwright against a real temporary folder in Chromium
  (origin private file system or the test-only picker override), byte-for-byte round trips for
  UTF-8, BOM, UTF-16 and CRLF, the outside-change refusal, and the Firefox lane proving the
  fallback.
- **W2, the shell on the web.** `index.html` boots the companion shell: Read (continuous reader,
  Properties card, copy toolkit, clickable Actionable Markdown with in-memory or bound write-back),
  Edit (`Ctrl+E`), PDF (the existing paginated workspace, unchanged, loaded on demand). Keep the
  PWA, the Pulseboard bar and its print exclusion, the sample document, the 250 kB confirm gate,
  the phone toolbar strip and every existing export test. Ship in two steps: the shell behind a
  second entry with the full desktop e2e suite running against the browser host, then the default
  flip in its own PR, accepted under its QA charter (AI-11), not an owner item. Shortcuts that browsers own (`Ctrl+P`,
  `Ctrl+K` in some, `Ctrl+T`, `Ctrl+W`) get web-safe alternatives listed in the palette.
- **W3, follow the file.** Visible-tab re-read of open bound documents; the same reader patch,
  conflict bar and "changed since you looked" mark as Windows.
- **W4, folders.** `showDirectoryPicker` grants a project: relative links, `@imports`, `[[name]]`,
  local images, templates, the bounded scan (depth 8, 5,000 files, same skip list), back and
  forward. A relative link without a grant offers the grant once, in place.
- **W5, Library and session on the web.** The IndexedDB handle store, Pinned, Recent, Projects,
  Activity and Agent files, session restore of bound files after the browser re-grants permission.
- **Close-out:** a parity table in `README.md` (feature by Windows, Chromium web, other browsers)
  generated from one source of truth the tests also read, so a missing feature fails a test rather
  than a reader's expectation.

## Track P: PDF workbench

Goal: open a PDF, read it well, change it, and save a valid PDF, all locally. Design file to write
in P0: `docs/design/PDF_WORKBENCH.md`. Code lives in `src/pdf/**` behind one lazy import; the
Markdown reader's cold start and the no-slice export must not change (prove both).

Principles:

- **Never destroy the original.** Every edit is an entry in an edit journal (undo, redo, replay).
  Where the engine allows, save as an *incremental update*: the original bytes stay intact at the
  front of the file, earlier signatures stay verifiable, and "Revert to original" is a truncation.
  Where a full rewrite is needed (page removal, true redaction, compaction) say so before saving.
- **What you see is what is saved.** One engine renders and writes; a second engine is allowed
  only for a job the first cannot do, and then a round-trip test opens its output in the first.
- **Real PDF objects, not pictures.** Annotations are standard annotations other readers show.
  Edited text is text (selectable, searchable), never a flattened image, except in P7.

Slices:

- **P0, spike and design (throwaway code, kept design).** Prove on real files, in Chromium and in
  WebView2 under the desktop CSP: render, text extraction with positions and font names, list the
  page objects, change one text object, save, reopen. Measure wasm size, load time and memory on a
  300-page file. Pick the engine set against the evidence table from the coordinator (below) and
  record the decision as an ADR inside `PDF_WORKBENCH.md`. Budget: one day; if no engine can edit a
  text object in place, P4 uses the remove-and-redraw path only and says so.
- **P1, open and read.** PDF as a document kind in the shell (tab, Library, drop, picker, native
  byte read). Continuous pages rendered on demand, text selection and copy, find, bookmarks as the
  Outline, page thumbnails, zoom, links (internal jump; external through the confirm path),
  password prompt for encrypted files (password held in memory only). 1,000-page file stays
  responsive: render visible pages only, release the rest.
- **P2, pages (lossless).** Reorder, rotate, delete, duplicate, extract to a new PDF, split, merge
  other PDFs, insert images as pages, insert a blank page, and **insert an open Markdown document
  as pages** through the existing paginated export. Objects are copied, never re-rendered.
- **P3, annotate, fill, sign.** Highlight, underline, strike, note, free text, ink, shapes, image
  stamp, a drawn or image signature stamp (not a cryptographic signature; say so), AcroForm fill,
  flatten on request. Written as standard annotations with appearance streams.
- **P4, edit what is on the page (direct modification).** Select a text run, image or vector
  object; move, resize, delete, restyle; retype text. Retyping uses a ladder and tells the user
  which rung was used:
  1. *In place:* the run's font has every needed glyph, so the text object's string is rewritten.
  2. *Font graft:* the embedded font is a subset that lacks a glyph. Find the full font by
     PostScript name and metrics among: other fonts embedded in the document, the user's installed
     fonts (Local Font Access API where the browser grants it), and bundled metric-compatible open
     fonts (Liberation for Arial, Times New Roman and Courier New; Carlito for Calibri; Caladea
     for Cambria). Redraw only the changed run in the grafted font, embedded as a subset.
  3. *Fit:* keep the line's right edge by adjusting character spacing or horizontal scale within
     ±3%. Beyond that, reflow the paragraph: group lines by font, leading and left edge, re-break
     in JS, rewrite those text objects, and stop at the paragraph's original box (overflow is
     reported, never clipped silently).
  4. *Remove and redraw:* delete the original operators from the content stream and draw new text
     at the same matrix. This is also the true-redaction path: the removed text is gone from the
     file, and Redact also strips matching text from annotations, bookmarks and metadata.
- **P5, decompile to Markdown and back.** "Edit as Markdown": derive Markdown from a PDF (tagged
  structure tree when present; otherwise headings from font-size clusters, lists, tables from
  ruling lines and column alignment, code from monospace runs, images extracted, links, footnotes,
  reading order by column detection), open it in the Markdown editor, and re-export through the
  no-slice pipeline. An overview line states what could not be mapped. **Source-carrying PDFs:**
  with the setting on, Download PDF embeds the Markdown source and export settings as an attached
  file with an `/AF` relationship; opening such a PDF offers "Open the original Markdown", which is
  a lossless round trip for MDviewer's own output.
- **P6, page source.** For people who want the raw thing: the object tree and each page's
  decompressed content stream as editable text beside a live re-render, with operator
  highlighting, parse errors shown in place, and save back (recompressed). Also: metadata editor,
  attachments list, "repair and rewrite" for damaged cross-reference tables.
- **P7, scans (later; own decision).** Local OCR to add an invisible text layer; "edit a scan" by
  patching the background from neighbouring pixels and drawing new text. Needs a model download
  policy (bundle size, offline) before it starts.

Proof for every P slice: unit tests on a committed corpus of small synthetic PDFs (generated in the
test, never copied from the owner's files) covering subset fonts, CID fonts with ToUnicode,
rotated pages, encrypted, linearized, incremental updates, forms and a damaged xref; a Playwright
round trip that saves, reopens and asserts text, page count and annotation presence; a check that
another reader's parser (the second engine, or `qpdf --check` in CI if available) accepts the
output; and the existing no-cutoff and export suites untouched and green.

### Engine evidence

The coordinator's dated primary-source research on candidate engines is handed to the PDF lane in
its brief. P0 verifies each claim in code and records the table and the decision in
`PDF_WORKBENCH.md`; this file does not carry it.

## Lanes and routing

Models resolve through the estate `model-effort-routing` skill. Three lanes, because the estate
GitHub budget allows three polling agents and each lane owns disjoint files.

| Lane | Order | Owns |
| --- | --- | --- |
| Finish | Track F, then D7, D8 | `src-tauri/**` (except PDF byte commands, coordinated with PDF lane), `src/data/**`, `src/render/**`, `src/desktop/reader/**`, state docs, agentic files |
| Web | W0 to W5 | the `Host` contract, `src/desktop/native.ts` and the new browser host, `index.html`, `src/main.ts`, `src/app/**` wiring, PWA manifest, `public/_headers` |
| PDF | P0 to P6 | `src/pdf/**`, `docs/design/PDF_WORKBENCH.md`, PDF wire-up lines in the shell, PDF byte commands in `src-tauri` (small, announced on the bus first) |

Rules for all lanes: estate laws govern (T2, merge free inside the gate, two review rounds at most,
three-minute head age, merge commits through `estate_merge.py`, ready-for-review PRs, one worktree
per slice under a short path such as `C:/Users/jekyt/source/mdv-<slice>`). The Web lane lands W0
first and announces it; until then the other lanes touch `src/desktop/{main,native}.ts` only for
wire-up lines. Merge `origin/main` into a slice branch before opening its PR. Sync the spec,
`AGENT_INDEX.md` and the roadmap in the PR that changes their truth; keep `ORCHESTRATOR.md` entries
to ten lines. Never deploy (AI-9); never self-clear an `ACTION_ITEMS.md` item. Distinct `E2E_PORT`
and `DESKTOP_E2E_PORT` per worktree. The owner's real files are private: read locally only, never
copied into the repository, a fixture, a PR or an issue. After each merge, five lines to the
coordinator: what merged, proof, what is not verified, next slice, any decision needed.

## Human items

Owner decision 2026-11-13: mechanical acceptance checks are agent QA work, not owner tasks. AI-6,
AI-7, AI-8, AI-10 and the hands-on boxes of #169 moved to "Delegated to agent QA" in
`ACTION_ITEMS.md` (delegated, not accepted); only AI-9 and the parked #169 signing decision stay
with the owner. The planned owner items become **QA charters** in `docs/qa/ACCEPTANCE.md`, run by
the QA lane on the first green build after a lane reports the feature merged: **AI-11** the web
shell before the default flip is deployed (W2); **AI-12** PDF editing on copies of invented PDFs
(P2 to P4); **AI-13** the new readable kinds (D7, D8). Lanes tell the QA lane when a user-visible
feature merges; they add no owner task. QA charters use invented files only, never the
owner's documents.
