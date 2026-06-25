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
  runningHeader: string; // '' = off; else running-header content
  showLineNumbers: boolean; // CSS-counter line numbers in code
  zoom: "fit" | 1 | 0.5; // preview canvas zoom (UI only, persisted for convenience)
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
  runningHeader: "",
  showLineNumbers: false,
  zoom: "fit",
};

/** Margin preset → millimetres, consumed by the @page stylesheet builder. */
export const MARGIN_MM: Record<MarginPreset, number> = {
  narrow: 12.7,
  normal: 20,
  wide: 30,
};

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
