/**
 * Persisted user settings. Only this small object is stored (localStorage key
 * `mdviewer.settings.v1`) — document bytes are never persisted, for privacy and size.
 */

export type ScreenTheme = "light" | "dark" | "sepia";
export type PaperSize = "a4" | "letter";
export type MarginPreset = "narrow" | "normal" | "wide"; // 12.7mm | 20mm | 30mm
export type DocFont = "serif" | "sans" | "slab";
export type FontSizePt = 10 | 11 | 12 | 13;

/** Each id maps via CODE_THEME_PAIRS (render/highlight.ts) to a Shiki { light, dark } pair. */
export type CodeThemeId = "github" | "vscode" | "nord" | "min" | "one" | "catppuccin";

/**
 * Which workspace panes are visible: the Markdown source editor, the paginated
 * preview, or both side by side. Purely presentational — it never changes what is
 * rendered or exported, only what the screen shows.
 */
export type ViewMode = "editor" | "split" | "preview";

export const VIEW_MODES: readonly ViewMode[] = ["editor", "split", "preview"];

/** Split-pane bounds: the editor may never collapse either pane out of reach. */
export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;

export interface Settings {
  schemaVersion: 1;
  screenTheme: ScreenTheme; // app chrome + page-sheet background ONLY (never the PDF)
  codeTheme: CodeThemeId; // Shiki dual-theme pair for code blocks
  docFont: DocFont; // --doc-font-family group
  fontSizePt: FontSizePt; // --doc-font-size base
  paperSize: PaperSize; // @page size
  margins: MarginPreset; // @page margin
  showToc: boolean; // auto TOC with target-counter page numbers
  showPageNumbers: boolean; // @bottom-center counter(page)
  titlePage: boolean; // treat page 1 as a title page: blank its header + page number
  runningHeader: string; // '' = off; else running-header content
  showLineNumbers: boolean; // CSS-counter line numbers in code
  zoom: "fit" | 1 | 0.5; // preview canvas zoom (UI only, persisted for convenience)
  viewMode: ViewMode; // editor / split / preview (screen layout only)
  splitRatio: number; // editor pane fraction of the workspace in split mode
}

export const SETTINGS_KEY = "mdviewer.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  screenTheme: "light",
  codeTheme: "github",
  docFont: "serif",
  fontSizePt: 11,
  paperSize: "a4",
  margins: "normal",
  showToc: true,
  showPageNumbers: true,
  // Default true preserves the long-standing "page 1 is a title page" behavior; the
  // toolbar toggle is what makes it explicit rather than mysterious (BUG-9).
  titlePage: true,
  runningHeader: "",
  showLineNumbers: false,
  zoom: "fit",
  viewMode: "split",
  splitRatio: 0.42,
};

/** Margin preset → millimetres, consumed by the @page stylesheet builder. */
export const MARGIN_MM: Record<MarginPreset, number> = {
  narrow: 12.7,
  normal: 20,
  wide: 30,
};

/**
 * Font-family stack per DocFont group. These mirror `src/styles/document.css` exactly.
 * They live here (not in a render/ or paginate/ module) because both sides need them:
 * `buildPaginationSource` sets `--doc-font-family` on `.doc`, and `buildStylesheet`
 * restates the stack for the Paged.js footnote area, which sits OUTSIDE `.doc` and so
 * cannot inherit the custom property.
 */
export const DOC_FONT_STACKS: Record<DocFont, string> = {
  serif: `"Source Serif 4", "Source Serif Pro", "Charter", "Georgia", "Times New Roman", serif`,
  sans: `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
  slab: `"Roboto Slab", "Rockwell", "Source Serif 4", "Georgia", "Times New Roman", serif`,
};

/**
 * Clamp an arbitrary value onto the usable split-ratio range.
 *
 * Only a genuine finite number is clamped; anything else falls back to the default.
 * Coercing first would be worse than useless here — `Number(null)` and `Number("")`
 * are both `0`, which would silently collapse the source pane to its minimum instead
 * of restoring a sane layout.
 */
export function clampSplitRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.splitRatio;
  }
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value));
}

/**
 * Coerce arbitrary parsed JSON into a valid Settings by merging over the defaults.
 * Unknown/extra keys are dropped; missing keys fall back to defaults. Always returns
 * a usable object (never throws) so a corrupt store can never brick the app.
 */
export function migrateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const r = raw as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    // Pin known-shape fields so a malformed value can't poison the type.
    schemaVersion: 1,
    // `titlePage` feeds a CSS branch in buildStylesheet, so a truthy non-boolean from a
    // hand-edited store would emit an `@page :first` block on a value that never round-
    // trips through the toggle. Validate rather than trust the spread.
    titlePage:
      typeof r.titlePage === "boolean" ? r.titlePage : DEFAULT_SETTINGS.titlePage,
    // Layout fields drive CSS geometry directly: a bogus persisted value would
    // collapse a pane with no way back, so coerce both onto their valid domain.
    viewMode: VIEW_MODES.includes(r.viewMode as ViewMode)
      ? (r.viewMode as ViewMode)
      : DEFAULT_SETTINGS.viewMode,
    splitRatio: clampSplitRatio(r.splitRatio),
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return migrateSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private-mode / quota: settings are best-effort, ignore. */
  }
}
