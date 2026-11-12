import { SOURCE_ATTR } from "./sourcemap";
import { setSource, sourceOf } from "./copy";

/**
 * Patch a live reader document towards a fresh first-pass render of new text: top-level
 * blocks whose first-pass markup is unchanged keep their live node (highlighted code,
 * Mermaid figure, open details), and only the others are replaced. Kept nodes get their
 * line ranges moved to the new positions. Returns how many blocks were replaced.
 *
 * Call it as the `paint` step of `renderReaderDocument` for the SAME document and settings
 * (live reload, Edit): copy handlers keep their file name, and kept code keeps its theme, so
 * a settings change needs a full render. The upgrade that follows finds placeholders and
 * diagram sources only in replaced blocks.
 *
 * Keys are the first-pass markup without line ranges, not the block's own source, because
 * reference links, heading ids, footnote numbers and the TOC depend on other blocks.
 * Blocks this function did not insert have no key and are always replaced.
 * ponytail: kept nodes are re-inserted, so focus inside them is lost; insert in place if Edit needs it.
 */
const firstPass = new WeakMap<Element, string>();
const RANGE = new RegExp(` ${SOURCE_ATTR}="(\\d+)-(\\d+)"`, "g");

export function patchDocument(live: HTMLElement, next: HTMLElement): number {
  const available = new Map<string, Element[]>();
  for (const node of live.children) {
    const key = firstPass.get(node);
    if (key !== undefined) available.set(key, [...(available.get(key) ?? []), node]);
  }
  let replaced = 0;
  const children = [...next.children].map(node => {
    // Ranges relative to the block's start: same markup with different inner spacing differs.
    const base = Number(stamp(node)?.getAttribute(SOURCE_ATTR)?.split("-")[0] ?? 0);
    const key = node.outerHTML.replace(RANGE, (_, start: string, end: string) => ` r="${Number(start) - base}-${Number(end) - base}"`);
    const kept = available.get(key)?.shift();
    if (!kept) {
      replaced++;
      firstPass.set(node, key);
      return node;
    }
    moveRanges(kept, node);
    return kept;
  });
  const source = sourceOf(next);
  live.replaceChildren(...children);
  if (source) setSource(live, source);
  return replaced;
}

function stamp(node: Element): Element | null {
  return node.hasAttribute(SOURCE_ATTR) ? node : node.querySelector(`[${SOURCE_ATTR}]`);
}

/** Same markup, maybe new lines: shift every range in the kept node by the start delta. */
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
