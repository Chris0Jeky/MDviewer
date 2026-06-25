/**
 * Canonical DOM IDs, class names, and Paged.js-owned selectors — the single
 * source of truth shared by the app, UI builders, CSS, and tests. The
 * dom-contract test guards against drift between these names and the stylesheets.
 */

export const IDS = {
  app: "app",
  toolbar: "toolbar",
  canvas: "canvas",
  pagedOutput: "paged-output",
  emptyState: "empty-state",
  dragOverlay: "drag-overlay",
  warningBanner: "warning-banner",
  errorCard: "error-card",
  pageChip: "page-chip",
  zoomControl: "zoom-control",
  statusLive: "status-live",
  fileInput: "file-input",
} as const;

/** App-authored class names (no leading dot). */
export const CLASSES = {
  // chrome
  toolbarGroup: "toolbar-group",
  toolbarDivider: "toolbar-divider",
  segControl: "seg-control",
  segOption: "seg-option",
  toggleBtn: "toggle-btn",
  exportPrimary: "export-primary",
  exportSecondary: "export-secondary",
  isPaginating: "is-paginating",
  // rendered document
  doc: "doc",
  codeFigure: "code-figure",
  withLineNumbers: "with-line-numbers",
  callout: "callout",
  calloutTitle: "callout-title",
  toc: "toc",
  tocLink: "toc-link",
  xref: "xref",
  footnote: "footnote",
  footnotes: "footnotes",
  footnoteItem: "footnote-item",
  footnoteBackref: "footnote-backref",
  taskListItem: "task-list-item",
  headerAnchor: "header-anchor",
  katexDisplay: "katex-display",
  mermaidFigure: "mermaid-figure",
  landscape: "landscape",
} as const;

/** Data attributes the app sets and reads. */
export const ATTRS = {
  appTheme: "data-app-theme", // on <html>: light | dark | sepia
  codeTheme: "data-code-theme", // on .doc: active Shiki theme family
  shrunk: "data-shrunk", // on a shrink-to-fit block: the applied scale
} as const;

/** Paged.js emits these — never rename them. */
export const PAGEDJS = {
  pagesClass: "pagedjs_pages",
  pageClass: "pagedjs_page",
  insertedStylesSelector: "style[data-pagedjs-inserted-styles]",
  pageNumberAttr: "data-page-number",
} as const;

/** `#id` selector for an entry in IDS. */
export function sel(id: keyof typeof IDS): string {
  return `#${IDS[id]}`;
}

type ElProps<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], "className" | "dataset" | "style">
> & {
  class?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
};

/** Minimal typed element factory used across the UI layer. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, dataset, attrs, ...rest } = props;
  if (className) node.className = className;
  if (dataset) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = v;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  Object.assign(node, rest);
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
