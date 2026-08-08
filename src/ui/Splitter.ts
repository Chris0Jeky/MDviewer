/**
 * Splitter — the draggable divider between the editor and the preview.
 *
 * Reports a *ratio* (editor share of the workspace width), not pixels, so the layout
 * survives window resizes and persists meaningfully across sessions. Two callbacks:
 * `onPreview` fires continuously during a drag (cheap: the App only writes a CSS
 * custom property) and `onCommit` fires once the gesture ends (the App persists it).
 *
 * Accessibility: the handle is a real `role="separator"` with `tabindex`, arrow-key
 * resizing, and Home/End extremes, so the split is operable without a pointer.
 */

import { IDS, el } from "../app/dom";
import { SPLIT_RATIO_MAX, SPLIT_RATIO_MIN, clampSplitRatio } from "../app/settings";

export interface SplitterController {
  /** Reflect an externally-changed ratio on the handle's ARIA state. */
  sync(ratio: number): void;
  destroy(): void;
}

export interface SplitterOptions {
  /** Element whose width the ratio is measured against (the workspace grid). */
  track: HTMLElement;
  initialRatio: number;
  /** Live during a drag / key press — do not persist here. */
  onPreview(ratio: number): void;
  /** Gesture finished — safe to persist. */
  onCommit(ratio: number): void;
}

/** One arrow-key press moves the divider by this fraction of the workspace. */
const KEY_STEP = 0.02;

/** Ratio → the integer percentage used for `aria-valuenow` and the tooltip. */
function toPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

export function mountSplitter(root: HTMLElement, opts: SplitterOptions): SplitterController {
  let ratio = clampSplitRatio(opts.initialRatio);
  let dragging = false;

  const handle = el("div", {
    id: IDS.splitHandle,
    tabIndex: 0,
    attrs: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": "Resize the source and preview panes",
      "aria-valuemin": String(toPercent(SPLIT_RATIO_MIN)),
      "aria-valuemax": String(toPercent(SPLIT_RATIO_MAX)),
      "aria-valuenow": String(toPercent(ratio)),
    },
  });
  handle.append(el("span", { class: "split-handle-grip", attrs: { "aria-hidden": "true" } }));
  root.append(handle);

  function applyAria(): void {
    handle.setAttribute("aria-valuenow", String(toPercent(ratio)));
    handle.title = `Source pane: ${toPercent(ratio)}%`;
  }

  function set(next: number, commit: boolean): void {
    const clamped = clampSplitRatio(next);
    if (clamped === ratio && !commit) return;
    ratio = clamped;
    applyAria();
    opts.onPreview(ratio);
    if (commit) opts.onCommit(ratio);
  }

  /** Map a pointer x-coordinate onto a ratio of the track's box. */
  function ratioForClientX(clientX: number): number {
    const box = opts.track.getBoundingClientRect();
    if (box.width <= 0) return ratio;
    return (clientX - box.left) / box.width;
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    event.preventDefault();
    set(ratioForClientX(event.clientX), false);
  };

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("is-dragging");
    document.body.classList.remove("is-splitting");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    opts.onCommit(ratio);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    handle.classList.add("is-dragging");
    // Suppress text selection and swap the cursor for the whole gesture, otherwise
    // dragging over the textarea selects its content.
    document.body.classList.add("is-splitting");
    handle.focus();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  /** Double-click resets to a even split — the usual escape hatch from a bad drag. */
  const onDoubleClick = (): void => set(0.5, true);

  const onKeyDown = (event: KeyboardEvent): void => {
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = ratio - KEY_STEP;
    else if (event.key === "ArrowRight") next = ratio + KEY_STEP;
    else if (event.key === "Home") next = SPLIT_RATIO_MIN;
    else if (event.key === "End") next = SPLIT_RATIO_MAX;
    else if (event.key === "Enter" || event.key === " ") next = 0.5;
    if (next === null) return;
    event.preventDefault();
    set(next, true);
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("dblclick", onDoubleClick);
  handle.addEventListener("keydown", onKeyDown);
  applyAria();

  return {
    sync(next): void {
      ratio = clampSplitRatio(next);
      applyAria();
    },
    destroy(): void {
      endDrag();
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("dblclick", onDoubleClick);
      handle.removeEventListener("keydown", onKeyDown);
      handle.remove();
    },
  };
}
