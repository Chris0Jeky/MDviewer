/**
 * Toolbar — the app chrome strip above the canvas. Builds groups A–F of native
 * controls (document switcher, screen theme, code theme, document font + size,
 * paper + margins, layout toggles, running-header input, export actions) and
 * binds each control straight to `app.updateSettings(...)`. No business logic
 * lives here: every change calls into the App, which persists and re-renders.
 */

import { CLASSES, IDS, el } from "../app/dom";
import type {
  CodeThemeId,
  DocFont,
  FontSizePt,
  MarginPreset,
  PaperSize,
  ScreenTheme,
  Settings,
  ViewMode,
} from "../app/settings";
import type { App } from "../app/App";

export interface ToolbarController {
  destroy(): void;
}

/** Option list helpers: [value, label, optional tooltip]. */
type Opt<V extends string> = readonly [value: V, label: string, title?: string];

const VIEW_MODE_OPTIONS: ReadonlyArray<Opt<ViewMode>> = [
  ["editor", "Markdown", "Show only the Markdown source"],
  ["split", "Split", "Show the Markdown source and the PDF preview side by side"],
  ["preview", "Preview", "Show only the paginated PDF preview"],
];

const SCREEN_THEMES: ReadonlyArray<Opt<ScreenTheme>> = [
  ["light", "Light", "Light preview theme"],
  ["dark", "Dark", "Dark preview theme"],
  ["sepia", "Sepia", "Sepia preview theme"],
];

const CODE_THEMES: ReadonlyArray<Opt<CodeThemeId>> = [
  ["github", "GitHub"],
  ["vscode", "VS Code"],
  ["nord", "Nord"],
  ["min", "Min"],
  ["one", "One"],
  ["catppuccin", "Catppuccin"],
];

const DOC_FONTS: ReadonlyArray<Opt<DocFont>> = [
  ["serif", "Serif", "Serif body font"],
  ["sans", "Sans", "Sans-serif body font"],
  ["slab", "Slab", "Slab-serif body font"],
];

const FONT_SIZES: ReadonlyArray<Opt<string>> = [
  ["10", "10 pt"],
  ["11", "11 pt"],
  ["12", "12 pt"],
  ["13", "13 pt"],
];

const PAPER_SIZES: ReadonlyArray<Opt<PaperSize>> = [
  ["a4", "A4", "A4 paper (210 × 297 mm)"],
  ["letter", "Letter", "US Letter (8.5 × 11 in)"],
];

const MARGINS: ReadonlyArray<Opt<MarginPreset>> = [
  ["narrow", "Narrow", "12.7 mm margins"],
  ["normal", "Normal", "20 mm margins"],
  ["wide", "Wide", "30 mm margins"],
];

const FONT_SIZE_VALUES: readonly FontSizePt[] = [10, 11, 12, 13];

/** Narrow a raw <select> value back onto the FontSizePt union. */
function toFontSizePt(raw: string): FontSizePt {
  const n = Number(raw);
  return (FONT_SIZE_VALUES.find((v) => v === n) ?? 11) as FontSizePt;
}

/**
 * Build a segmented control (radio-like group of buttons). The currently
 * selected option carries `aria-pressed="true"`. Selecting an option invokes
 * `onPick` with the typed value.
 */
function segControl<V extends string>(
  label: string,
  options: ReadonlyArray<Opt<V>>,
  current: V,
  onPick: (value: V) => void,
): { group: HTMLElement; sync(next: V): void } {
  const buttons: HTMLButtonElement[] = [];
  const group = el("div", {
    class: CLASSES.segControl,
    attrs: { role: "group", "aria-label": label },
  });

  for (const [value, text, title] of options) {
    const btn = el(
      "button",
      {
        type: "button",
        class: CLASSES.segOption,
        title: title ?? text,
        attrs: {
          "data-value": value,
          "aria-pressed": String(value === current),
        },
      },
      text,
    );
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-pressed") === "true") return;
      onPick(value);
    });
    buttons.push(btn);
    group.append(btn);
  }

  function sync(next: V): void {
    for (const btn of buttons) {
      btn.setAttribute(
        "aria-pressed",
        String(btn.dataset["value"] === next),
      );
    }
  }

  return { group, sync };
}

/**
 * Build a labelled native <select>. The visible <label> is associated via `for`.
 * Selecting fires `onPick` with the raw string value (caller narrows the type).
 */
function selectControl(
  id: string,
  label: string,
  options: ReadonlyArray<Opt<string>>,
  current: string,
  onPick: (value: string) => void,
): { field: HTMLElement; select: HTMLSelectElement } {
  const select = el("select", {
    id,
    class: CLASSES.toolbarSelect,
    attrs: { "aria-label": label },
  });
  for (const [value, text, title] of options) {
    const option = el("option", { value, title: title ?? "" }, text);
    if (value === current) option.selected = true;
    select.append(option);
  }
  select.addEventListener("change", () => onPick(select.value));

  const labelEl = el("label", { class: CLASSES.toolbarLabel, htmlFor: id }, label);
  const field = el("div", { class: CLASSES.toolbarField }, labelEl, select);
  return { field, select };
}

/**
 * Build a toggle button bound to a boolean setting. `aria-pressed` reflects state;
 * clicking flips it through `onToggle`.
 */
function toggleControl(
  label: string,
  pressed: boolean,
  title: string,
  onToggle: (next: boolean) => void,
): { button: HTMLButtonElement; sync(next: boolean): void } {
  const button = el(
    "button",
    {
      type: "button",
      class: CLASSES.toggleBtn,
      title,
      attrs: { "aria-pressed": String(pressed) },
    },
    label,
  );
  button.addEventListener("click", () => {
    const next = button.getAttribute("aria-pressed") !== "true";
    onToggle(next);
  });
  function sync(next: boolean): void {
    button.setAttribute("aria-pressed", String(next));
  }
  return { button, sync };
}

/** A labelled toolbar group with a visible heading for screen readers. */
function group(label: string, ...children: Node[]): HTMLElement {
  return el(
    "div",
    { class: CLASSES.toolbarGroup, attrs: { role: "group", "aria-label": label } },
    ...children,
  );
}

function divider(): HTMLElement {
  return el("div", {
    class: CLASSES.toolbarDivider,
    attrs: { role: "separator", "aria-orientation": "vertical" },
  });
}

/**
 * Mount the toolbar into `root` and wire every control to the App. Returns a
 * controller whose `destroy()` removes the DOM and unsubscribes from the store.
 */
export function mountToolbar(root: HTMLElement, app: App): ToolbarController {
  const s: Settings = app.settings;

  const bar = el("div", {
    id: IDS.toolbar,
    class: "toolbar",
    attrs: { role: "toolbar", "aria-label": "Document and export controls" },
  });

  // ---- Group A: document switcher (only meaningful with more than one doc) ----
  const docSelect = el("select", {
    class: `${CLASSES.toolbarSelect} ${CLASSES.docSwitcher}`,
    attrs: { "aria-label": "Active document" },
  });
  docSelect.addEventListener("change", () => {
    app.store.setActive(docSelect.value);
  });
  docSelect.id = "doc-switcher-select";

  // The switcher itself is noise below two documents, but "close this document"
  // is useful from the first one — so they hide independently (UX-7).
  const docField = el(
    "div",
    { class: CLASSES.toolbarField },
    el("label", { class: CLASSES.toolbarLabel, htmlFor: "doc-switcher-select" }, "Document"),
    docSelect,
  );

  const docCloseBtn = el(
    "button",
    {
      type: "button",
      class: CLASSES.docClose,
      attrs: { "aria-label": "Close document" },
    },
    "×",
  );
  docCloseBtn.addEventListener("click", () => {
    const id = app.store.activeId;
    if (id) app.store.remove(id);
  });

  const docGroup = group("Document", docField, docCloseBtn);

  // ---- Group A2: which panes are visible (screen layout only) ----
  const viewMode = segControl(
    "View",
    VIEW_MODE_OPTIONS,
    s.viewMode,
    (value) => app.updateSettings({ viewMode: value }),
  );
  const viewGroup = group(
    "View",
    el("span", { class: CLASSES.toolbarLabel }, "View"),
    viewMode.group,
  );

  // ---- Group B: screen theme (preview only — never affects the PDF) ----
  const screenTheme = segControl(
    "Preview theme",
    SCREEN_THEMES,
    s.screenTheme,
    (value) => app.updateSettings({ screenTheme: value }),
  );
  const themeGroup = group("Preview theme", screenTheme.group);

  // ---- Group C: typography (code theme, body font, font size) ----
  const codeTheme = selectControl(
    "code-theme-select",
    "Code theme",
    CODE_THEMES,
    s.codeTheme,
    (value) => app.updateSettings({ codeTheme: value as CodeThemeId }),
  );
  const docFont = selectControl(
    "doc-font-select",
    "Body font",
    DOC_FONTS,
    s.docFont,
    (value) => app.updateSettings({ docFont: value as DocFont }),
  );
  const fontSize = selectControl(
    "font-size-select",
    "Font size",
    FONT_SIZES,
    String(s.fontSizePt),
    (value) => app.updateSettings({ fontSizePt: toFontSizePt(value) }),
  );
  const typeGroup = group(
    "Typography",
    codeTheme.field,
    docFont.field,
    fontSize.field,
  );

  // ---- Group D: page geometry (paper size, margins) ----
  const paperSize = segControl(
    "Paper size",
    PAPER_SIZES,
    s.paperSize,
    (value) => app.updateSettings({ paperSize: value }),
  );
  const margins = segControl(
    "Margins",
    MARGINS,
    s.margins,
    (value) => app.updateSettings({ margins: value }),
  );
  const pageGroup = group(
    "Page",
    el("span", { class: CLASSES.toolbarLabel }, "Paper"),
    paperSize.group,
    el("span", { class: CLASSES.toolbarLabel }, "Margins"),
    margins.group,
  );

  // ---- Group E: layout toggles + running header ----
  const toc = toggleControl(
    "TOC",
    s.showToc,
    "Insert an auto table of contents with page numbers",
    (next) => app.updateSettings({ showToc: next }),
  );
  const pageNumbers = toggleControl(
    "Page numbers",
    s.showPageNumbers,
    "Print page numbers in the footer",
    (next) => app.updateSettings({ showPageNumbers: next }),
  );
  const lineNumbers = toggleControl(
    "Line numbers",
    s.showLineNumbers,
    "Show line numbers in code blocks",
    (next) => app.updateSettings({ showLineNumbers: next }),
  );
  // Page 1 used to lose its header and page number unconditionally, with nothing in the
  // UI to say why (BUG-9). The behavior is unchanged by default — it just has a switch now.
  const titlePage = toggleControl(
    "Title page",
    s.titlePage,
    "Suppress the running header and page number on page 1",
    (next) => app.updateSettings({ titlePage: next }),
  );

  const headerInput = el("input", {
    id: "running-header-input",
    class: `${CLASSES.toolbarInput} running-header`,
    type: "text",
    value: s.runningHeader,
    placeholder: "Running header…",
    attrs: {
      "aria-label": "Running header text",
      maxlength: "120",
      autocomplete: "off",
      spellcheck: "false",
    },
  });
  headerInput.addEventListener("input", () => {
    app.updateSettings({ runningHeader: headerInput.value });
  });
  const headerField = el(
    "div",
    { class: CLASSES.toolbarField },
    el(
      "label",
      { class: CLASSES.toolbarLabel, htmlFor: "running-header-input" },
      "Header",
    ),
    headerInput,
  );

  const layoutGroup = group(
    "Layout",
    toc.button,
    pageNumbers.button,
    titlePage.button,
    lineNumbers.button,
    headerField,
  );

  // ---- Group F: export actions ----
  const PRINT_TITLE = "Open the system print dialog to save a vector PDF";
  const DOWNLOAD_TITLE = "Download a rasterized PDF (fallback when printing is unavailable)";
  const NO_DOC_TITLE = "Load a document first";
  const BUSY_TITLE = "Export in progress…";

  const printBtn = el(
    "button",
    {
      type: "button",
      class: CLASSES.exportPrimary,
      title: PRINT_TITLE,
    },
    "Print / Save as PDF",
  );
  printBtn.addEventListener("click", () => {
    void app.exportPrint();
  });

  const downloadBtn = el(
    "button",
    {
      type: "button",
      class: CLASSES.exportSecondary,
      title: DOWNLOAD_TITLE,
    },
    "Download PDF",
  );
  downloadBtn.addEventListener("click", () => {
    void app.exportPdf();
  });

  const exportGroup = group("Export", printBtn, downloadBtn);

  bar.append(
    docGroup,
    divider(),
    viewGroup,
    divider(),
    themeGroup,
    divider(),
    typeGroup,
    divider(),
    pageGroup,
    divider(),
    layoutGroup,
    // Absorb the slack so the export actions sit against the right edge (UX-11).
    el("div", { class: CLASSES.toolbarSpacer, attrs: { "aria-hidden": "true" } }),
    exportGroup,
  );
  root.append(bar);

  // ---- Keep the document switcher and stateful controls in sync ----
  function syncDocSwitcher(): void {
    const docs = app.store.openDocs;
    docSelect.replaceChildren();
    for (const doc of docs) {
      const option = el("option", { value: doc.id }, doc.name);
      if (doc.id === app.store.activeId) option.selected = true;
      docSelect.append(option);
    }
    // The switcher is only meaningful with more than one document open…
    docField.hidden = docs.length < 2;
    // …but closing the current one is meaningful from the first.
    docGroup.hidden = docs.length < 1;
    const activeName = app.store.active?.name;
    docCloseBtn.setAttribute(
      "aria-label",
      activeName ? `Close ${activeName}` : "Close document",
    );
    docCloseBtn.title = activeName ? `Close ${activeName}` : "Close document";
  }

  /** Export controls are inert with nothing to export, and while one is running. */
  function syncExportState(state: { busy: boolean; hasDocument: boolean }): void {
    const disabled = state.busy || !state.hasDocument;
    printBtn.disabled = disabled;
    downloadBtn.disabled = disabled;
    if (!state.hasDocument) {
      printBtn.title = NO_DOC_TITLE;
      downloadBtn.title = NO_DOC_TITLE;
    } else if (state.busy) {
      printBtn.title = BUSY_TITLE;
      downloadBtn.title = BUSY_TITLE;
    } else {
      printBtn.title = PRINT_TITLE;
      downloadBtn.title = DOWNLOAD_TITLE;
    }
  }

  function syncFromSettings(): void {
    const cur = app.settings;
    viewMode.sync(cur.viewMode);
    screenTheme.sync(cur.screenTheme);
    paperSize.sync(cur.paperSize);
    margins.sync(cur.margins);
    toc.sync(cur.showToc);
    pageNumbers.sync(cur.showPageNumbers);
    titlePage.sync(cur.titlePage);
    lineNumbers.sync(cur.showLineNumbers);
    codeTheme.select.value = cur.codeTheme;
    docFont.select.value = cur.docFont;
    fontSize.select.value = String(cur.fontSizePt);
    if (document.activeElement !== headerInput) {
      headerInput.value = cur.runningHeader;
    }
  }

  syncDocSwitcher();
  syncFromSettings();

  const unsubscribe = app.store.on("change", () => {
    syncDocSwitcher();
    syncFromSettings();
  });
  const unsubscribeSettings = app.onSettingsChange(syncFromSettings);
  // Fires immediately with the current state, so this is also the initial sync.
  const unsubscribeExport = app.onExportStateChange(syncExportState);

  return {
    destroy(): void {
      unsubscribe();
      unsubscribeSettings();
      unsubscribeExport();
      bar.remove();
    },
  };
}
