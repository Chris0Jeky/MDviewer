import { SOURCE_ATTR, sliceSource, type ReaderSource } from "./sourcemap";
import { setSource, sourceOf } from "./copy";

/**
 * Patch a live reader document towards a fresh render of new text: top-level blocks whose
 * source text is unchanged keep their live node (its highlighted code, Mermaid figure,
 * open details, focus), and only the others are replaced. Kept nodes get their line ranges
 * moved to the new positions. Returns how many blocks were replaced.
 *
 * Call it as the `paint` step of `renderReaderDocument`: the upgrade that follows then
 * finds placeholders and diagram sources only in the replaced blocks.
 */
export function patchDocument(live: HTMLElement, next: HTMLElement): number {
  const before = sourceOf(live);
  const after = sourceOf(next);
  const available = new Map<string, Element[]>();
  if (before) {
    for (const node of live.children) {
      const key = blockKey(node, before);
      available.set(key, [...(available.get(key) ?? []), node]);
    }
  }
  let replaced = 0;
  const children = [...next.children].map(node => {
    const kept = after && available.get(blockKey(node, after))?.shift();
    if (!kept) { replaced++; return node; }
    moveRanges(kept, node);
    return kept;
  });
  live.replaceChildren(...children);
  if (after) setSource(live, after);
  return replaced;
}

function stamp(node: Element): Element | null {
  return node.hasAttribute(SOURCE_ATTR) ? node : node.querySelector(`[${SOURCE_ATTR}]`);
}

/** The block's own source text; unmapped blocks (footnotes) compare by markup. */
function blockKey(node: Element, source: ReaderSource): string {
  const match = /^(\d+)-(\d+)$/.exec(stamp(node)?.getAttribute(SOURCE_ATTR) ?? "");
  if (!match) return `html\0${node.outerHTML}`;
  return `${node.tagName}\0${sliceSource(source, Number(match[1]), Number(match[2]))}`;
}

/** Same source, maybe new lines: shift every range in the kept node by the start delta. */
function moveRanges(kept: Element, fresh: Element): void {
  const from = Number(stamp(kept)?.getAttribute(SOURCE_ATTR)?.split("-")[0]);
  const to = Number(stamp(fresh)?.getAttribute(SOURCE_ATTR)?.split("-")[0]);
  const delta = to - from;
  if (!delta) return;
  for (const node of [kept, ...kept.querySelectorAll(`[${SOURCE_ATTR}]`)]) {
    const range = /^(\d+)-(\d+)$/.exec(node.getAttribute(SOURCE_ATTR) ?? "");
    if (range) node.setAttribute(SOURCE_ATTR, `${Number(range[1]) + delta}-${Number(range[2]) + delta}`);
  }
}
