# Desktop writing-space polish

The merged New-document screenshots at 1280 × 720 show the source pane beginning
around y=340 while Document layout is expanded. Start the desktop disclosure
collapsed at every width so normal writing has more room. Keep its existing
summary, one-click expansion, Escape focus behavior, saved settings and PDF
controls. Pass an explicit optional `layoutInitiallyOpen` preference from the
desktop workspace through App to Toolbar; the web entry keeps its adaptive
default. Disclosure state is not a new persisted setting.

Shorten the desktop return-bar hint to “Save Markdown saves a copy.” This describes
native saving accurately and leaves source-copy/dirty-baseline behavior intact.

Prove the desktop default and retained settings through real workspace mounting,
then add production browser checks for source height, disclosure interaction,
unchanged page/source state and screenshots. No Editor/Search, export or document
rendering changes are included. Hosted browser/native evidence and independent
review remain required; AI-6/AI-7/AI-8/AI-9 and Windows issue #169 remain open.

## Local candidate verification — 2026-11-05

The real-workspace regression failed two wide-desktop assertions against the
merged New-document source while three controls passed. The candidate passes all
five focused checks and `agent:check` (731 unit tests, four server tests, typecheck,
lint and SDK integrity), both production builds, hook smoke and 14 skill checks.
Builds carry the source-archive label
`local-main-3e671128-desktop-toolbar-candidate`. Existing dependency deprecation
and large-chunk warnings remain; dependencies are unchanged.

The browser scenarios require at least 450px of workspace and 420px of source
height at 1280 × 720. They compare page identities, geometry, text and settings
across disclosure changes and exercise retained controls at 560px. They capture
collapsed/expanded 1280px and collapsed 560px screenshots. Browser/native checks
have not run locally; no publication, geometry result or Windows result is claimed.
