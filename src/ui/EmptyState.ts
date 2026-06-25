/**
 * EmptyState — the full-window dropzone card shown before any document is open
 * (and again as the recovery state if all documents are closed). It offers a
 * file picker ("Choose file…") and a sample-document shortcut. The actual drag /
 * drop / file plumbing lives in the App + input layer; this card only renders
 * the affordances and invokes the supplied callbacks.
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

  const icon = el("div", { class: "empty-state-icon", attrs: { "aria-hidden": "true" } }, "⬇");

  const heading = el(
    "h1",
    { id: headingId, class: "empty-state-headline" },
    "Drop a Markdown file to begin",
  );

  const chooseBtn = el(
    "button",
    {
      type: "button",
      class: "empty-state-choose",
      title: "Open a Markdown file from your computer",
    },
    "Choose file…",
  );
  chooseBtn.addEventListener("click", () => onChoose());

  const sampleLink = el(
    "button",
    {
      type: "button",
      class: "empty-state-sample",
      title: "Load a bundled demo document",
    },
    "Try a sample document",
  );
  sampleLink.addEventListener("click", () => onSample());

  const subline = el(
    "p",
    { class: "empty-state-subline" },
    chooseBtn,
    el("span", { class: "empty-state-or" }, "or"),
    sampleLink,
  );

  const helper = el(
    "p",
    { class: "empty-state-helper" },
    ".md and .markdown · Everything runs in your browser — nothing is uploaded.",
  );

  card.append(icon, heading, subline, helper);
  root.append(card);

  return {
    destroy(): void {
      card.remove();
    },
  };
}
