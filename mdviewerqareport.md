# MDviewer — Manual QA Report

**Site:** https://mdviewer-c9r.pages.dev/
**Date tested:** 16 August 2026
**Environment:** Chromium (desktop), ~1450×840 and ~1054×611 viewports
**Scope:** Full manual pass over document loading, rendering, all toolbar controls, PDF export, edge-case input, security probing, performance, and accessibility.

---

## 1. Summary

MDviewer is in good shape for a local-first tool: the core promise (clean pagination, no sliced code blocks/tables/figures, everything client-side) largely holds up, sanitization of hostile input is solid, and the accessibility groundwork (aria labels, aria-pressed, live regions, skip link, focus-visible styles, reduced-motion support) is well above average.

That said, testing surfaced **2 broken features** (zoom controls, page position indicator), **3 clear rendering bugs** (inline footnotes, TOC titles disappearing, table cell clipping), and a set of UX gaps that make the app feel less trustworthy than its engine deserves, chiefly around feedback during long operations and preview-vs-print consistency.

**Verdict: solid engine, rough edges in the shell.** Most fixes below are small relative to the value they add.

---

## 2. What works well (worth keeping)

- **Core pagination promise holds.** Tall code blocks, tables, diagrams and callouts are genuinely never sliced across pages; they move as units.
- **Hostile input is handled safely.** `<script>` tags, `<img onerror>` handlers and `javascript:` links were all neutralized (page title never changed, no script executed), and a clear warning banner reported "Blocked 3 unsafe HTML items or remote-resource references."
- **Graceful degradation.** A broken Mermaid diagram shows a friendly "Diagram failed to render" card with the source preserved; an unclosed code fence renders sensibly; an empty `.md` file doesn't crash anything.
- **Zero external requests.** The app loads one JS bundle, one CSS file and a favicon, all same-origin. The "nothing is uploaded" privacy claim is verifiably true. Load is fast (DOMContentLoaded ~350 ms).
- **Settings persist** across reloads (theme, fonts, paper, margins, toggles, header text) via local storage.
- **Accessibility groundwork:** aria-pressed on all toggles, aria-labels on every control, `aria-live` status/warning/error regions, a skip link, focus-visible styles, `prefers-reduced-motion` and `prefers-color-scheme` support.
- **Multi-document support** works: multiple files can be loaded and switched via the DOCUMENT dropdown.
- **Print wiring is correct:** the Print / Save as PDF button calls `window.print()` exactly once, backed by a dedicated print stylesheet.

---

## 3. Bugs (functional defects)

### BUG-1 — Zoom controls are completely non-functional — **High**
Clicking **100%** (Actual size) or **50%** (Half size) does nothing: the page width does not change, and `aria-pressed` stays on "Fit". Verified both by real clicks and programmatic clicks; state never updates. A visible, three-option control that silently does nothing is a trust-killer.

*Repro:* Load the sample document → click "50%" → nothing happens; "Fit" remains selected.

### BUG-2 — Footnote body renders inline inside the paragraph — **High**
In the sample document, the footnote text ("Footnotes are collected per page using CSS floats…") is injected mid-sentence right after the `[1]` marker, in smaller type, splitting the host sentence in two ("Footnotes[1] …footnote text… sit at the bottom of the page they are referenced from"). The footnote never appears at the foot of the page in the on-screen preview. This directly contradicts the sample's own claim and the printed-paper metaphor.

*Repro:* Load Sample.md → page 1, "Prose and Typography" paragraph.

### BUG-3 — TOC entry title disappears for headings with emoji/non-ASCII — **High**
A document titled `# QA Edge Cases 🧪 ünïcødé` produces a TOC entry that shows **only the page number "1"** with a leader line; the heading text is entirely missing. The same TOC works for plain-ASCII headings in the sample document.

*Repro:* Enable TOC → load a `.md` whose H1 contains an emoji.

### BUG-4 — Long unbreakable table cell content is clipped at the page edge — **Medium**
A table header cell containing a long unbroken string runs past the right text margin all the way to the paper edge and is visually clipped. Long unbroken words in *body text* wrap correctly, and long code lines wrap correctly, so tables are the odd one out (needs `overflow-wrap:anywhere` / `word-break` inside cells, or table layout constraints).

### BUG-5 — Page position indicator never updates on scroll — **Medium**
The "Page 1 / 8" chip stays at "Page 1" no matter how far you scroll (verified at page ~6: chip still reads "Page 1 / 8"). It also seems to hide while scrolling, exactly when it would be useful. Either track the visible page or remove the "Page N" half of the chip.

### BUG-6 — Rejected files fail silently — **Medium**
Dropping/choosing an unsupported file (e.g. `.exe`, or any non-`.md`) produces **no visible feedback** whatsoever. The file is simply ignored. Users who drop the wrong file (or a `.txt` containing markdown) will think the app is broken. Show a toast: "file.txt isn't a supported type — only .md and .markdown."

### BUG-7 — TOC insertion point is inconsistent — **Low**
In the sample document the TOC appears *after* the intro paragraphs; in a minimal test document it appears *above the H1 title*. Pick a deterministic rule (after the first H1, or always at the top, or a `[[toc]]` marker) and document it.

### BUG-8 — KaTeX errors fail silently — **Low**
An invalid expression (`$\notacommand{x}$`) renders as plain italic text with the backslash silently eaten, with no error styling and no mention in the warning banner (Mermaid failures, by contrast, are reported). Use KaTeX's `errorColor`/`throwOnError:false` styling or add it to the warning banner.

### BUG-9 — Page 1 has no page number or running header — **Low**
With "Page numbers" and a running header enabled, page 1 shows neither (page 2 onward is fine). If suppressing them on the title page is intentional, it should be a visible option; right now it reads as a defect, especially for documents that don't have a title page.

---

## 4. UX / feel issues

### UX-1 — No progress feedback on "Download PDF" — **High**
Clicking Download PDF rasterizes every page (~0.5 s/page, ~5 s for the 8-page sample) with **zero UI feedback**: the button doesn't disable, there's no spinner, no progress ("Rendering page 3 of 8…"), and no completion toast. Users will click it multiple times and get multiple downloads. Same for large documents where this could take 30+ seconds.

### UX-2 — Preview theme controls look like document settings — **High**
Light/Dark/Sepia sits in the same toolbar cluster as Code theme, Body font and Font size — all of which *do* change the document. But the theme buttons only re-skin the app chrome; the paper stays white. Users will toggle "Dark" expecting a dark PDF. Separate the app-appearance control visually (e.g. an icon at the far right) from document settings, or label it "App theme".

### UX-3 — Preview doesn't match the printed output for code blocks — **Medium**
Code blocks render **dark** on screen while the exported PDF "always uses the light theme". For a tool whose entire preview is a print preview, this is a WYSIWYG break: what you proof-read is not what you print. Consider light-on-screen code in the light preview theme, or an explicit "print preview" toggle that shows exactly what will export.

### UX-4 — Pagination is slow, blocks the view, and loses your place — **Medium**
- Initial pagination of the 6-page sample took ~8–10 s with only a generic "Paginating…" overlay (no progress, no page count ticking up).
- *Every* settings change (font, size, margins, paper, toggles) triggers a full re-paginate and **resets the scroll position to the top**, so comparing "11 pt vs 12 pt" at page 5 means scrolling back down every time. Preserve scroll position (anchor to the nearest heading/block) across re-pagination.
- During the first load, the "Drop a Markdown file to begin" empty state stays visible *behind* the semi-transparent overlay while content renders, which looks glitchy.

### UX-5 — Empty state looks unfinished — **Medium**
The landing view is a big left-aligned headline with an awkward mid-sentence line break, an unstyled native "Choose file…" button, a floating "or", and a second native-looking button below it. It's the first thing every new user sees and it doesn't match the polish of the toolbar. Center it, style the buttons like the rest of the app, and put "Choose file / or / Try a sample" on one visual axis.

### UX-6 — Documents are lost on reload with no warning — **Medium**
Refreshing the tab silently discards all loaded documents (settings survive, documents don't). Understandable for a privacy-first tool, but there's no `beforeunload` guard and no hint. Either warn before unload when documents are loaded, or persist document content locally too (it never leaves the browser either way), or say "Documents aren't kept after you close the tab" in the empty state.

### UX-7 — No way to close/remove a loaded document — **Low**
The DOCUMENT switcher accumulates every file you've opened (`Sample.md`, `edge-cases.md`, `empty.md`…) with no ✕ / remove option.

### UX-8 — TOC typography: leader line runs *past* the page number — **Low**
TOC entries render as "Mathematics 3 ————" with the dotted rule extending to the right margin *after* the number, instead of the conventional "Mathematics ………… 3" with right-aligned numbers. Looks like a rendering artifact rather than a design choice.

### UX-9 — Task-list checkmarks are nearly invisible — **Low**
Checked items render as a very light gray check on a light gray box; at reading distance checked and unchecked look identical (and this will be worse in print). Increase contrast.

### UX-10 — Large trailing whitespace from keep-whole blocks — **Low**
The no-slice guarantee sometimes leaves close to half a page blank (e.g. before a tall code block moves to the next page). That's an inherent trade-off, but consider tightening the threshold, or noting it, so it doesn't read as a layout error. A displayed equation was also pushed to the next page whose running header then showed the *next* section's name, which mislabels the equation's section.

### UX-11 — Toolbar labels are cramped and clip — **Low**
"Code theme", "Body font" and "Header" labels visually collide with their controls at common window widths ("Header" partially clips under the input at ~1450 px). Add breathing room and `min-width` handling.

### UX-12 — Empty document gives a blank page with no hint — **Low**
An empty `.md` renders "Page 1 / 1" of pure white. A small inline hint ("This document is empty") would help users who exported the wrong file.

---

## 5. Technical / engineering improvements

### TECH-1 — No responsive design — **High**
The stylesheet contains **zero width-based media queries** (only `print`, `screen`, dark-scheme and reduced-motion). On a tablet or phone the fixed toolbar rows will overflow and the app is effectively desktop-only. Even a basic collapse of the toolbar into two wrapping rows or a "settings" sheet would go a long way — mobile users are exactly the ones who need "Markdown to PDF in the browser".

### TECH-2 — Debug logging left in production — **Medium**
Download PDF floods the console with per-page DEBUG logs from the rasterizer (document clone timings, base64 image dumps). Strip or gate behind a `?debug` flag; it bloats memory on large documents and leaks implementation details.

### TECH-3 — No offline support despite being fully local — **Medium**
There's no service worker and no web-app manifest. The app is 100% self-contained — it's *one* `sw.js` away from working on a plane, which would be a headline feature for a "nothing is uploaded" tool. A manifest + icons would also make it installable as a PWA.

### TECH-4 — Missing favicon link and social meta — **Low**
No `<link rel="icon">` element (the browser falls back to `/favicon.ico`), no Open Graph / Twitter card tags. Title, meta description, `lang` and viewport are all present and good.

### TECH-5 — Export buttons active with no document — **Low**
"Print / Save as PDF" and "Download PDF" are enabled at Page 0 / 0. Disable them (with a tooltip) until a document is loaded.

### TECH-6 — Keyboard scrolling of the preview is doubtful — **Low**
The scroll container (`main.canvas`) has `tabindex="-1"`, so it can't be reached with Tab, and Ctrl+Home/keyboard scrolling did nothing during testing until the pane was clicked. Consider `tabindex="0"` on the scroller (it already has an aria-label) so keyboard-only users can scroll the document.

---

## 6. Accessibility notes

Mostly strong (see §2). Remaining items:

1. **Preview scroller not keyboard-focusable** (TECH-6).
2. **Task-list check contrast** fails at a glance (UX-9); likely below WCAG 1.4.11 non-text contrast.
3. **Page chip is misleading** for screen-reader users too if it never updates (BUG-5) — a stale "Page 1 / 8" announced via any live mechanism would be wrong information.
4. TOC leader/number layout (UX-8) may read oddly in reading order — verify the anchor text includes both title and number.
5. Zoom buttons announce state via `aria-pressed` but state never changes (BUG-1) — once fixed, this is fine.

---

## 7. Security & privacy observations (positive)

- Script tags, event-handler attributes and `javascript:` URLs are stripped or inertized; blocked content is *reported* to the user rather than silently dropped — nice touch.
- Remote-resource references are blocked, consistent with the no-network promise.
- Verified zero third-party/network calls at runtime; everything ships in one same-origin bundle.
- Suggestion: consider adding a Content-Security-Policy header (e.g. `default-src 'self'`) as defense-in-depth — cheap to add on Cloudflare Pages and it hard-guarantees the privacy claim.

---

## 8. Suggested priorities

| Priority | Items |
|---|---|
| **P0 — broken features users will hit immediately** | BUG-1 zoom, BUG-2 footnotes, UX-1 download feedback |
| **P1 — correctness & trust** | BUG-3 TOC titles, BUG-4 table clipping, BUG-5 page chip, BUG-6 silent file rejection, UX-2 theme confusion, UX-4 scroll reset, TECH-1 responsive |
| **P2 — polish** | UX-5 empty state, UX-6 reload data loss, BUG-7/8/9, UX-7…12, TECH-2…6 |

---

## 9. Test coverage notes

Tested: sample document flow; file ingestion via the file input (valid .md, empty .md, unsupported binary); all three preview themes; all six code themes' control (spot-checked GitHub/Nord); body fonts and sizes; A4/Letter; all margin presets; TOC, page numbers, line numbers, running header; zoom controls; document switcher; markdown edge cases (emoji/unicode headings, raw HTML/XSS vectors, `javascript:` links, long unbreakable words/lines/cells, broken Mermaid, invalid KaTeX, unclosed fences, task lists, tables); Download PDF end-to-end; Print button wiring (hooked, not printed); reload persistence; console/network inspection; CSS media-query audit; aria/focus audit.

Not tested: actual OS print dialog output quality; true drag-and-drop gesture (simulated via the file input); very large documents (100+ pages) — recommend a stress test given per-page rasterization cost; Safari/Firefox behavior; touch devices (blocked by TECH-1 anyway).
