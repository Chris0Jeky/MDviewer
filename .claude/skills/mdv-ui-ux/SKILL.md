---
name: mdv-ui-ux
description: Work on toolbar / canvas / empty / error / themes / accessibility — keyboard, aria, and reduced-motion included.
user-invocable: true
---

# mdv-ui-ux

Use this for chrome under `src/ui/*` and the screen-only stylesheets. UI work must not
touch the paged stylesheet path — screen and print CSS are deliberately separate.

## Key files

- `src/ui/Toolbar.ts` — `mountToolbar(root, app)`; groups A–F bind controls to
  `Settings` via `app.updateSettings(patch)`; export buttons (`.export-primary`,
  `.export-secondary`).
- `src/ui/Canvas.ts` — `mountCanvas(root)`: `#paged-output` host, page chip, zoom,
  `setPaginating(b)` overlay, aria.
- `src/ui/EmptyState.ts` — `mountEmptyState(root, onChoose, onSample)`: full-window
  dropzone / recovery card.
- `src/ui/Banner.ts` — `mountBanner(root)`: `warn(RenderWarning[])` aggregated banner +
  `fatal(msg)` error card, `aria-live`.
- `src/styles/app.css` — grid shell, toolbar, `data-app-theme` tokens (light/dark/sepia
  on `<html>`), focus rings, reduced-motion.
- `src/styles/preview.css` — screen-only `.pagedjs_page` sheets, drag overlay,
  paginating spinner, empty state.

## Rules

- Import all ids/classes from `src/app/dom.ts` (`IDS`, `CLASSES`, `ATTRS`); never
  hardcode. Build elements with `el()`.
- Screen theme (`app.css`, `preview.css`) NEVER affects the PDF — that is print CSS.
- Toggles use `.toggle-btn[aria-pressed]`; segmented controls use
  `.seg-control`/`.seg-option`.
- Accessibility is required: keyboard-operable controls, correct aria roles/labels,
  `aria-live` for banners and status (`#status-live`), and `prefers-reduced-motion`
  honored for the paginating spinner.

## Verify

`npm run test` (`tests/dom-contract.test.ts` guards id/class drift). Manual / e2e:
`tests/e2e/golden-path.spec.ts` and `tests/e2e/empty-error.spec.ts`. Check keyboard tab
order, screen-reader labels, and reduced-motion behavior by hand.
