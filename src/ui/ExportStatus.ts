import { IDS, el } from "../app/dom";

export type PdfExportStatus =
  | { phase: "idle" | "preparing" | "saving" | "downloading" | "saved" | "download-requested" | "canceled" }
  | { phase: "rendering"; done: number; total: number }
  | { phase: "failed"; message: string };

/** Screen chrome outside the parked preview and the toolbar's scroll container. */
export function mountExportStatus(root: HTMLElement): { update(status: PdfExportStatus): void; destroy(): void } {
  const text = el("span", { class: "export-status-text", attrs: { "aria-hidden": "true" } });
  const progress = el("progress", { attrs: { "aria-label": "PDF pages rendered" } });
  const content = el("div", { class: "export-status-content", hidden: true }, text, progress);
  // Keep the initially empty live region mounted, even while the visual strip is
  // collapsed. Neither updates nor terminal outcomes take keyboard focus.
  const live = el("div", { id: IDS.exportStatusLive, class: "visually-hidden",
    attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" } });
  const strip = el("div", { id: IDS.exportStatus }, content, live);
  root.append(strip);
  let announcedQuarter = -1;

  function update(status: PdfExportStatus): void {
    strip.dataset.phase = status.phase;
    content.hidden = status.phase === "idle";
    progress.hidden = !["preparing", "rendering", "saving", "downloading"].includes(status.phase);
    let message: string;
    if (status.phase === "rendering") {
      progress.max = status.total;
      progress.value = status.done;
      message = `Rendered ${status.done} of ${status.total} PDF pages…`;
      text.textContent = message;
      // First completed page and quarter milestones: at most five progress
      // announcements even for a long document. The visible count is exact.
      const quarter = Math.floor(status.done / status.total * 4);
      if (quarter <= announcedQuarter) return;
      announcedQuarter = quarter;
    } else {
      announcedQuarter = -1;
      progress.removeAttribute("value");
      const messages = {
        idle: "",
        preparing: "Preparing PDF…",
        saving: "Saving PDF…",
        downloading: "Starting PDF download…",
        saved: "PDF saved.",
        "download-requested": "PDF download requested.",
        canceled: "PDF save canceled. Your document is still open.",
      };
      if (status.phase === "failed") {
        // Error details may contain arbitrary source/engine text. Keep this
        // chrome compact and text-only; the existing fatal card retains detail.
        const reason = status.message.replace(/\s+/g, " ").trim();
        const summary = reason.length > 180 ? `${reason.slice(0, 180)}…` : reason;
        message = `PDF export failed: ${summary || "Please try again."}`;
      } else message = messages[status.phase];
      text.textContent = message;
    }
    if (live.textContent !== message) live.textContent = message;
  }

  return { update, destroy: () => strip.remove() };
}
