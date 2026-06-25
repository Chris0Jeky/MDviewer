/**
 * Banner — two stacked notification surfaces over the canvas:
 *
 *  - `#warning-banner` aggregates non-fatal render warnings into a single line
 *    ("Rendered with N warnings — X diagrams, Y math, Z languages").
 *  - `#error-card` is the fatal pane: a message plus a Reload button, used when
 *    the pipeline cannot produce a document at all.
 *
 * Both regions are assertive live regions so assistive tech is notified. The
 * banner only renders state — it performs no rendering work itself.
 */

import { IDS, el } from "../app/dom";
import type { RenderWarning } from "../render/markdown";

export interface BannerController {
  /** Show an aggregated summary of non-fatal render warnings (clears if empty). */
  warn(warnings: RenderWarning[]): void;
  /** Show the fatal error card with `msg` and a Reload action. */
  fatal(msg: string): void;
  /** Hide both the warning banner and the error card. */
  clear(): void;
}

/** Pluralize a count with its noun. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Reduce warnings to a human summary. Counts are grouped by `kind`; only
 * non-zero groups appear. Returns `null` when there is nothing to report.
 */
function summarize(warnings: RenderWarning[]): string | null {
  if (warnings.length === 0) return null;

  let diagrams = 0;
  let math = 0;
  let langs = 0;
  for (const w of warnings) {
    if (w.kind === "diagram") diagrams += 1;
    else if (w.kind === "math") math += 1;
    else langs += 1;
  }

  const parts: string[] = [];
  if (diagrams > 0) parts.push(plural(diagrams, "diagram"));
  if (math > 0) parts.push(`${math} math`);
  if (langs > 0) parts.push(plural(langs, "language"));

  const total = `Rendered with ${plural(warnings.length, "warning")}`;
  return parts.length > 0 ? `${total} — ${parts.join(", ")}` : total;
}

/** Mount the warning banner + fatal error card into `root`. */
export function mountBanner(root: HTMLElement): BannerController {
  // ---- Warning banner (aggregated, dismissible) ----
  const warningText = el("span", { class: "warning-text" });
  const dismissBtn = el(
    "button",
    {
      type: "button",
      class: "warning-dismiss",
      title: "Dismiss warnings",
      attrs: { "aria-label": "Dismiss warnings" },
    },
    "×",
  );
  const warningBanner = el(
    "div",
    {
      id: IDS.warningBanner,
      class: "warning-banner",
      attrs: {
        role: "alert",
        "aria-live": "assertive",
        "aria-atomic": "true",
        hidden: "",
      },
    },
    el("span", { class: "warning-icon", attrs: { "aria-hidden": "true" } }, "⚠"),
    warningText,
    dismissBtn,
  );

  // ---- Fatal error card ----
  const errorMessage = el("p", { class: "error-message" });
  const reloadBtn = el(
    "button",
    {
      type: "button",
      class: "error-reload",
      title: "Reload the application",
    },
    "Reload",
  );
  const errorCard = el(
    "div",
    {
      id: IDS.errorCard,
      class: "error-card",
      attrs: {
        role: "alertdialog",
        "aria-live": "assertive",
        "aria-atomic": "true",
        "aria-label": "Rendering failed",
        hidden: "",
      },
    },
    el("div", { class: "error-icon", attrs: { "aria-hidden": "true" } }, "✕"),
    el("h2", { class: "error-title" }, "Something went wrong"),
    errorMessage,
    reloadBtn,
  );

  function hideWarning(): void {
    warningBanner.hidden = true;
    warningText.textContent = "";
  }

  function hideError(): void {
    errorCard.hidden = true;
    errorMessage.textContent = "";
  }

  dismissBtn.addEventListener("click", hideWarning);
  reloadBtn.addEventListener("click", () => {
    // Full reload is the deliberate recovery action for an unrecoverable render.
    location.reload();
  });

  root.append(warningBanner, errorCard);

  return {
    warn(warnings: RenderWarning[]): void {
      if (warnings.length === 0) {
        hideWarning();
        return;
      }
      // Prefer the specific, already user-phrased messages — they name the rejected file
      // or the failing expression. For a long run of render warnings, the aggregate count
      // reads better, so fall back to the summary past a small threshold.
      const messages = warnings.map((w) => w.message).filter((m) => m.length > 0);
      const text =
        messages.length > 0 && messages.length <= 3
          ? messages.join(" · ")
          : (summarize(warnings) ?? messages.join(" · "));
      if (!text) {
        hideWarning();
        return;
      }
      warningText.textContent = text;
      warningBanner.hidden = false;
    },
    fatal(msg: string): void {
      errorMessage.textContent = msg;
      errorCard.hidden = false;
    },
    clear(): void {
      hideWarning();
      hideError();
    },
  };
}
