# MDviewer — Product Vision

> The _why_ behind MDviewer. For _how_ it is built, see [`ARCHITECTURE.md`](./ARCHITECTURE.md),
> [`design/IMPLEMENTATION_SPEC.md`](./design/IMPLEMENTATION_SPEC.md), and
> [`design/LIBRARY_NOTES.md`](./design/LIBRARY_NOTES.md).

## The problem: page breaks that ruin documents

If you have ever converted a Markdown document to PDF with an online tool, you have probably seen it: a code listing chopped in half at the page break, a table whose header is stranded on the previous page, a diagram cut down the middle, or a callout box that bleeds across two pages. For a casual note this is annoying. For a **research paper** or a **code-heavy technical document** — the exact things people most often want to publish as PDF — it is unacceptable. It makes the document look unprofessional and, worse, genuinely harder to read.

The root cause is that most converters render HTML and let the browser (or a headless print step) break pages naively, with no awareness of which blocks must stay whole. MDviewer is built around fixing exactly this.

## The promise: the no-slice guarantee

**MDviewer's #1 value proposition is that exported PDFs never slice a code block, figure, table, or callout across a page boundary.**

Atomic blocks are kept whole. When a block is genuinely taller than a single page (where keeping it whole is physically impossible), MDviewer degrades gracefully rather than chopping it: table headers repeat on each continued page, block frames stay visually continuous, oversized code/diagrams shrink slightly to fit, and only as a true last resort does a block flow across pages — and even then it reads cleanly. This tiered strategy is specified in detail in the implementation spec and is verified by an end-to-end test that asserts no atomic block's rectangle ever straddles a page boundary.

## Who it is for

- **Researchers** turning a Markdown paper — with math, figures, tables, footnotes, and a table of contents — into a clean, print-ready PDF.
- **Developers and technical writers** publishing code-heavy docs, READMEs, design notes, and runbooks where code listings and diagrams must survive intact.

These two audiences share the same hard requirement: **structure must be preserved on the printed page.**

## Design principles

1. **Local-first and private.** Everything happens in your browser. No upload, no server round-trip, no telemetry, and no runtime network calls. Document bytes are never persisted — only a small settings object lives in `localStorage`. Your draft never leaves your machine.
2. **A focused tool, not an IDE.** MDviewer does one thing well: Markdown in, page-perfect PDF out. It is not a code editor, not a knowledge base, and not a document manager. The interface is a dropzone and a paginated preview with a small toolbar — nothing more.
3. **Vector-first export.** The primary export path is the browser's own print pipeline, producing vector PDFs with selectable text and crisp code. A rasterized fallback exists for convenience, but quality output is always the default.
4. **The no-slice guarantee is the product.** Every architectural decision — a single pagination engine, the strict render order, the pristine-clone re-pagination model, the tiered break strategy — serves keeping blocks whole. If a change would weaken the guarantee, it does not ship.

## Non-goals

- **No editor pane.** MDviewer renders and paginates; it does not let you author or edit Markdown in-app. Edit in your own editor, drop the file in.
- **No cloud.** No accounts, no sync, no server-side rendering, no document storage. The absence of a backend is a feature.
- **No multi-format zoo.** The output is PDF. We are not chasing DOCX, EPUB, or slide exports.
- **Not a general HTML printer.** The break strategy is tuned for the documents above, not arbitrary web pages.

## The quality bar

A document is "done" only when:

- No code block, figure, table, or callout is sliced across a page boundary in the exported PDF.
- Code is syntax-highlighted and legible; math renders correctly; diagrams are sharp.
- The table of contents carries real page numbers; footnotes sit at the bottom of the page that references them.
- The same page breaks you see in the preview are the breaks you get in the PDF.
- The exported PDF is dark-on-white and prints cleanly regardless of the screen theme.

Anything short of this is a bug, not a limitation.
