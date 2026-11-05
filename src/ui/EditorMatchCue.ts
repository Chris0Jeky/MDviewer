/** Paint the current source match without changing native focus or editing state. */
import { CLASSES, IDS, el } from "../app/dom";
import type { SourceMatch } from "./EditorSearchModel";

interface MatchRect { top: number; bottom: number; left: number; right: number }

export interface EditorMatchCue {
  show(match: SourceMatch | undefined, reveal?: boolean): void;
  setInput(input: HTMLTextAreaElement): void;
  clear(): void;
  destroy(): void;
}

/** A range can repeat rectangles for nested syntax spans. Keep each painted row once. */
function mergeRects(rects: MatchRect[]): MatchRect[] {
  const merged: MatchRect[] = [];
  for (const rect of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
    if (rect.bottom <= rect.top) continue;
    const previous = merged.at(-1);
    if (previous && Math.abs(previous.top - rect.top) < 1 && Math.abs(previous.bottom - rect.bottom) < 1 &&
      rect.left <= previous.right + 1) previous.right = Math.max(previous.right, rect.right);
    else merged.push({ ...rect });
  }
  return merged;
}

/** Measure once in source content coordinates; scrolling only translates this cache. */
function measureMatch(input: HTMLTextAreaElement, backdrop: HTMLElement, match: SourceMatch): MatchRect[] {
  const box = input.getBoundingClientRect();
  if (!box.width || !box.height || !input.clientWidth || !input.clientHeight) return [];

  // Reuse the already painted source rather than building another normal document.
  if (backdrop.textContent === input.value) {
    const walker = document.createTreeWalker(backdrop, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let range: Range | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (!range && match.start < offset + length) {
        range = document.createRange();
        range.setStart(node, match.start - offset);
      }
      if (range && match.end <= offset + length) {
        range.setEnd(node, match.end - offset);
        return mergeRects(Array.from(range.getClientRects(), rect => ({
          top: rect.top - box.top + backdrop.scrollTop, bottom: rect.bottom - box.top + backdrop.scrollTop,
          left: rect.left - box.left + backdrop.scrollLeft, right: rect.right - box.left + backdrop.scrollLeft,
        })));
      }
      offset += length;
    }
  }

  // Large sources deliberately have no backdrop. A temporary text-only mirror
  // ends at the matched logical line: later lines cannot move the match. The
  // textarea client width already excludes its stable scrollbar gutter.
  const styles = getComputedStyle(input);
  const mirror = el("div", { attrs: { "aria-hidden": "true" } });
  const properties = ["font-family", "font-size", "font-weight", "font-style",
    "font-stretch", "font-variant-ligatures", "line-height", "letter-spacing",
    "word-spacing", "tab-size", "white-space", "overflow-wrap", "word-break",
    "padding", "text-indent", "text-transform", "direction", "text-align"];
  for (const property of properties) mirror.style.setProperty(property, styles.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed", top: `${box.top}px`, left: `${box.left}px`,
    width: `${input.clientWidth}px`, boxSizing: "border-box", margin: "0", border: "0",
    visibility: "hidden", pointerEvents: "none", overflow: "hidden",
  });
  const lineEnd = input.value.indexOf("\n", match.end);
  const marker = el("span", {}, input.value.slice(match.start, match.end));
  mirror.append(document.createTextNode(input.value.slice(0, match.start)), marker,
    document.createTextNode(input.value.slice(match.end, lineEnd === -1 ? undefined : lineEnd)));
  document.body.append(mirror);
  try {
    return mergeRects(Array.from(marker.getClientRects(), rect => ({
      top: rect.top - box.top, bottom: rect.bottom - box.top,
      left: rect.left - box.left, right: rect.right - box.left,
    })));
  } finally { mirror.remove(); }
}

export function mountEditorMatchCue(input: HTMLTextAreaElement, backdrop: HTMLElement): EditorMatchCue {
  const layer = el("div", { id: IDS.editorMatchCue, hidden: true, attrs: { "aria-hidden": "true" } });
  input.after(layer);
  let active: SourceMatch | undefined;
  let rects: MatchRect[] = [];
  let frame = 0;
  let needsMeasure = false;
  let destroyed = false;
  let width = 0;
  let height = 0;

  function paint(): void {
    const visible: HTMLElement[] = [];
    if (active && input.isConnected) {
      Object.assign(layer.style, { left: `${input.offsetLeft}px`, top: `${input.offsetTop}px`,
        width: `${input.clientWidth}px`, height: `${input.clientHeight}px` });
      for (const rect of rects) {
        const left = Math.max(0, rect.left - input.scrollLeft);
        const right = Math.min(input.clientWidth, Math.max(rect.right, rect.left + 2) - input.scrollLeft);
        const top = Math.max(0, rect.top - input.scrollTop);
        const bottom = Math.min(input.clientHeight, rect.bottom - input.scrollTop);
        if (right <= left || bottom <= top) continue;
        const mark = el("div", { class: CLASSES.editorMatchRect });
        Object.assign(mark.style, { left: `${left}px`, top: `${top}px`,
          width: `${right - left}px`, height: `${bottom - top}px` });
        visible.push(mark);
      }
    }
    layer.replaceChildren(...visible);
    layer.hidden = visible.length === 0;
  }

  function measure(): void {
    width = input.clientWidth;
    height = input.clientHeight;
    rects = active && input.isConnected ? measureMatch(input, backdrop, active) : [];
  }

  function schedule(remeasure: boolean): void {
    if (!active || destroyed) return;
    needsMeasure ||= remeasure;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (destroyed || !active) return;
      if (needsMeasure) measure();
      needsMeasure = false;
      paint();
    });
  }

  const onScroll = (): void => schedule(false);
  const onLayout = (): void => schedule(true);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    if (width !== input.clientWidth || height !== input.clientHeight) schedule(true);
  }) : undefined;

  function clear(): void {
    active = undefined;
    rects = [];
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    needsMeasure = false;
    observer?.disconnect();
    window.removeEventListener("resize", onLayout);
    document.fonts?.removeEventListener("loadingdone", onLayout);
    layer.replaceChildren();
    layer.hidden = true;
  }

  function reveal(): void {
    const first = rects[0];
    if (!first) return;
    const styles = getComputedStyle(input);
    const top = parseFloat(styles.paddingTop || "0");
    const bottom = input.clientHeight - parseFloat(styles.paddingBottom || "0");
    if (first.top - input.scrollTop < top || first.bottom - input.scrollTop > bottom) {
      input.scrollTop = first.top - top - (bottom - top - (first.bottom - first.top)) / 2;
    }
    if (first.left < input.scrollLeft) input.scrollLeft = first.left;
    else if (first.right > input.scrollLeft + input.clientWidth) input.scrollLeft = first.right - input.clientWidth;
    input.dispatchEvent(new Event("scroll"));
  }

  input.addEventListener("scroll", onScroll);
  return {
    show(match, shouldReveal = false): void {
      if (destroyed) return;
      if (!match || match.start < 0 || match.end <= match.start || match.end > input.value.length) { clear(); return; }
      if (!active || active.start !== match.start || active.end !== match.end) {
        active = { ...match };
        measure();
        observer?.observe(input);
        window.addEventListener("resize", onLayout);
        document.fonts?.addEventListener("loadingdone", onLayout);
      } else if (needsMeasure) { measure(); needsMeasure = false; }
      if (shouldReveal) reveal();
      paint();
    },
    setInput(next): void {
      if (destroyed || next === input) return;
      clear();
      input.removeEventListener("scroll", onScroll);
      input = next;
      input.after(layer);
      input.addEventListener("scroll", onScroll);
    },
    clear,
    destroy(): void {
      destroyed = true;
      clear();
      input.removeEventListener("scroll", onScroll);
      layer.remove();
    },
  };
}
