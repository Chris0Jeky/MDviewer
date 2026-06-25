/**
 * Canvas — the preview pane that hosts the paginated output. Builds the
 * `<main id="canvas">` shell containing the Paged.js host (`#paged-output`),
 * a live page chip ("Page n / N"), a zoom control (Fit / 100% / 50%), a
 * "Paginating…" overlay, and a polite live region for status announcements.
 *
 * The returned controller exposes the host plus imperative setters the App
 * calls during the render pipeline. No business logic lives here.
 */

import { CLASSES, IDS, el } from "../app/dom";
import type { Settings } from "../app/settings";

export interface CanvasController {
  /** The Paged.js render target (`#paged-output`). */
  host: HTMLElement;
  /** Toggle the paginating overlay + `aria-busy`; announce in the live region. */
  setPaginating(busy: boolean): void;
  /** Update the "Page n / N" chip after pagination settles. */
  setPageCount(count: number): void;
  /** Reflect the active zoom on the chip's selector (state only; CSS scales). */
  setZoom(zoom: Settings["zoom"]): void;
}

const ZOOM_OPTIONS: ReadonlyArray<[value: string, label: string, title: string]> = [
  ["fit", "Fit", "Fit the page to the canvas"],
  ["1", "100%", "Actual size"],
  ["0.5", "50%", "Half size"],
];

/** Serialize a zoom setting to the string the selector uses. */
function zoomToValue(zoom: Settings["zoom"]): string {
  return zoom === "fit" ? "fit" : String(zoom);
}

/**
 * Mount the canvas into `root`. Note: zoom selection is presentational — the
 * controller surfaces the chosen value via `data-zoom`, but persisting it is the
 * App's job (it owns Settings). We intentionally do not import App here.
 */
export function mountCanvas(root: HTMLElement): CanvasController {
  const canvas = el("main", {
    id: IDS.canvas,
    class: "canvas",
    tabIndex: -1,
    attrs: { "aria-label": "Document preview" },
  });

  // The Paged.js render target. Paged.js replaces its children with .pagedjs_pages.
  const host = el("div", {
    id: IDS.pagedOutput,
    class: "paged-output",
    attrs: { role: "document", "aria-label": "Paginated document" },
  });

  // ---- Page chip: "Page n / N" ----
  const pageChipLabel = el("span", { class: "page-chip-label" }, "Page 0 / 0");
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
    zoomButtons.push(btn);
    zoomControl.append(btn);
  }

  // ---- Floating overlay shown while Paged.js is laying out ----
  const overlay = el(
    "div",
    {
      class: "paginating-overlay",
      attrs: { "aria-hidden": "true", hidden: "" },
    },
    el("div", { class: "paginating-spinner" }),
    el("p", { class: "paginating-label" }, "Paginating…"),
  );

  // ---- Polite live region for status announcements ----
  const statusLive = el("div", {
    id: IDS.statusLive,
    class: "status-live",
    attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
  });

  // ---- Floating control bar pinned over the canvas ----
  const controls = el(
    "div",
    { class: "canvas-controls", attrs: { "aria-hidden": "false" } },
    pageChip,
    zoomControl,
  );

  canvas.append(controls, host, overlay, statusLive);
  root.append(canvas);

  function announce(message: string): void {
    // Re-set to the same text still re-announces because we clear first.
    statusLive.textContent = "";
    statusLive.textContent = message;
  }

  function setPaginating(busy: boolean): void {
    canvas.setAttribute("aria-busy", String(busy));
    canvas.classList.toggle(CLASSES.isPaginating, busy);
    overlay.hidden = !busy;
    overlay.setAttribute("aria-hidden", String(!busy));
    if (busy) announce("Paginating document…");
  }

  function setPageCount(count: number): void {
    const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    pageChipLabel.textContent = `Page 1 / ${safe}`;
    pageChip.dataset["count"] = String(safe);
    if (safe > 0) {
      announce(`Ready — ${safe} ${safe === 1 ? "page" : "pages"}.`);
    }
  }

  function setZoom(zoom: Settings["zoom"]): void {
    const value = zoomToValue(zoom);
    host.dataset["zoom"] = value;
    canvas.dataset["zoom"] = value;
    for (const btn of zoomButtons) {
      btn.setAttribute("aria-pressed", String(btn.dataset["zoom"] === value));
    }
  }

  return { host, setPaginating, setPageCount, setZoom };
}
