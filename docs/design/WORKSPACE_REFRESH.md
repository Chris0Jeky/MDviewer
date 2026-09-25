# Workspace refresh

## Scope

Keep Markdown-to-PDF editing and output local, while making the workspace easier to navigate. The primary action row contains document identity, opening, view mode, screen theme and export. A native Document layout disclosure groups typography, paper and page furniture. A separate local-session row explains the in-memory document lifetime and offers Save Markdown for an exact source download.

Layout controls start expanded on desktop and collapsed at widths up to 760 px. Escape closes the disclosure and restores its summary focus without resetting document settings. Existing keyboard controls and accessible names remain in use. Screen themes remain separate from document styling.

## Preview correctness (#57)

The sheet stack still uses paint-only transform scaling. A matching outer scroll envelope removes the unscaled blank tail at half-size/Fit without changing any sheet's natural dimensions. The envelope is removed before pagination and reset for print. A zero-height sticky anchor keeps the busy overlay inside the preview viewport even when deeply scrolled.

## Validation and remaining gates

Isolated Chromium checks with the actual Toolbar and Canvas modules reproduced a 2329 px half-size scroll tail and an offscreen overlay, then verified a zero tail and viewport-aligned overlay after the change. Responsive toolbar probes at 320, 390 and 1440 px showed no horizontal overflow. These used a stub App and fixed-size placeholder sheets, not the complete production application.

Production Playwright coverage checks source download bytes, document identity, disclosure/focus preservation, phone reachability, half-size scroll extent, unchanged natural sheet height and print reset. Existing editor tests retain their assertions with exact button locators and the now-visible single-document identity.

Full hosted CI and independent review are merge gates. The pre-existing AI-6 second-engine/manual-feel and AI-7 live production/PWA operator checks remain open. This change does not claim deployment, operator sign-off, or browser coverage beyond evidence actually run.
