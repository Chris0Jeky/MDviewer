# AGENT_INDEX

Current navigation map for MDviewer. Read the narrow owning seam before editing; do not skim unrelated rendering code to change toolbar behavior. The pre-integration index is retained in [AGENT_INDEX_BASELINE.md](AGENT_INDEX_BASELINE.md) for its detailed older symbol and fixture descriptions. This index and the canonical specification take precedence where behavior changed.

## Read order

1. `../ACTION_ITEMS.md`, then `../AGENTS.md` and the applicable `../CLAUDE.md` runtime contract.
2. `../ORCHESTRATOR.md` and `../docs/Project_Roadmap.md` for current state and priorities.
3. `../docs/design/IMPLEMENTATION_SPEC.md` for current contracts, especially sections 3, 5, 7, 9, 12 and 14.
4. [Future work](../docs/FUTURE_WORK.md) and [#195](https://github.com/Chris0Jeky/MDviewer/issues/195), then the owning source/tests below. Native Save/Save As [#196](https://github.com/Chris0Jeky/MDviewer/issues/196) and recovery [#197](https://github.com/Chris0Jeky/MDviewer/issues/197) are design-first proposals, not current behavior. Start with [`FILE_LIFECYCLE.md`](../docs/design/FILE_LIFECYCLE.md) and [`RECOVERY.md`](../docs/design/RECOVERY.md); the Windows compare/replace primitive remains an explicit implementation gate.
5. The retained `../docs/design/IMPLEMENTATION_FOUNDATION.md` only for unchanged API or editor/no-slice details relevant to the task. Its dated dependency inventory is not current evidence. Current failure records live in `../docs/agentic/failure_ledger.jsonl`.

Do not change a public export, DOM contract or render ordering without updating this index and the canonical specification in the same change. Keep branch work isolated; use merge commits, exact-head CI and latest-head independent review. Never claim an unavailable local, second-engine or live deployment check passed.

## Product and flow

Local-first Markdown reader/editor and paginated PDF workspace for the web and experimental Windows app. The desktop continuous reader loads the shared workspace on demand. Open documents and latest-close recovery stay in memory; no automatic/app-managed document or session persistence is added. Settings and approved Pulseboard keys are the exceptions for persisted app-managed user state. The content-free SDK is reached only through `src/app/pulse.ts`; document content is never uploaded. Vector print is primary; raster PDF is the fallback. Save Markdown writes an explicit copy through the browser or native destination without adopting an original-file binding or clearing the dirty baseline.

```text
input / textarea → DocStore → serialized scheduler → App.runPipeline
 → highlighter → parse actual fences + prepare curated grammars → same-token Markdown + KaTeX
 → build source / TOC / one float per footnote → Mermaid → stamp atomic identities
 → fonts/images → Paged.js preview → href-only footnote repair → completed snapshot

Export click → capture document id/name/text and settings NOW
 → scheduler.withRenderLock → prepare/reuse that captured input → print/capture
 → release host → queued edits/switches/closes catch up
```

## Ownership map

| Concern | Owning seam | Tests / contract |
| --- | --- | --- |
| Windows continuous reader and lazy workspace handoff | `src/desktop/{main,session,render,workspace,native}.ts`, `desktop.html`, `vite.desktop.config.ts` | `tests/desktop-{session,lifetime}.test.ts`, `tests/desktop-e2e/` (including bounded Undo recovery), spec §14; `docs/WINDOWS_DESKTOP.md` |
| Native file/URL/export capabilities, single-instance forwarding and Windows artifacts | `src-tauri/`, `.github/workflows/desktop.yml`, `scripts/desktop-{smoke.ps1,native-licenses.mjs}` | Native Rust tests, actual Windows smoke; `src-tauri/README.md`; no webview filesystem/shell access |
| App orchestration, parsed-fence grammar preparation, captured export inputs, completed-render eligibility, update reload decision | `src/app/App.ts` | `tests/app-fence-languages.test.ts`, `tests/app-export-fence.test.ts`, `tests/app-export-lifetime.test.ts`; spec §§3,5,9 |
| Document memory, atomic `addBatch` imports and serialized/coalesced render-host leases | `src/app/state.ts` | `tests/state.test.ts`, `tests/render-lease.test.ts` |
| Settings migration, tokens, fonts, paper geometry | `src/app/settings.ts` | `tests/settings.test.ts`; spec §9 |
| Browser-chrome color per screen theme | `src/app/themeColor.ts` | `tests/theme-color.test.ts`, theme-color e2e; spec §7 |
| Input picker/drop/paste validation, request focus ownership, teardown cancellation and sample | `src/app/input.ts`, `src/app/sampleDoc.ts` | `tests/input.test.ts`, `tests/input-race.test.ts`, `tests/e2e/input-race.spec.ts`; spec §7 pins passive imports and first-file batch selection |
| Pulseboard SDK seam (content-free events, error shield) and locked artifact | `src/app/pulse.ts`, `public/pulseboard.js`, `observatory.lock.json`, `observatory/check.mjs` | `tests/pulse.test.ts`, `tests/pulse-egress.test.ts` (isolated privacy/egress behavior and mutation controls), `npm run agent:observatory:check`; spec §1 |
| Manual Pages promotion of the exact E2E-tested artifact; dry path without production environment | `.github/workflows/deploy.yml`, `scripts/deployment-artifact.mjs` | `tests/deployment-artifact.test.ts`; `docs/DEPLOYMENT.md`, AI-9 remains open |
| DOM IDs/classes and factories | `src/app/dom.ts` | `tests/dom-contract.test.ts`; spec §8 |
| Native beforeunload and explicitly accepted reload | `src/app/reloadGuard.ts` | `tests/reload-guard.test.ts` |
| Recoverable activation/readiness/reload prompt | `src/ui/UpdatePrompt.ts`, `src/main.ts` | `tests/update-prompt.test.ts`; live AI-7 remains open |
| Markdown, sanitization, warnings, anchors | `src/render/markdown.ts`, `src/render/sanitize.ts` | Markdown and sanitizer tests |
| Fine-grained Shiki + curated grammars | `src/render/highlight.ts` | `tests/highlight.test.ts` |
| Mermaid preparation and graceful failure | `src/render/mermaid.ts` | `tests/mermaid.test.ts` |
| TOC placement, unique float identity, source preparation | `src/render/buildSource.ts` | `tests/buildSource.test.ts`, `tests/footnote-targets.test.ts` |
| Generated footnote destinations after preview | `src/paginate/footnoteLinks.ts` | `tests/footnote-targets.test.ts`, `tests/e2e/footnote-targets.spec.ts` |
| Paged.js lifecycle, handlers, CSS, measurement and shrink tiers | `src/paginate/{paginate,handler,cssBuilder,measure,shrinkToFit}.ts` | Unit pagination tests, `tests/e2e/nocutoff.spec.ts` |
| Vector / raster PDF | `src/export/{print,download,footnoteMarkers}.ts` | `tests/export-download.test.ts`, `tests/raster-{content-clone,styles-ready,footnote-markers}.test.ts`, `tests/e2e/export.spec.ts`, `tests/e2e/raster-resolution.spec.ts` (preview isolation), `tests/e2e/raster-{visual,footnotes,styles-ready}.spec.ts` (saved pixels, CSS delay/failure recovery and damage controls); spec §§5,10 and `docs/PDF_VISUAL_REGRESSION.md` |
| Offline raster capture document and CSS ownership | `src/export/offlineCapture.ts`, `src/export/download.ts` | `tests/raster-offline-capture.test.ts`, `tests/e2e/raster-offline-frame.spec.ts`, existing saved-PDF pixels and real CSS/font cache-loss/no-save/retry in `tests/e2e/raster-{visual,styles-ready,fonts-ready}.spec.ts`; spec §§5,6,10; `docs/design/RASTER_OFFLINE_CAPTURE.md` |
| Export progress and outcomes in every workspace view | `src/ui/ExportStatus.ts`, `src/app/App.ts`, `src/export/download.ts` | `tests/export-status.test.ts`, export-lifetime/download tests, `tests/e2e/export-status.spec.ts`; spec §§5,7 and `docs/design/EXPORT_STATUS.md` |
| Exact source download and filename | `src/export/markdown.ts` | `tests/markdown-download.test.ts`, `tests/e2e/workspace-design.spec.ts` |
| Local Open/Save and optional desktop New keyboard adapter and hint | `src/ui/DocumentShortcuts.ts`, `src/main.ts` | `tests/document-shortcuts.test.ts`, `tests/e2e/document-shortcuts.spec.ts`; spec §§6-8 |
| Action hierarchy, layout disclosure, source-save UI | `src/ui/Toolbar.ts`, `src/styles/workspace.css` | Workspace and existing export/editor E2E |
| Preview zoom envelope, horizontal reach, pinned feedback | `src/ui/Canvas.ts`, `src/styles/{preview,workspace}.css` | `tests/e2e/workspace-design.spec.ts` and canvas E2E |
| Textarea/backdrop, native editing/ownership, split layout | `src/ui/{Editor,Splitter}.ts`, `src/styles/editor.css` | Editor/splitter unit and `tests/e2e/editor.spec.ts` |
| Empty state, warnings, error feedback | `src/ui/{EmptyState,Banner}.ts`, `src/app/App.ts` | `tests/app-ingestion-notices.test.ts`, `tests/app-export-lifetime.test.ts`, `tests/e2e/{empty-error,raster-styles-ready}.spec.ts`; spec §7 pins independent notice/warning lifetimes and visible, recoverable fatal feedback |
| Offline precache and worker policy | `vite.config.ts`, `src/main.ts`, `src/styles/pwa.css` | PWA tests; operator gates still apply |
| Patched transitive dependencies and supported Node floor | `package.json`, `package-lock.json` | `tests/dependency-security.test.ts` checks the wrapper-resolved KaTeX trust boundary and encoded-host normalization; spec §2 |
| Required verification and browser artifacts | `.github/workflows/ci.yml` | Node 24 verification and production Chromium; retained Node 22 compatibility probe |

## New or changed public seams

```typescript
// Existing RenderScheduler additionally owns the host for the awaited task.
withRenderLock<T>(task: () => Promise<T>): Promise<T>;
// Never call flush from inside a lease. Pending preparation and later close are serialized.

// src/paginate/footnoteLinks.ts
repairFootnoteLinks(host: ParentNode): void;
// Called inside paginate after awaited Previewer.preview; only citation hrefs change.

// src/export/markdown.ts
markdownFilename(name: string): string;
downloadMarkdown(name: string, text: string): void | Promise<void>;

// src/ui/DocumentShortcuts.ts
mountDocumentShortcuts(root: HTMLElement): () => void;
// Mount after Toolbar; returned teardown restores attributes and removes hints/listeners.

// src/app/themeColor.ts: meta theme-color mirrors --bg-toolbar per screen theme
export const THEME_COLORS: Record<ScreenTheme, string>;
export function themeColorFor(theme: ScreenTheme): string;
export function syncThemeColor(theme: ScreenTheme): void;

// src/app/reloadGuard.ts
interface ReloadGuard { tryReload(): boolean; destroy(): void; }
installReloadGuard(
  hasWork: () => boolean,
  actions?: { confirm(message: string): boolean; reload(): void },
): ReloadGuard;

// src/ui/UpdatePrompt.ts
interface UpdatePromptController { notifyReady(): void; destroy(): void; }
interface UpdatePromptOptions {
  applyUpdate(): void | Promise<void>;
  requestReload(): boolean;
  activationTarget?: EventTarget;
  onDismiss?(): void;
}
mountUpdatePrompt(options: UpdatePromptOptions): UpdatePromptController;

// App additional method
reloadForUpdate(): boolean;
```

`paginate`, `CanvasController`, existing editor/splitter functions and App export method signatures stay unchanged. `RenderInput`, snapshot matching and `prepareExport` are App-private, not a new global API. `src/types/window.d.ts` stays unchanged.

## Invariants and tripwires

Capture export input before queueing, not when a queued render eventually starts. Keep the host leased until capture/print and any native save settle; do not teardown it on an intervening close. New failed preparation invalidates export eligibility even if old pages stay visible. Each scheduled render builds a fresh source fragment; export reuses a matching completed paginated render under the lease.

Offline raster capture selects its controlled `srcdoc` destination before staging only when the source reports offline and has a service-worker controller. The temporary library frame omits exact source CSS links; the final document restores fresh links in the original cascade order and must observe successful CSS/font outcomes. Preserve source inline styles, trailing renderer-adopted styles and generated body pseudo styles. Controller/document mismatches, resource errors and owned wait deadlines save no PDF and remove both frames. Do not add fallback CSS after an arbitrary failed request or bypass the online CSS failure guards. This private adapter adds no App/global API, persistence, worker policy or print-routing change; see the offline capture design note for its direct-head CSS scope and exact-head evidence.

Source footnote IDs must avoid headings and suffix collisions. Repeated citations share one float; post-preview repair uses Paged.js `data-id` to generated-note mapping and leaves unrelated links alone.

Screen import order is app, editor, preview, document, workspace, print, shiki, pwa. Never use CSS `zoom` or change natural page dimensions. Outer scroll sizing is removed before pagination and reset in print. Full-size sheets must remain horizontally reachable on narrow screens.

The PDF action classes identify PDF actions only; source New/Open/Save use `workspaceAction` for styling and explicit `data-document-command` identities for routing. Keep filename visible for one document and source bytes exact. Disclosure Escape returns focus and preserves settings. Desktop supplies `layoutInitiallyOpen: false` through App/Toolbar; the web entry keeps its viewport-adaptive default. This screen-only disclosure preference is never persisted and does not alter pagination. Desktop tests: `tests/desktop-toolbar.test.ts`, `tests/desktop-e2e/toolbar.spec.ts`.

Document shortcuts call the existing direct `button[data-document-command="open"]` in `.workspace-actions` and `button[data-document-command="save"]` in `.workspace-session`. An optional unique `button[data-document-command="new"]` adds desktop Ctrl/Cmd+N. Missing required or ambiguous commands fail mounting; styling classes are not routing identities. The buttons own creation, opening and saving. The session `.workspace-privacy` hosts the visible `.workspace-shortcuts` hint. Respect handled/IME/Alt/Shift/combined-modifier events; prevent matched disabled or repeated keys without clicking. Detached workspaces are inert. Main owns installation and HMR disposal; all original button attributes are restored on teardown. Saving source never persists it in the app or removes unload protection.

UpdatePrompt readiness is not reload consent. `onNeedReload` suppresses the plugin's automatic navigation. App rejects reload during export; current work is checked immediately before an explicitly accepted navigation. Cancellation, dismissal, rejection and timeout must leave usable controls and navigation protection.

## Validation and handoff

Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run agent:observatory:check`, `npm run build`, then production Playwright (`E2E_TARGET=preview`). The required workflow verifies supported Node 24 with strict engine checks and runs production Chromium on Node 24. The existing Node 22 required-check context remains a legacy compatibility probe until branch protection is updated. Inspect exact-head job results and actual failure artifacts. Independent review findings require evidence-backed fixes, not just green CI.

Required tests must pass; report existing opt-in performance-ladder skips separately. No-slice, vector/raster export, source-download bytes, phone layout and print reset are real-browser assertions. An isolated stub-App/placeholder-sheet probe is only component evidence. AI-6/AI-7/AI-8/AI-9 and Windows acceptance/performance #169 remain OPEN. #62 archive provenance is closed by the `MDVIEWER_SOURCE_ID` build labelling; runtime fixes alone never closed it. #59's historical deployment-evidence inconsistency is closed, while AI-7's separate live/PWA acceptance remains open. Preserve historical receipts and record actual commit/run identifiers in handoffs.

## Latest-close recovery seam

`src/ui/DocumentRecovery.ts`, mounted and destroyed by `src/ui/Toolbar.ts`, owns a single memory-only closed-document snapshot. See canonical specification section 13. Signature:

```typescript
export interface DocumentRecoveryController { closeActive(): void; destroy(): void; }
export type RestoreAdmission = (doc: Readonly<Pick<Doc, "name" | "text">>) => boolean;
export function mountDocumentRecovery(
  root: HTMLElement,
  store: DocStore,
  returnFocus: () => void,
  canRestore?: RestoreAdmission,
): DocumentRecoveryController;
```

Toolbar Close delegates to `closeActive`; Undo consumes the copied name/text and calls the existing `DocStore.add` with a fresh identity. Existing App store listeners continue to own rendering/export coordination. A later real close replaces recovery. Discard and toolbar teardown clear it and the displayed filename/title. Nothing persists, no timer/global listener is added, and reload/tab close loses recovery. Closed content is not an open document for navigation protection.

`App.init`'s optional `canRestoreDocument` callback is forwarded through Toolbar to
the recovery controller. It runs synchronously before consumption. Refusal preserves
the offer for retry until another explicit close/Discard/teardown. Web defaults stay
unchanged; desktop reuses the 32-document / 25,000,000 UTF-8-byte admission gate.
Desktop releases the reader's old source list after successful handoff, prunes closed
workspace baselines and clears them after successful return. Missing baselines remain
dirty, and a failed teardown flush restores the same identities and baselines. Title
and reader picker metadata follow the current workspace store, including queued input.
Desktop entry and return keep the App subtree inert through their ownership handoff.
Entry releases it and drains queued imports before focusing; failure paths release
the guard without discarding transferred sources. Reading view/New share one
transition/export/native-save availability calculation. The native smoke requires
visible, enabled UIA buttons; `readyWorkspace` also waits for actual inert=false.
See `tests/desktop-lifetime.test.ts`, `tests/desktop-new-document.test.ts` and
`docs/design/2026-11-05-desktop-workspace-readiness.md`.

Screen-only `.document-recovery` and its status/name/action/hint classes live in `workspace.css`, with explicit hidden/print handling. Do not borrow New/Open/Save `data-document-command` identities for recovery buttons. Close focuses Undo; completion returns focus to an appropriate visible editor/document/Open control without changing view mode. Unit coverage: `tests/document-recovery.test.ts`; production geometry, exact source, multi-document, discard and focus: `tests/e2e/undo-close*.spec.ts`.


## Guarded source editing

`EditorController.setDocument` accepts an optional stable `id`; App's DocStore
supplies it. Same-ID/same-text notifications preserve caret and undo. Equal-text
identity switches invalidate delayed work and replace the textarea to isolate native
undo history; first-input adoption is preserved. The read-only `input` getter returns
the current node; node listeners must be rebound after a switch. `replaceRange(start, end, text,
signal?): Promise<boolean>` replaces UTF-16 ranges through shared UTF-8 admission,
selection/document/revision/focus guards and native insertText. False means refused,
stale, unavailable, unchanged or aborted. The manual fallback emits one input event.
Abort prevents commitment but does not settle or dismiss the host confirmation.
See spec §12, `tests/editor-edit-safety.test.ts`,
`tests/e2e/editor-edit-safety.spec.ts` and
`docs/design/2026-11-05-editor-edit-ownership.md`.


## Desktop New document

`src/desktop/main.ts` owns creation from reader/empty/workspace controls and
Ctrl/Cmd+N. `src/desktop/session.ts` exports
`nextUntitledName(docs: readonly { name: string }[]): string` for case-insensitive
open-name collision avoidance. Desktop admits the empty source through current
count/UTF-8 limits, records a clean baseline, preserves existing sources and late
open selection ownership, then reveals/focuses the source. Mode transitions,
export and native save block creation. Reader startup stays lazy until New or
Edit & PDF. `App.init` forwards optional `createDocument?: () => void` through
Toolbar; web defaults remain compatible. See spec §14,
`tests/desktop-new-document.test.ts`, `tests/desktop-e2e/new-document.spec.ts` and
`docs/design/DESKTOP_AUTHORING_PLAN.md`.


## Reader-only lazy highlighting

Canonical contract: implementation spec section 15. `createMarkdown` accepts a nullable
highlighter for the continuous reader. `parsedFenceLanguages(md, tokens)` reads only real
parser fences and decodes their info with the parser's own utility, matching rendering.
`installMarkdownHighlighter(md, hl, settings)` enables synchronous Shiki
without changing parsed structural state. `renderMarkdownTokens(md, tokens, env)` shares
the sanitizer and warnings with `renderMarkdown(md, src)` and requires the same parser's
tokens/environment. `src/desktop/render.ts` owns reader admission; line-number/notation/metadata
requests retain the existing transformers. App also prepares decoded parser fences and
installs Shiki afterward, preserving the loaded-language snapshot and web layout order.
Shared fence rendering normalizes label case/prefix and decoded Mermaid labels without
decoding twice, changing lowercase alias classes or rewriting metadata.
`getReaderHighlighter(languages)` prepares only requested grammar modules and embedded
dependencies, retaining all themes. `getHighlighter()` independently awaits the complete
common-grammar workspace contract on the same engine. Pending canonical registrations are
shared and retry after failure; only the workspace gate establishes complete common-grammar readiness.
Modules with optional embeds explicitly await the workspace gate to preserve existing
embedded-language colors; that compatibility path is excluded from workspace preparation.
Tests: `tests/desktop-lazy-highlight.test.ts`, `tests/highlight-reader.test.ts`,
`tests/desktop-e2e/startup.spec.ts`.

## Development dependency compatibility

Canonical dependency authority remains implementation spec section 2. Scoped
minimatch/glob overrides are coupled because glob 11 consumes the old compiled
pattern representation. `tests/dev-dependency-compatibility.test.ts` resolves the
installed ESLint, config-array, typescript-estree and Workbox consumers through
CommonJS and checks bounded preprocessing, matching/ignores, real precache output
and canceled filesystem traversal. Advisory evidence and rejected deepmerge audit
residue are documented in `docs/DEVELOPMENT_DEPENDENCIES.md`.

## Source Find and Replace

`src/ui/EditorSearchModel.ts` owns bounded literal matching (2,000 query characters,
10,000 retained matches), UTF-16 navigation and exact UTF-8 bulk-edit preflight.
`src/ui/EditorSearch.ts` mounts the inline source search panel and receives guarded
`replaceRange`; it does not directly mutate source. Its `setInput` rebinds selection
listeners to the current textarea, `sourceChanged(true)` aborts stale edits, and
`destroy` removes timers/listeners. Canonical IDs/classes are in `src/app/dom.ts`;
responsive geometry is in `src/styles/editor.css`. Search is memory-only, scans
only while open, preserves source/native undo ownership and never prints.
`src/ui/EditorMatchCue.ts` owns the visible active-match rectangle layer. It shares
cached geometry between reveal and paint, uses existing syntax ranges or an
ephemeral plain-source mirror, and translates the cache on scroll. Clear/rebind/
destroy release geometry and pending work; it never owns source, focus or undo.
See `tests/editor-match-cue.test.ts`, `tests/e2e/editor-search-cue.spec.ts` and
`docs/design/2026-11-05-active-search-match-cue.md` for the lifecycle and real-browser
coverage. The canonical DOM ID is `editor-match-cue`.
See spec §12, `tests/{editor-search,editor-search-model}.test.ts`,
`tests/e2e/editor-search.spec.ts`, `tests/desktop-e2e/editor-search.spec.ts` and
`docs/superpowers/specs/2026-11-05-editor-find-replace-design.md`.
