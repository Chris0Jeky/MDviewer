# MDviewer

**Drag a Markdown file in, get a beautiful PDF out — with no code block, figure, table, or callout ever sliced across a page boundary.**

MDviewer is a browser-based, drag-and-drop Markdown → PDF tool built for **research papers and code-heavy technical docs**. It runs 100% in your browser: nothing is uploaded, no document is ever stored on a server, and there are no runtime network calls. The only thing it persists is a small settings object in `localStorage`.

> ![MDviewer preview — drag a file onto the dropzone; the paginated PDF preview renders on the right.](docs/assets/screenshot-placeholder.png)
>
> _Screenshot placeholder — replace `docs/assets/screenshot-placeholder.png` once the UI is verified in a real browser._

## Why MDviewer exists

Typical online Markdown-to-PDF converters slice a code listing in half at the page break, orphan a table header, or cut a diagram down the middle. For a paper or a technical doc, that is unacceptable. MDviewer's **#1 value proposition** is the **no-slice guarantee**: atomic blocks stay whole, and when a block is genuinely taller than a page, it splits cleanly (repeated table headers, continuous frames, shrink-to-fit) instead of being chopped.

See [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md) for the full rationale.

## Quick start

```bash
npm install      # install dependencies
npm run dev      # start the Vite dev server, then open the printed localhost URL
npm run build    # produce a production bundle in dist/
```

Then drag a `.md` / `.markdown` file onto the window (or paste Markdown, or use the file picker), and the paginated preview renders on the right.

## How export works

MDviewer paginates once with [Paged.js](https://pagedjs.org/) and feeds that single, already-broken page layout to **two** export paths:

1. **Print / Save as PDF (primary, recommended).** Uses `window.print()` with print-media CSS. The output is **vector** — selectable text, crisp code, smallest file — and the page breaks you see in the preview are exactly what you get. In the browser print dialog, choose **"Save as PDF"** as the destination.
2. **Download PDF (fallback).** Rasterizes each already-paginated page to a canvas and assembles a PDF with jsPDF. The text is not selectable and the file is larger, but it inherits the same page-break safety and works when the print path is inconvenient. Best-effort; the primary path is preferred for quality.

The exported PDF is **always dark-on-white**, regardless of the screen theme you preview in.

## Features

- **Syntax-highlighted code** via [Shiki](https://shiki.style/) (TextMate-grade, dual light/dark themes; print forces the light side for clean PDFs).
- **Math** via KaTeX (inline and display; bad TeX renders red inline instead of breaking the document).
- **Diagrams** via Mermaid (fixed-size SVG so pagination measures them correctly).
- **Callouts** — `note` / `tip` / `warning` / `danger` admonition blocks.
- **Footnotes** that float to the bottom of the page they are referenced on.
- **Auto table of contents** with real, Paged.js-generated page numbers.
- **Themes** — light / dark / sepia screen themes, six code-theme families.
- **Paper sizes** — A4 and US Letter, with narrow / normal / wide margins.
- Optional running header, page numbers, and code line numbers.

## Project layout

```
src/
  main.ts          Vite entry — boots the app, wires global drag/drop/paste, imports CSS
  app/             controller, document store, settings, DOM-name constants
  ui/              toolbar, canvas/preview, empty state, warning/error banner
  render/          markdown-it + Shiki + KaTeX + Mermaid + pagination-source builder
  paginate/        Paged.js engine, @page stylesheet builder, measure, shrink-to-fit
  export/          print (vector) and download (rasterized) paths
  styles/          app/preview chrome CSS + document/print/shiki document CSS
  types/           local ambient shims (no upstream @types)
tests/             Vitest unit tests + Playwright E2E (incl. the no-cutoff guarantee)
docs/              product vision, architecture, roadmap, and the design specs
```

## For contributors and agents

Start with the design docs, which are the source of truth:

- [`docs/design/IMPLEMENTATION_SPEC.md`](docs/design/IMPLEMENTATION_SPEC.md) — file tree, pinned module signatures, the load-bearing render order, CSS/DOM names, no-slice tiers, and testing strategy.
- [`docs/design/LIBRARY_NOTES.md`](docs/design/LIBRARY_NOTES.md) — verified, version-correct integration snippets for every library.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the pipeline, module responsibilities, and CSS architecture.
- [`docs/Project_Roadmap.md`](docs/Project_Roadmap.md) — phase status and the active gates.
- [`autodoc/AGENT_INDEX.md`](autodoc/AGENT_INDEX.md) — fast code-seam map for finding where to edit.

## License

MIT (placeholder — author/license to be confirmed; see `ACTION_ITEMS.md` item AI-3).
