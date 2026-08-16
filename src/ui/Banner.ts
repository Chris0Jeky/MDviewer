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
 *
 * Placement matters as much as the markup: `root` is `#canvas`, the scroll
 * container, so a plain in-flow banner appended after `#paged-output`
 * (`min-height: 100%`) lands a full canvas-height below the fold and is never
 * seen (BUG-6). The warning banner therefore lives in a zero-height sticky
 * wrapper (`.canvas-notices`) **prepended** to the canvas — sticky `top` can only
 * pin an element whose flow position is at the start of the scroll content.
 */

import { CLASSES, IDS, el } from "../app/dom";
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
  let security = 0;
  for (const w of warnings) {
    if (w.kind === "diagram") diagrams += 1;
    else if (w.kind === "math") math += 1;
    else if (w.kind === "lang") langs += 1;
    else security += 1;
  }

  const parts: string[] = [];
  if (diagrams > 0) parts.push(plural(diagrams, "diagram"));
  if (math > 0) parts.push(`${math} math`);
  if (langs > 0) parts.push(plural(langs, "language"));
  if (security > 0) parts.push(plural(security, "security"));

  const total = `Rendered with ${plural(warnings.length, "warning")}`;
  return parts.length > 0 ? `${total} — ${parts.join(", ")}` : total;
}

/** Mount the warning banner + fatal error card into `root`. */
export function mountBanner(root: HTMLElement): BannerController {
  // ---- Warning banner (aggregated, dismissible) ----
  const warningText = el("span", { class: CLASSES.warningText });
  const dismissBtn = el(
    "button",
    {
      type: "button",
      class: CLASSES.warningDismiss,
      title: "Dismiss warnings",
      attrs: { "aria-label": "Dismiss warnings" },
    },
    "×",
  );
  const warningBanner = el(
    "div",
    {
      id: IDS.warningBanner,
      class: CLASSES.warningBanner,
      attrs: {
        role: "alert",
        "aria-live": "assertive",
        "aria-atomic": "true",
        hidden: "",
      },
    },
    el("span", { class: CLASSES.warningIcon, attrs: { "aria-hidden": "true" } }, "⚠"),
    warningText,
    dismissBtn,
  );

  // Zero-height sticky rail keeping the toast in the canvas viewport (see header).
  const notices = el(
    "div",
    { class: CLASSES.canvasNotices, attrs: { "aria-hidden": "false" } },
    warningBanner,
  );

  // ---- Fatal error card ----
  const errorMessage = el("p", { class: CLASSES.errorMessage });
  const reloadBtn = el(
    "button",
    {
      type: "button",
      class: CLASSES.errorReload,
      title: "Reload the application",
    },
    "Reload",
  );
  const errorCard = el(
    "div",
    {
      id: IDS.errorCard,
      class: CLASSES.errorCard,
      attrs: {
        role: "alertdialog",
        "aria-live": "assertive",
        "aria-atomic": "true",
        "aria-label": "Rendering failed",
        hidden: "",
      },
    },
    el("div", { class: CLASSES.errorIcon, attrs: { "aria-hidden": "true" } }, "✕"),
    el("h2", { class: CLASSES.errorTitle }, "Something went wrong"),
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

  // The notices rail must start the canvas's flow for sticky `top` to pin it; the
  // error card is a full-canvas centered overlay, so its position in flow is moot.
  root.prepend(notices);
  root.append(errorCard);

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
