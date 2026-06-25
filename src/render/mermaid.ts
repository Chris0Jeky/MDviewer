/**
 * Mermaid diagram rendering — runs AFTER markdown render, BEFORE pagination.
 *
 * Mermaid is async (it lays out an SVG), so it must complete before Paged.js measures
 * heights or breaks would land in stale space. We render each block to a fixed-size SVG
 * (`useMaxWidth:false`) inside a `figure.mermaid-figure` (an atomic, break-inside:avoid
 * block). The library is lazy-imported on first use and initialized exactly once. A block
 * that fails to parse becomes a bordered placeholder that still shows its raw source, so a
 * single bad diagram never aborts the export.
 */

import { CLASSES } from "../app/dom";

export type MermaidTheme = "default" | "dark" | "neutral" | "forest" | "base";

let initialized = false;

/** Escape raw diagram source for safe embedding in the failure placeholder. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => {
    if (c === "&") return "&amp;";
    if (c === "<") return "&lt;";
    return "&gt;";
  });
}

/**
 * Render every Mermaid block under `root` in place. Returns counts so the caller can decide
 * whether to surface a "N diagrams failed" warning. Idempotent on already-rendered docs
 * (selectors only match unrendered `code.language-mermaid` / `.mermaid` sources).
 */
export async function renderAllMermaid(
  root: ParentNode,
  theme: MermaidTheme = "default",
): Promise<{ rendered: number; failed: number }> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>(
      "pre > code.language-mermaid, code.language-mermaid, .mermaid",
    ),
  );
  if (blocks.length === 0) return { rendered: 0, failed: 0 };

  const mermaid = (await import("mermaid")).default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: "strict",
      flowchart: { useMaxWidth: false },
    });
    initialized = true;
  }

  let rendered = 0;
  let failed = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    // For a fenced ```mermaid block the source is a <code> inside <pre>; replace the <pre>.
    const host = block.tagName === "CODE" ? (block.closest("pre") ?? block) : block;
    const code = block.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mmd-${i}`, code);
      const figure = document.createElement("figure");
      figure.className = CLASSES.mermaidFigure;
      figure.innerHTML = svg;
      host.replaceWith(figure);
      rendered++;
    } catch {
      const fig = document.createElement("figure");
      fig.className = CLASSES.mermaidFigure;
      fig.innerHTML = `<div class="diagram-error">⚠ Diagram failed to render</div><pre><code>${escapeHtml(
        code,
      )}</code></pre>`;
      host.replaceWith(fig);
      failed++;
    }
  }
  return { rendered, failed };
}
