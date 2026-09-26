/**
 * Browser-chrome color for the active screen theme.
 *
 * The single source of truth for `meta[name="theme-color"]` after boot. Values
 * mirror `--bg-toolbar` in `src/styles/app.css` so the tab bar / task switcher
 * meets the toolbar without a seam. `index.html` carries the same three values
 * inline in its pre-paint script (it cannot import this module); the default
 * `content` there stays the light value and `head-contract.test.ts` pins the
 * pairing. The PWA manifest's `theme_color` is static light by platform
 * limitation — see the note in `vite.config.ts`.
 *
 * `migrateSettings` does not validate `screenTheme`, so a hand-edited store can
 * hand us an unknown string at runtime: the lookup degrades to light rather
 * than emitting an empty/garbage color.
 */
import type { ScreenTheme } from "./settings";

export const THEME_COLORS: Record<ScreenTheme, string> = {
  light: "#ffffff",
  dark: "#1d2026",
  sepia: "#f7f0e1",
};

export function themeColorFor(theme: ScreenTheme): string {
  // Explicit membership test, NOT a map lookup: a hand-edited store can hand us
  // "__proto__"/"toString"/"constructor", which resolve through Object.prototype
  // instead of missing and would bypass a `?? fallback`.
  if (theme === "light" || theme === "dark" || theme === "sepia") {
    return THEME_COLORS[theme];
  }
  return THEME_COLORS.light;
}

/** Point the theme-color meta at `theme`. Silently no-ops when the meta is absent. */
export function syncThemeColor(theme: ScreenTheme): void {
  document
    .querySelector("meta[name='theme-color']")
    ?.setAttribute("content", themeColorFor(theme));
}
