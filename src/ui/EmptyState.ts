/**
 * EmptyState — the full-window dropzone card shown before any document is open
 * (and again as the recovery state if all documents are closed). It offers a
 * file picker ("Choose file…") and a sample-document shortcut. The actual drag /
 * drop / file plumbing lives in the App + input layer; this card only renders
 * the affordances and invokes the supplied callbacks.
 *
 * The element names below are the ones preview.css actually styles
 * (`.empty-card` wrapping `.empty-icon` / `.empty-title` / `.empty-sub` /
 * `.empty-actions` / `.empty-hint`). They are not in dom.ts CLASSES, so the
 * dom-contract drift guard does not cover them — keep the two files in step by
 * hand when either changes.
 */

import { IDS, el } from "../app/dom";

export interface EmptyStateController {
  destroy(): void;
}

/**
 * Mount the empty-state card into `root`.
 *
 * @param onChoose invoked when the user activates "Choose file…"
 * @param onSample invoked when the user activates "Try a sample document"
 */
export function mountEmptyState(
  root: HTMLElement,
  onChoose: () => void,
  onSample: () => void,
): EmptyStateController {
  const headingId = "empty-state-heading";

  const card = el("section", {
    id: IDS.emptyState,
    class: "empty-state",
    attrs: {
      role: "region",
      "aria-labelledby": headingId,
    },
  });

  const icon = el("div", { class: "empty-icon", attrs: { "aria-hidden": "true" } }, "⬇");

  const heading = el(
    "h1",
    { id: headingId, class: "empty-title" },
    "Drop a Markdown file, or start typing",
  );

  const subline = el(
    "p",
    { class: "empty-sub" },
    "Write in the source pane on the left and this preview repaginates as you type.",
  );

  const chooseBtn = el(
    "button",
    {
      type: "button",
      class: "empty-choose",
      title: "Open a Markdown file from your computer",
    },
    "Choose file…",
  );
  chooseBtn.addEventListener("click", () => onChoose());

  const sampleLink = el(
    "button",
    {
      type: "button",
      class: "empty-sample",
      title: "Load a bundled demo document",
    },
    "Try a sample document",
  );
  sampleLink.addEventListener("click", () => onSample());

  const actions = el("div", { class: "empty-actions" }, chooseBtn, sampleLink);

  const helper = el(
    "p",
    { class: "empty-hint" },
    ".md and .markdown · Everything runs in your browser — nothing is uploaded.",
  );

  const inner = el("div", { class: "empty-card" }, icon, heading, subline, actions, helper);
  card.append(inner);
  root.append(card);

  return {
    destroy(): void {
      card.remove();
    },
  };
}
