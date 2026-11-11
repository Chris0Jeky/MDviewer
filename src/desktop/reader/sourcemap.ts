import type { MarkdownIt, Token } from "markdown-it";

/**
 * Reader-only source map: block elements carry `data-src="start-end"` (1-based, inclusive,
 * clamped to the document) from markdown-it's `token.map`. The paginated pipeline never
 * installs this, so its output is unchanged.
 */
export interface ReaderSource {
  /** The original document lines; front matter is blanked for parsing, not here. */
  lines: string[];
  /** Fence bodies by their 1-based opening line, exactly as markdown-it read them. */
  fences: Map<number, string>;
}

export const SOURCE_ATTR = "data-src";

/** markdown-it's own line split (`\r\n`, `\r` and `\n` all end a line). */
export function sourceLines(text: string): string[] {
  return text.split(/\r\n?|\n/);
}

/** markdown-it ends some blocks (lists) after a trailing blank line; the stamp does not. */
function range(map: [number, number], lines: readonly string[]): string {
  const total = Math.max(lines.length, 1);
  const start = Math.min(Math.max(map[0] + 1, 1), total);
  let end = Math.min(Math.max(map[1], start), total);
  while (end > start && !lines[end - 1]?.trim()) end--;
  return `${start}-${end}`;
}

// Rules that print their own opening tag and ignore token attributes.
const RAW_RULES = /^(?:fence|html_block|math_block(?:_eqno)?|container_\w+_open)$/;

/** Stamp parsed block tokens (markdown-it keeps every block token at the top level). */
export function stampSourceMap(tokens: Token[], lines: readonly string[]): void {
  for (const token of tokens) {
    if (!token.block || !token.map || token.nesting === -1) continue;
    // markdown-it-container's map stops before its closing ::: line.
    const map: [number, number] = token.type.startsWith("container_") ? [token.map[0], token.map[1] + 1] : token.map;
    token.attrSet(SOURCE_ATTR, range(map, lines));
  }
}

/** Make the rules that print their own opening tag carry the stamp too. */
export function installSourceMap(md: MarkdownIt): void {
  for (const name of Object.keys(md.renderer.rules)) {
    if (!RAW_RULES.test(name)) continue;
    const rule = md.renderer.rules[name]!;
    md.renderer.rules[name] = (tokens, idx, options, env, self) => {
      const html = rule(tokens, idx, options, env, self);
      const value = tokens[idx]?.attrGet(SOURCE_ATTR);
      if (!value || /^\s*<[a-zA-Z][^>]*\sdata-src=/.test(html)) return html;
      return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 ${SOURCE_ATTR}="${value}"`);
    };
  }
}

export function collectFences(tokens: Token[]): Map<number, string> {
  const fences = new Map<number, string>();
  const visit = (items: Token[]): void => {
    for (const token of items) {
      if (token.type === "fence" && token.map) fences.set(token.map[0] + 1, token.content.replace(/\n$/, ""));
      if (token.children) visit(token.children);
    }
  };
  visit(tokens);
  return fences;
}

export function rangeOf(element: Element | null): [number, number] | null {
  const match = /^(\d+)-(\d+)$/.exec(element?.closest(`[${SOURCE_ATTR}]`)?.getAttribute(SOURCE_ATTR) ?? "");
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Source lines `start..end` (1-based, inclusive), without trailing blank lines. */
export function sliceSource(source: ReaderSource, start: number, end: number): string {
  const lines = source.lines.slice(start - 1, end);
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.join("\n");
}

/**
 * A heading's section: from the heading to the line before the next top-level heading of
 * the same or a higher level, else to the end of the document.
 */
export function sectionRange(heading: HTMLElement, total: number): [number, number] | null {
  const own = rangeOf(heading);
  if (!own) return null;
  const level = Number(heading.tagName.slice(1));
  for (let next = heading.nextElementSibling; next; next = next.nextElementSibling) {
    if (/^H[1-6]$/.test(next.tagName) && Number(next.tagName.slice(1)) <= level) {
      const start = rangeOf(next)?.[0];
      if (start) return [own[0], Math.max(own[0], start - 1)];
    }
  }
  return [own[0], total];
}

/** The union of source lines touched by a selection inside `root`, or null. */
export function selectionRange(root: HTMLElement, selection: Selection | null): [number, number] | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  // Every stamped block with selected text. Footnote definitions render out of source order
  // and a triple-click ends at offset 0 of the next block, so the two ends alone are not enough.
  const selectsText = (block: Element): boolean => {
    const within = document.createRange();
    within.selectNodeContents(block);
    if (range.compareBoundaryPoints(Range.START_TO_START, within) > 0) within.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, within) < 0) within.setEnd(range.endContainer, range.endOffset);
    return within.toString().trim() !== "";
  };
  const ranges = [...root.querySelectorAll(`[${SOURCE_ATTR}]`)]
    .filter(block => range.intersectsNode(block) && selectsText(block))
    .map(rangeOf)
    .filter((value): value is [number, number] => !!value);
  if (!ranges.length) return null;
  return [Math.min(...ranges.map(value => value[0])), Math.max(...ranges.map(value => value[1]))];
}
