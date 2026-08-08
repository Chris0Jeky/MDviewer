---
name: mdv-ui-ux
description: Work on toolbar / source editor / splitter / canvas / empty / error / themes / accessibility — keyboard, aria, and reduced-motion included.
user-invocable: true
---

# mdv-ui-ux

Use this for chrome under `src/ui/*` and the screen-only stylesheets. UI work must not
touch the paged stylesheet path — screen and print CSS are deliberately separate.

## Key files

- `src/ui/Toolbar.ts` — `mountToolbar(root, app)`; groups A–F bind controls to
  `Settings` via `app.updateSettings(patch)`; export buttons (`.export-primary`,
  `.export-secondary`).
- `src/ui/Editor.ts` — `mountEditor(root, {onInput, codeTheme})`: the Markdown source
  pane. `#editor-input` (textarea) over `#editor-highlight` (Shiki backdrop).
- `src/ui/Splitter.ts` — `mountSplitter(root, {track, initialRatio, onPreview, onCommit})`:
  the `role="separator"` divider; `onPreview` per frame, `onCommit` once per gesture.
- `src/ui/Canvas.ts` — `mountCanvas(root)`: `#paged-output` host, page chip, zoom,
  `setPaginating(b)` overlay, aria.
- `src/ui/EmptyState.ts` — `mountEmptyState(root, onChoose, onSample)`: full-window
  dropzone / recovery card.
- `src/ui/Banner.ts` — `mountBanner(root)`: `warn(RenderWarning[])` aggregated banner +
  `fatal(msg)` error card, `aria-live`.
- `src/styles/app.css` — grid shell, toolbar, `data-app-theme` tokens (light/dark/sepia
  on `<html>`), focus rings, reduced-motion.
- `src/styles/editor.css` — the `#workspace` view-mode grid, the source-pane metrics,
  and the divider.
- `src/styles/preview.css` — screen-only `.pagedjs_page` sheets, drag overlay,
  paginating spinner, empty state. Its `.empty-*` class names are NOT in `CLASSES`, so
  `dom-contract` does not guard them — keep `EmptyState.ts` and this file in step by hand.

## Rules

- Import all ids/classes from `src/app/dom.ts` (`IDS`, `CLASSES`, `ATTRS`); never
  hardcode. Build elements with `el()`.
- Screen theme (`app.css`, `preview.css`) NEVER affects the PDF — that is print CSS.
- Toggles use `.toggle-btn[aria-pressed]`; segmented controls use
  `.seg-control`/`.seg-option`.
- Accessibility is required: keyboard-operable controls, correct aria roles/labels,
  `aria-live` for banners and status (`#status-live`), and `prefers-reduced-motion`
  honored for the paginating spinner.
- Any new screen-only chrome MUST be hidden by an `@media print` rule. The primary
  export is `window.print()` over this same live document, so a missing rule puts the
  chrome on paper. `dom-contract` asserts this for `#editor-pane` / `#split-handle` /
  `#toolbar`; extend it when you add another.
- The editor's backdrop and textarea must keep IDENTICAL font, size, line-height,
  padding, `tab-size` and wrapping, or the colors drift off the glyphs. Both are
  declared in one rule in `editor.css` — change one, change both.
- Never set the backdrop with `innerHTML`. It is built from `codeToTokens` and inserted
  with `textContent` + `style.setProperty`, so document text is never parsed as markup.
- A rule meant to override a Shiki token color needs `!important`: Shiki writes the
  light color as an INLINE style, which beats any selector without it.
- Layout is CSS-only. `viewMode`/`splitRatio` must never become reflow keys — page
  geometry is millimetre-based (`measurePageArea` reads Settings, not the DOM).

## Verify

`npm run test` (`tests/dom-contract.test.ts` guards id/class drift and the print rules;
`editor.test.ts` and `splitter.test.ts` cover the pane and the divider). Manual / e2e:
`tests/e2e/golden-path.spec.ts`, `empty-error.spec.ts`, and `editor.spec.ts` (view modes,
live typing, layer alignment, drag/keyboard, print media). Check keyboard tab order,
screen-reader labels, and reduced-motion behavior by hand.
