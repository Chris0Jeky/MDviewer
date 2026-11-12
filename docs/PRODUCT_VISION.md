# MDviewer — Product Vision

> The _why_ behind MDviewer. For _how_ it is built, see [`ARCHITECTURE.md`](./ARCHITECTURE.md),
> [`design/IMPLEMENTATION_SPEC.md`](./design/IMPLEMENTATION_SPEC.md), and
> [`design/LIBRARY_NOTES.md`](./design/LIBRARY_NOTES.md).

## Direction: a dependable desktop Markdown editor

MDviewer is a local Markdown reader/editor for everyday notes and technical writing,
with a page-accurate PDF workspace. The Windows app should make opening, creating,
writing, finding and saving direct and predictable. Reader startup stays light;
advanced layout tools appear when useful. The web/PWA build shares the rendering
and editing contracts and remains supported.

The owner direction on 2026-11-05 is a simple, powerful and efficient desktop
editor. [Future work](FUTURE_WORK.md) and [tracker #195](https://github.com/Chris0Jeky/MDviewer/issues/195)
translate that direction into scoped issues. New, Find/Replace, guarded undo and
compact desktop controls are shipped. Stronger file ownership and optional recovery
are proposed next designs, not descriptions of current persistence.

## The problem: page breaks that ruin documents

If you have ever converted a Markdown document to PDF with an online tool, you have probably seen it: a code listing chopped in half at the page break, a table whose header is stranded on the previous page, a diagram cut down the middle, or a callout box that bleeds across two pages. For a casual note this is annoying. For a **research paper** or a **code-heavy technical document** — the exact things people most often want to publish as PDF — it is unacceptable. It makes the document look unprofessional and, worse, genuinely harder to read.

The root cause is that most converters render HTML and let the browser (or a headless print step) break pages naively, with no awareness of which blocks must stay whole. MDviewer is built around fixing exactly this.

## The promise: the no-slice guarantee

**Normal-size code blocks, figures, tables and callouts stay whole when they fit on a page.** Page-safe output remains a defining quality of the editor.

Atomic blocks are kept whole. When a block is genuinely taller than a single page (where keeping it whole is physically impossible), MDviewer degrades gracefully rather than chopping it: table headers repeat on each continued page, block frames stay visually continuous, oversized code/diagrams shrink slightly to fit, and only as a true last resort does a block flow across pages — and even then it reads cleanly. This tiered strategy is specified in detail in the implementation spec and is verified by an end-to-end test that asserts no atomic block's rectangle ever straddles a page boundary.

## Who it is for

- **Researchers** turning a Markdown paper — with math, figures, tables, footnotes, and a table of contents — into a clean, print-ready PDF.
- **Developers and technical writers** publishing code-heavy docs, READMEs, design notes, and runbooks where code listings and diagrams must survive intact.

These two audiences share the same hard requirement: **structure must be preserved on the printed page.**

## Design principles

1. **Local-first and private.** Document content stays on the device, in the browser or local Windows host. No document upload, conversion server or document telemetry. Current documents and session state live in memory; explicit user-requested Markdown/PDF saves are allowed. Settings and the public-site SDK's documented consent/session keys are the only app-managed user state; the PWA separately caches application assets for offline use. Any future local recovery feature needs an explicit opt-in, retention/deletion and ownership contract before implementation.
2. **Direct everyday writing.** Keep common actions discoverable, keyboard friendly and compact. Use progressive disclosure for formatting, document layout and advanced tools. Avoid a mandatory project setup or a heavyweight editor migration; add capability when a concrete workflow justifies its cost.
3. **Efficient by measurement.** Keep the reader and full editing/PDF workspace independently loadable. Measure startup, responsiveness and retained resources on identified workloads before selecting optimizations. Bundle size is useful build evidence; representative Windows memory and startup claims require #169's measurements.
4. **One source of page geometry.** Vector print is the primary high-quality PDF path and raster download is the convenience fallback. Both consume the same paginated DOM. Reflows build fresh prepared source through the serialized pipeline; export can reuse a matching completed render. Preserve sanitization, render order and the explicit no-slice tiers.
5. **Accessible, recoverable interactions.** Show action state and errors where the user is working, preserve focus and native undo, and never silently discard or overwrite newer work. Automated regression checks and the still-open human typing/Narrator acceptance serve different purposes.

## Writing in the app

> **Reversed 2026-08-08 (owner decision).** This was previously a non-goal ("no editor pane"). It is now a shipped capability.

Dropping a file is still the fastest path, but you can also **write Markdown directly in MDviewer** and watch the paginated preview rebuild as you type — and a file you dropped is editable the same way, so a last-minute fix does not mean a round trip through another editor. The workspace toggles between three layouts: source only, preview only, or both side by side.

The source pane feeds the *same* pipeline that produces the PDF, so editing uses real page geometry. On Windows, New enters that workspace lazily, and Reading view returns with open documents and edits preserved. Save (Ctrl+S) and Save As write the document to its own file in place, conflict-checked ([#196](https://github.com/Chris0Jeky/MDviewer/issues/196)); Save Markdown stays a copy. Open files follow outside changes (a native watcher on their folders); unsaved edits are never replaced without a click. Unsaved text otherwise lives in memory; [optional recovery #197](https://github.com/Chris0Jeky/MDviewer/issues/197) is still design-only.

## Non-goals

- **No document cloud backend.** No accounts, cloud sync, remote conversion or server-side document storage.
- **Focused output.** Markdown source and PDF are the current outputs. DOCX, EPUB and slide export are outside the current roadmap.
- **Not a general HTML printer.** The break strategy is tuned for the documents above, not arbitrary web pages.

## The quality bar

A document is "done" only when:

- Normal-size atomic blocks remain whole in the exported PDF; genuinely oversized blocks follow the documented graceful-split/shrink tiers.
- Code is syntax-highlighted and legible; math renders correctly; diagrams are sharp.
- The table of contents carries real page numbers; footnotes sit at the bottom of the page that references them.
- The same page breaks you see in the preview are the breaks you get in the PDF.
- The exported PDF is dark-on-white and prints cleanly regardless of the screen theme.

Anything short of this is a bug, not a limitation.
