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
  /** Replace render warnings (empty clears them), preserving ingestion notices. */
  warn(warnings: RenderWarning[]): void;
  /** Replace the latest ingestion notice; retained until dismissed or replaced. */
  notice(warnings: RenderWarning[]): void;
  /** Show the fatal error card with `msg` and a Reload action. */
  fatal(msg: string): void;
  /** Clear render warnings and the error card, preserving ingestion notices. */
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
  let content = 0;
  for (const w of warnings) {
    if (w.kind === "diagram") diagrams += 1;
    else if (w.kind === "math") math += 1;
    else if (w.kind === "lang") langs += 1;
    else if (w.kind === "content") content += 1;
    else security += 1;
  }

  const parts: string[] = [];
  if (diagrams > 0) parts.push(plural(diagrams, "diagram"));
  if (math > 0) parts.push(`${math} math`);
  if (langs > 0) parts.push(plural(langs, "language"));
  if (security > 0) parts.push(plural(security, "security"));
  if (content > 0) parts.push(plural(content, "document notice"));

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

  let renderWarnings: RenderWarning[] = [];
  let ingestionNotices: RenderWarning[] = [];

  function renderWarningText(): void {
    // Summarize long render-warning lists, but always retain actionable skip details.
    const messages = renderWarnings.map((w) => w.message).filter((m) => m.length > 0);
    const renderText = messages.length > 0 && messages.length <= 3
      ? messages.join(" · ")
      : (summarize(renderWarnings) ?? "");
    const text = [...ingestionNotices.map((w) => w.message), renderText].filter(Boolean).join(" · ");
    if (!text) { hideWarning(); return; }
    warningText.textContent = text;
    warningBanner.hidden = false;
  }

  dismissBtn.addEventListener("click", () => {
    renderWarnings = [];
    ingestionNotices = [];
    hideWarning();
  });
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
      renderWarnings = warnings;
      renderWarningText();
    },
    notice(warnings: RenderWarning[]): void {
      ingestionNotices = warnings;
      renderWarningText();
    },
    fatal(msg: string): void {
      errorMessage.textContent = msg;
      errorCard.hidden = false;
    },
    clear(): void {
      renderWarnings = [];
      renderWarningText();
      hideError();
    },
  };
}
