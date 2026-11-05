# Desktop writing-space polish

**Completed:** [#187](https://github.com/Chris0Jeky/MDviewer/pull/187), merged as
`3e3733d4e3265d39ed1736dd291f88650d08cc19`, closes
[#186](https://github.com/Chris0Jeky/MDviewer/issues/186). This note retains the
original design and local candidate evidence. Hosted checks and screenshot review
are recorded in the [authoring checkpoint](2026-11-05-authoring-checkpoint.md).

The initial New-document screenshots at 1280 × 720 showed the source pane beginning
around y=340 while Document layout was expanded. The Windows desktop disclosure now
starts collapsed at every width so normal writing has more room. It keeps its
existing summary, one-click expansion, Escape focus behavior, saved settings and PDF
controls. An explicit optional `layoutInitiallyOpen` preference passes from the
desktop workspace through App to Toolbar; the web entry keeps its adaptive default.
Disclosure state is not a new persisted setting.

The desktop return-bar hint says “Save Markdown saves a copy.” It describes native
saving accurately and leaves source-copy/dirty-baseline behavior intact.

Real workspace tests cover the desktop default and retained settings. Production
browser checks cover source height, disclosure interaction, unchanged page/source
state and screenshots. This slice changed no Editor/Search, export or document
rendering behavior. Hosted browser/native evidence and independent review passed;
AI-6/AI-7/AI-8/AI-9 and Windows issue #169 remain open. Further work is tracked in
[Future work](../FUTURE_WORK.md) and [#195](https://github.com/Chris0Jeky/MDviewer/issues/195).

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
could not run locally; the completed #187 hosted checks and screenshot review
supply that evidence, separately from the local candidate counts above.
