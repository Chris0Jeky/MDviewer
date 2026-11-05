# Authoring quality across browser engines

## Goal and design

Issue [#203](https://github.com/Chris0Jeky/MDviewer/issues/203) adds a bounded
production Firefox lane on Windows beside the existing Chromium and native Windows checks.
The existing textarea, render pipeline and offline application assets remain the
product. Browser testing must exercise those real components, including native
undo; synthetic DOM geometry and successful mocks cannot establish this behavior.

Reusing the existing editor, Find and shortcut specifications gives both engines
the same behavioral assertions. A separate configuration limits the Firefox lane
to authoring, uses its own ports and output directory, and never reuses another
checkout's server. Repeating the entire raster/CDP/PWA suite would confuse this
scope with cross-engine export qualification; a component-only page would miss
production bundle, CSS and desktop lazy-entry failures.

## Implementation plan

- [x] Run real production Firefox against the existing native undo, selection,
  source/backdrop geometry, Find/Replace, Open/Save, New and layout controls.
- [x] Add keyboard focus/state and accessibility-tree checks, composition-guard
  checks, narrow/short reflow, reduced-motion and forced-colors controls.
- [x] Fix demonstrated authoring regressions without weakening assertions; retain
  failing controls where they establish that an accessibility check is meaningful.
- [x] Add a named CI job and artifact upload for screenshots, traces and exact browser versions.
- [x] Reconcile the coverage matrix, canonical contracts and open human gates.

## Qualification

Local Node 24.22.1 verification passes typecheck, lint, all 832 units, four server
tests, the Observatory guard, both production builds, hook smoke and all 14 skill
validations. The production Firefox 157.0 lane passes **39 tests without retries**.
The forced-colors regression first failed against the unmodified stylesheet;
the before screenshot has no visible match cue, while the fixed screenshot shows
a system-colored outline and readable native text. The same test remains in the
full Chromium suite. Exact-head hosted Chromium/Windows/Firefox and independent
review remain required before merge; the PR records those receipts.

The Firefox run also exposed a test-fixture limitation: constructor-created
`ClipboardEvent` discards a supplied DataTransfer in that engine. The helper now
supplies the untrusted test event's own payload only when necessary. Its real
production listener still must prevent the oversized paste, show the confirmation,
and leave the 300,000-character source unchanged on dismissal. There is no product
clipboard fallback or weakened size assertion.

This managed Linux container requires `MOZ_DISABLE_CONTENT_SANDBOX=1` for local
Firefox because user namespaces are unavailable; that process-only setting is not
in the product or CI. The locked Chromium archive downloaded empty here and the
older preinstalled Chrome could not open its process-singleton socket, so hosted
Chromium and native Windows jobs supply those checks. Neither limitation is a
passing browser result. The CI job uses a normal Firefox launch on Windows. Its first Linux attempt spent
15 minutes downloading OS packages from the Ubuntu mirror and timed out before
installing Firefox or executing a test. Moving this lane onto Windows removes that
Linux package-install prerequisite while qualifying the same locked Firefox and
unchanged authoring assertions on the desktop target OS. It does not replace the
separate native WebView2 smoke.

Reproduction on a supported local development environment:

```sh
npm ci --engine-strict
npx playwright install --with-deps firefox
npm run build
npm run desktop:build:web
npm run test:authoring
```

| Surface | Automated evidence | Separate acceptance |
| --- | --- | --- |
| Web source editor | Native undo/redo, first-edit adoption, same-content document isolation, Tab, live preview, selection, backdrop metrics and scrolling | Subjective typing feel, real IME composition and clipboard UI |
| Find/Replace | Literal Unicode search, match geometry, focus, keyboard state, one-step Replace all undo, print exclusion | Narrator speech and ordinary assistive technology use |
| Desktop browser entry | Lazy New, distinct notes, admission, keyboard Open/Save, exact saved UTF-8, disclosure, error recovery and short/narrow windows | Explorer, native dialogs, installation, physical printers and WebView2 runtime |
| Contrast and reflow | Forced-colors source/caret/match outline, reduced-motion scrolling, 560×420 and 640×480 CSS-pixel layouts | Actual Windows contrast themes and user browser zoom settings |

## Coverage and limits

The new lane exercises the production web and desktop browser bundles in Firefox.
The real Windows app continues to use WebView2, and is still covered by the native
Windows workflow. Firefox is selected from the repository's locked Playwright
package; each accessibility specification attaches the actual runtime version.

Composition events test the application's guards in a real engine. They do not
emulate an operating-system IME candidate window. Accessible names, roles,
keyboard focus, state, visible geometry and media emulation are automation evidence;
they do not establish Narrator speech output, ordinary Windows high-contrast theme
behavior, subjective typing feel or full browser compatibility.

AI-6 and Windows acceptance [#169](https://github.com/Chris0Jeky/MDviewer/issues/169)
remain open for their human checks. AI-7/AI-8/AI-9 remain open for live/PWA,
Pulseboard and production promotion. This work does not deploy the public app.

## Review correction: authored IDs

Independent review found that an authored “Editor highlight” or “Editor input”
heading shares the editor host's ID. A real production Firefox control failed:
the heading inherited `position: absolute` from source-editor CSS. The new forced
colors rule could also hide it. Input/highlight paint and geometry selectors now
require the actual workspace/editor/scroll parent chain, with declarations and
cascade order preserved. The regression checks both headings in normal and forced
colors and confirms that print hides only the editing pane. This is covered in
`authoring-accessibility.spec.ts`; a passing editor-only fixture was insufficient.
