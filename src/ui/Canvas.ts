/**
 * Canvas — the preview pane that hosts the paginated output. Builds the
 * `<main id="canvas">` shell containing the Paged.js host (`#paged-output`),
 * a live page chip ("Page n / N"), a zoom control (Fit / 100% / 50%), a
 * "Paginating…" overlay, and a polite live region for status announcements.
 *
 * The returned controller exposes the host plus imperative setters the App
 * calls during the render pipeline. No business logic lives here.
 *
 * Two invariants this module is responsible for:
 *
 *  - **Zoom is paint-only.** The resolved factor lands on `--preview-zoom`
 *    (PREVIEW_ZOOM_VAR) and preview.css turns it into a `transform: scale()`.
 *    A transform does not change layout, so the paginated geometry Paged.js
 *    measured — and the geometry the no-slice guarantee is asserted against —
 *    is identical at every zoom. Zoom therefore never triggers a re-pagination
 *    (it is deliberately absent from App's REFLOW_KEYS).
 *  - **The floating chrome must not scroll away.** `#canvas` is the scroller,
 *    so plain `position: absolute` children scroll with the content. The chip
 *    and the zoom control live in a zero-height sticky wrapper
 *    (`.canvas-controls`) pinned to the bottom of the canvas viewport.
 */

import { CLASSES, IDS, PAGEDJS, PREVIEW_ZOOM_VAR, el } from "../app/dom";
import type { Settings } from "../app/settings";

/** A restorable reading position: a 1-based page plus a fraction into it. */
export interface CanvasPosition {
  /** 1-based page number (as stamped by the Paged.js handler). */
  page: number;
  /** How far into that page the canvas viewport top sits, 0..1. */
  offset: number;
}

export interface CanvasController {
  /** The Paged.js render target (`#paged-output`). */
  host: HTMLElement;
  /** Toggle the paginating overlay + `aria-busy`; announce in the live region. */
  setPaginating(busy: boolean): void;
  /** Per-page pagination progress; `null` restores the plain "Paginating…" label. */
  setProgress(page: number | null): void;
  /** Show/hide the same overlay for a non-pagination long task (the PDF export). */
  setBusy(busy: boolean, label?: string): void;
  /** Update the "Page n / N" chip after pagination settles. */
  setPageCount(count: number): void;
  /** Reflect the active zoom (state + resolved scale). Pure CSS, no reflow. */
  setZoom(zoom: Settings["zoom"]): void;
  /** Capture the current reading position so a re-pagination can restore it. */
  capturePosition(): CanvasPosition | null;
  /** Scroll back to a captured position, clamped to the current page count. */
  restorePosition(position: CanvasPosition | null): void;
  /** Detach observers/listeners (tests + teardown). */
  destroy(): void;
}

export interface CanvasOptions {
  /** Called when the user picks a zoom option; the App owns persisting it. */
  onZoom(zoom: Settings["zoom"]): void;
}

const ZOOM_OPTIONS: ReadonlyArray<[value: string, label: string, title: string]> = [
  ["fit", "Fit", "Scale the page to fit the preview width"],
  ["1", "100%", "Actual size"],
  ["0.5", "50%", "Half size"],
];

/**
 * Horizontal breathing room around the sheet stack — must match the horizontal
 * padding of `.pagedjs_pages` in preview.css, or "Fit" would over/under-shoot.
 */
const STACK_GUTTER_PX = 24;

/** Never shrink past this, however narrow the pane gets. */
const MIN_FIT_SCALE = 0.1;

/** Serialize a zoom setting to the string the selector uses. */
function zoomToValue(zoom: Settings["zoom"]): string {
  return zoom === "fit" ? "fit" : String(zoom);
}

/** Parse a `data-zoom` value back onto the Settings union. */
function valueToZoom(value: string): Settings["zoom"] {
  if (value === "fit") return "fit";
  return value === "0.5" ? 0.5 : 1;
}

/**
 * Mount the canvas into `root`. Zoom selection is reported through
 * `options.onZoom`; persisting it is the App's job (it owns Settings), which then
 * calls `setZoom` back — including for programmatic updates, so `aria-pressed`
 * tracks the setting rather than the click.
 */
export function mountCanvas(root: HTMLElement, options: CanvasOptions): CanvasController {
  const canvas = el("main", {
    id: IDS.canvas,
    class: "canvas",
    // Focusable so the skip link lands somewhere operable and the preview can be
    // scrolled with the keyboard alone (TECH-6).
    tabIndex: 0,
    attrs: { "aria-label": "Document preview" },
  });

  // The Paged.js render target. Paged.js replaces its children with .pagedjs_pages.
  const host = el("div", {
    id: IDS.pagedOutput,
    class: "paged-output",
    attrs: { role: "document", "aria-label": "Paginated document" },
  });

  // ---- Page chip: "Page n / N" ----
  const pageChipLabel = el("span", { class: CLASSES.pageChipLabel }, "Page 0 / 0");
  const pageChip = el(
    "div",
    {
      id: IDS.pageChip,
      class: "page-chip",
      attrs: { "aria-hidden": "true" },
    },
    pageChipLabel,
  );

  // ---- Zoom control: Fit / 100% / 50% ----
  const zoomButtons: HTMLButtonElement[] = [];
  const zoomControl = el("div", {
    id: IDS.zoomControl,
    class: "zoom-control",
    attrs: { role: "group", "aria-label": "Zoom" },
  });
  for (const [value, label, title] of ZOOM_OPTIONS) {
    const btn = el(
      "button",
      {
        type: "button",
        class: CLASSES.segOption,
        title,
        attrs: { "data-zoom": value, "aria-pressed": "false" },
      },
      label,
    );
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-pressed") === "true") return;
      options.onZoom(valueToZoom(value));
    });
    zoomButtons.push(btn);
    zoomControl.append(btn);
  }

  // ---- Floating overlay shown while Paged.js is laying out ----
  const overlayLabel = el("p", { class: CLASSES.paginatingLabel }, "Paginating…");
  const overlay = el(
    "div",
    {
      class: CLASSES.paginatingOverlay,
      attrs: { "aria-hidden": "true", hidden: "" },
    },
    el("div", { class: CLASSES.paginatingSpinner }),
    overlayLabel,
  );

  // ---- Polite live region for status announcements ----
  const statusLive = el("div", {
    id: IDS.statusLive,
    class: "status-live",
    attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
  });

  // ---- Floating control bar pinned to the canvas viewport ----
  // Zero-height sticky wrapper: #canvas is the scroll container, so an absolutely
  // positioned chip would scroll out of view with the sheets (BUG-5). Sticky
  // `bottom` only pins an element whose flow position is at the END of the scroll
  // content, hence the append order below.
  const controls = el(
    "div",
    { class: CLASSES.canvasControls, attrs: { "aria-hidden": "false" } },
    pageChip,
    zoomControl,
  );

  canvas.append(host, overlay, statusLive, controls);
  root.append(canvas);

  function announce(message: string): void {
    // Re-set to the same text still re-announces because we clear first.
    statusLive.textContent = "";
    statusLive.textContent = message;
  }

  // ---- pagination / busy overlay ---------------------------------------------

  function showOverlay(visible: boolean): void {
    overlay.hidden = !visible;
    overlay.setAttribute("aria-hidden", String(!visible));
  }

  function setPaginating(busy: boolean): void {
    canvas.setAttribute("aria-busy", String(busy));
    canvas.classList.toggle(CLASSES.isPaginating, busy);
    if (!busy) overlayLabel.textContent = "Paginating…";
    showOverlay(busy || canvas.classList.contains(CLASSES.isExporting));
    if (busy) announce("Paginating document…");
  }

  function setProgress(page: number | null): void {
    if (!canvas.classList.contains(CLASSES.isPaginating)) return;
    overlayLabel.textContent =
      page === null || page <= 0 ? "Paginating…" : `Paginating… page ${page}`;
  }

  function setBusy(busy: boolean, label?: string): void {
    canvas.classList.toggle(CLASSES.isExporting, busy);
    canvas.setAttribute(
      "aria-busy",
      String(busy || canvas.classList.contains(CLASSES.isPaginating)),
    );
    if (busy) overlayLabel.textContent = label ?? "Working…";
    else if (!canvas.classList.contains(CLASSES.isPaginating)) {
      overlayLabel.textContent = "Paginating…";
    }
    showOverlay(busy || canvas.classList.contains(CLASSES.isPaginating));
  }

  // ---- page chip -------------------------------------------------------------

  let totalPages = 0;

  /** Every laid-out sheet, in document order. */
  function sheets(): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>(`.${PAGEDJS.pageClass}`));
  }

  /** The 1-based number Paged.js stamped on a sheet (index fallback). */
  function pageNumberOf(sheet: HTMLElement, index: number): number {
    const stamped = Number(sheet.getAttribute(PAGEDJS.pageNumberAttr));
    return Number.isFinite(stamped) && stamped > 0 ? stamped : index + 1;
  }

  /** The topmost sheet still intersecting the canvas viewport. */
  function topmostVisible(): { sheet: HTMLElement; page: number; top: number; height: number } | null {
    const all = sheets();
    if (all.length === 0) return null;
    const viewportTop = canvas.getBoundingClientRect().top;
    let last: { sheet: HTMLElement; page: number; top: number; height: number } | null = null;
    for (let i = 0; i < all.length; i++) {
      const sheet = all[i]!;
      const rect = sheet.getBoundingClientRect();
      last = { sheet, page: pageNumberOf(sheet, i), top: rect.top - viewportTop, height: rect.height };
      // The first sheet whose bottom is still below the viewport top owns the view.
      if (rect.bottom > viewportTop + 8) return last;
    }
    return last;
  }

  function renderChip(): void {
    const current = totalPages > 0 ? (topmostVisible()?.page ?? 1) : 0;
    const shown = Math.min(Math.max(current, totalPages > 0 ? 1 : 0), Math.max(totalPages, 0));
    pageChipLabel.textContent = `Page ${shown} / ${totalPages}`;
    pageChip.dataset["page"] = String(shown);
  }

  // rAF-throttled: scroll fires far more often than the chip can meaningfully change,
  // and the chip is aria-hidden (#status-live is the accessible channel) so this
  // never turns into live-region spam.
  let scrollFrame = 0;
  function onScroll(): void {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      renderChip();
    });
  }
  canvas.addEventListener("scroll", onScroll, { passive: true });

  function setPageCount(count: number): void {
    const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    totalPages = safe;
    pageChip.dataset["count"] = String(safe);
    renderChip();
    // Sheets exist now, so "Fit" can finally resolve against a real sheet width.
    applyZoom();
    if (safe > 0) {
      announce(`Ready — ${safe} ${safe === 1 ? "page" : "pages"}.`);
    }
  }

  // ---- zoom ------------------------------------------------------------------

  let currentZoom: Settings["zoom"] = "fit";

  /**
   * Fit-to-width. `offsetWidth` is a layout measurement, so it reports the sheet's
   * true (unscaled) width even while a transform is applied — no feedback loop.
   * Capped at 1: blowing a small page up to fill a wide pane would misrepresent
   * the paper size, which is the whole point of the preview.
   */
  function computeFitScale(): number {
    const sheet = host.querySelector<HTMLElement>(`.${PAGEDJS.pageClass}`);
    const natural = sheet?.offsetWidth ?? 0;
    const available = canvas.clientWidth - STACK_GUTTER_PX * 2;
    if (natural <= 0 || available <= 0) return 1;
    return Math.min(1, Math.max(MIN_FIT_SCALE, available / natural));
  }

  function applyZoom(): void {
    const scale = currentZoom === "fit" ? computeFitScale() : currentZoom;
    canvas.style.setProperty(PREVIEW_ZOOM_VAR, String(scale));
  }

  function setZoom(zoom: Settings["zoom"]): void {
    currentZoom = zoom;
    const value = zoomToValue(zoom);
    host.dataset["zoom"] = value;
    canvas.dataset["zoom"] = value;
    for (const btn of zoomButtons) {
      btn.setAttribute("aria-pressed", String(btn.dataset["zoom"] === value));
    }
    applyZoom();
  }

  // The splitter drag and window resizes both change the available width, so "Fit"
  // has to keep tracking it rather than resolve once.
  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (currentZoom === "fit") applyZoom();
          renderChip();
        })
      : null;
  resizeObserver?.observe(canvas);

  // ---- scroll position preservation -----------------------------------------

  function capturePosition(): CanvasPosition | null {
    const visible = topmostVisible();
    if (!visible || visible.height <= 0) return null;
    // `top` is negative once the page has scrolled past the viewport top.
    const offset = Math.min(1, Math.max(0, -visible.top / visible.height));
    return { page: visible.page, offset };
  }

  function restorePosition(position: CanvasPosition | null): void {
    if (!position) return;
    const all = sheets();
    if (all.length === 0) return;
    const index = Math.min(Math.max(position.page, 1), all.length) - 1;
    const sheet = all[index];
    if (!sheet) return;
    const viewportTop = canvas.getBoundingClientRect().top;
    const rect = sheet.getBoundingClientRect();
    const target = canvas.scrollTop + (rect.top - viewportTop) + position.offset * rect.height;
    // Instant, never animated: `scroll-behavior: smooth` on #canvas would turn a
    // restore into a visible fly-past of the whole document.
    const previous = canvas.style.scrollBehavior;
    canvas.style.scrollBehavior = "auto";
    canvas.scrollTop = Math.max(0, target);
    canvas.style.scrollBehavior = previous;
    renderChip();
  }

  function destroy(): void {
    canvas.removeEventListener("scroll", onScroll);
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    resizeObserver?.disconnect();
  }

  applyZoom();

  return {
    host,
    setPaginating,
    setProgress,
    setBusy,
    setPageCount,
    setZoom,
    capturePosition,
    restorePosition,
    destroy,
  };
}
