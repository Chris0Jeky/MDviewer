# AGENT_INDEX

Current navigation map for MDviewer. Read the narrow owning seam before editing; do not skim unrelated rendering code to change toolbar behavior. The pre-integration index is retained in [AGENT_INDEX_BASELINE.md](AGENT_INDEX_BASELINE.md) for its detailed older symbol and fixture descriptions. This index and the canonical specification take precedence where behavior changed.

## Read order

1. `../ACTION_ITEMS.md`, then `../AGENTS.md` and the applicable `../CLAUDE.md` runtime contract.
2. `../ORCHESTRATOR.md` and `../docs/Project_Roadmap.md` for current state and priorities.
3. `../docs/design/IMPLEMENTATION_SPEC.md` for current contracts, especially sections 3, 5, 7, 9, 12 and 14.
4. [Future work](../docs/FUTURE_WORK.md) and [#195](https://github.com/Chris0Jeky/MDviewer/issues/195), then the owning source/tests below. Native Save/Save As [#196](https://github.com/Chris0Jeky/MDviewer/issues/196) and recovery [#197](https://github.com/Chris0Jeky/MDviewer/issues/197) have reviewed designs merged in #209. Save/Save As is current behavior (S1a #226 conflict-safe replace, S1b #231 owned Save/Save As); recovery is parked. Start with [`FILE_LIFECYCLE.md`](../docs/design/FILE_LIFECYCLE.md) and [`RECOVERY.md`](../docs/design/RECOVERY.md).
5. The retained `../docs/design/IMPLEMENTATION_FOUNDATION.md` only for unchanged API or editor/no-slice details relevant to the task. Its dated dependency inventory is not current evidence. Current failure records live in `../docs/agentic/failure_ledger.jsonl`.

Do not change a public export, DOM contract or render ordering without updating this index and the canonical specification in the same change. Keep branch work isolated; use merge commits, exact-head CI and latest-head independent review. Never claim an unavailable local, second-engine or live deployment check passed.

Current qualification: [editor follow-up checkpoint](../docs/design/2026-11-05-editor-followup-checkpoint.md). Earlier candidate counts belong to their dated source receipts.

## Product and flow

Local-first Markdown reader/editor and paginated PDF workspace for the web and experimental Windows app. The desktop continuous reader loads the shared workspace on demand. Open documents and latest-close recovery stay in memory; no automatic/app-managed document or session persistence is added. Settings and approved Pulseboard keys are the exceptions for persisted app-managed user state. The content-free SDK is reached only through `src/app/pulse.ts`; document content is never uploaded. Vector print is primary; raster PDF is the fallback. Save Markdown writes an explicit copy through the browser or native destination without adopting an original-file binding or clearing the dirty baseline. On Windows, owned Save/Save As (`src/desktop/main.ts` `saveDocument`, `documents.ts` `saveTarget`/`completeSave`, `src-tauri/src/commands/save.rs`, `replace.rs`) write in place per `docs/design/FILE_LIFECYCLE.md`.

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
| Reader shell: bar, tabs, More menu, palette, panel (Library, Outline), status (S3) | `src/desktop/shell/{tabs,menu,palette,panel,library-panel,status}.ts`, `src/desktop/shell/shell.css`, `desktop.html` | `tests/desktop-e2e/{shell,library}.spec.ts`, spec §14 |
| Windows continuous reader and lazy workspace handoff | `src/desktop/{main,documents,commands,panels,session,render,workspace,native}.ts`, `desktop.html`, `vite.desktop.config.ts` | `tests/desktop-{session,lifetime,foundations}.test.ts`, `tests/desktop-e2e/` (including bounded Undo recovery), spec §14; `docs/WINDOWS_DESKTOP.md` |
| Host contract (web parity W0): every platform call goes through one typed `Host` | `src/desktop/native.ts` (`Host`, result types, `native`), `src/desktop/hosts/tauri.ts` (`tauriHost`, the only `invoke` caller) | Desktop e2e against the shared in-memory IPC fake `tests/desktop-e2e/fakeHost.ts` (`installFakeHost`, `fakeCalls`); `docs/design/2026-11-13-complete-push.md` Track W |
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
| Actionable Markdown: parser, patches, glyphs, reader fields/chips (A1) | `src/render/{actionable,actionableGlyphs}.ts`, `src/desktop/reader/actionable.ts` | `tests/actionable.test.ts`, `tests/fixtures/actionable/`, `tests/desktop-e2e/actionable.spec.ts`, spec §14 |
| Templates: New from template, placeholder form (A4, #286, wired to the native read in #295) | `src/desktop/reader/template.ts` (pure: `templateFields`, `templateTitle`, `fillTemplate`), `src/desktop/shell/templates.ts` (`chooseTemplate`, `isTemplatePath`), `document.newFromTemplate` in `src/desktop/main.ts` (More menu and palette), `native.library.readTemplate` in `src/desktop/native.ts` | `tests/template.test.ts`, `tests/desktop-templates.test.ts` |
| Templates: native read-only template read (A4, #285; boundary change) | `src-tauri/src/library.rs` (`read_template`, `MAX_TEMPLATE_BYTES`), `src-tauri/src/commands/library.rs` (`library_read_template`), registered in `src-tauri/src/main.rs` | Rust unit tests in `library.rs` and `commands/library.rs`; `src-tauri/README.md` |
| Readable data: render-text seam for data documents (D3 webview, D4 webview #288) | `src/app/renderText.ts` (`renderTextOf`, `dataDocumentKind`, `dataLabelOf`, `prepareRenderText`), `src/data/`, callers in `src/desktop/main.ts` and `src/app/App.ts` | `tests/render-text.test.ts`, `tests/desktop-data-prepare.test.ts`, `tests/desktop-e2e/data.spec.ts`, `tests/e2e/data.spec.ts`, spec §14 |
| Readable data: pure conversion of JSON, JSON Lines, YAML, TOML, CSV/TSV and plain text to derived Markdown (D1, D2, D4, D6 layout) | `src/data/{index,types,json,lens,conversation,yaml,toml,csv,escape}.ts` | `tests/data{,-conversation,-escaping,-formats}.test.ts`, `tests/fixtures/data/` (`*.readable.md` goldens); `docs/design/READABLE_DATA.md` |
| Readable data: native open/save boundary for data and text files (D3 native, #272; D4 extensions #284 merged) | `src-tauri/src/file_policy.rs` (`DATA_EXTENSIONS`, `document_extension`), `export_policy.rs` (`ExportKind::Data`), `commands/save.rs` (`save_as_choice`), `assets.rs` (`is_markdown_target`) | Rust unit tests in those modules, `scripts/desktop-smoke.ps1` data step; `src-tauri/README.md` |
| Library lists agent data files; the scan skips `.claude/worktrees` (D5 scan, #290; boundary change) | `src-tauri/src/library.rs` (`is_agent_data`, `AGENT_FOLDERS`, `is_nested_checkouts`, scan sets `agent`) | Rust unit tests in `library.rs` (`scan_lists_agent_data_files_and_never_walks_nested_worktrees`) |
| Reader performance (S9 part 1, #294): tab switch reuses the rendered reader DOM; one batched sanitizer pass for code upgrades | `src/desktop/main.ts` (`keepRendered`, `reuseRendered`, `renderedState`), `src/desktop/render.ts` (`upgradeCode`, one `sanitizeRenderedHtml` pass over all blocks) | `tests/desktop-tab-reuse.test.ts` |
| Start-up first frame (S9 part 2, #297): the window's first paint uses the theme colour from a bundled stylesheet; `desktop.html` carries no inline style or script (Tauri hashes inline styles into the CSP, voiding `'unsafe-inline'` for Paged.js) | `src/desktop/first-frame.css`, `desktop.html` | `tests/desktop-csp.test.ts`, `tests/desktop-e2e/startup.spec.ts` |
| Actionable Markdown: native line-patch write-back (A2, #244; 1-based fix #268) | `src-tauri/src/linepatch.rs`, `src-tauri/src/commands/patch.rs` (`patch_document`), webview side `src/desktop/reader/writeback.ts` | Rust unit tests in both modules, shared fixtures `tests/fixtures/actionable/` (also read by `tests/actionable.test.ts` and `tests/desktop-e2e/actionable.spec.ts`), native smoke step in `scripts/desktop-smoke.ps1` (#275); `docs/design/ACTIONABLE_MARKDOWN.md` |
| Edit surface: source beside the reader, patch-mode render, caret follow (S5) | `src/desktop/edit.ts`, `src/desktop/main.ts` (`setEditing`, `editInput`, `render(…, patch)`), `src/desktop/reader/patch.ts`, `src/styles/editor.css` | `tests/desktop-e2e/edit.spec.ts`, `tests/reader-patch.test.ts`, spec §14 |
| Actionable Markdown interaction and write-back (A3) | `src/desktop/reader/{controls,writeback}.ts`, wiring in `src/desktop/main.ts` | `tests/actionable-writeback.test.ts`, `tests/desktop-actionable-save.test.ts`, `tests/desktop-e2e/actionable.spec.ts` |
| Reader text-first paint and block patching | `src/desktop/render.ts`, `src/desktop/reader/patch.ts` | `tests/desktop-e2e/text-first.spec.ts`, `tests/reader-patch.test.ts`, spec §14 |
| Data copy menu (value, JSONPath, jq, subtree), data-document copy reference, Save readable view as Markdown (D5, #299) | `src/desktop/reader/dataCopy.ts` (`dataCopy`, `dataReference`, `readableCopy`, `pathAt`, `trackDataTarget`); commands `data.copy.*` and `document.saveReadable` in `src/desktop/main.ts`; `MenuEntry.hidden` in `src/desktop/shell/menu.ts` | `tests/desktop-data-copy.test.ts`, `tests/desktop-e2e/data-copy.spec.ts`, spec READABLE_DATA.md "Copy" |
| Reader source map (`data-src`) and copy toolkit | `src/desktop/reader/{sourcemap,copy}.ts`, `src/desktop/render.ts` | `tests/reader-sourcemap.test.ts`, `tests/desktop-e2e/copy.spec.ts`, spec §14 |
| Front matter blanking, tolerant YAML reader, lint; reader Properties card | `src/render/frontmatter.ts`, `src/desktop/reader/frontmatter.ts` | `tests/frontmatter.test.ts`, `tests/desktop-e2e/frontmatter.spec.ts`, spec §3 |
| Fine-grained Shiki + curated grammars | `src/render/highlight.ts` | `tests/highlight.test.ts` |
| Mermaid preparation and graceful failure | `src/render/mermaid.ts` | `tests/mermaid.test.ts` |
| TOC placement, unique float identity, source preparation | `src/render/buildSource.ts` | `tests/buildSource.test.ts`, `tests/footnote-targets.test.ts` |
| Generated footnote destinations after preview | `src/paginate/footnoteLinks.ts` | `tests/footnote-targets.test.ts`, `tests/e2e/footnote-targets.spec.ts` |
| Paged.js lifecycle, handlers, CSS, in-context measurement, shrink (Tier 3) and split (Tier 4) tiers, completeness audit and recovery | `src/paginate/{paginate,handler,cssBuilder,measure,shrinkToFit}.ts` | `tests/paginate-completeness.test.ts`, `tests/e2e/nocutoff.spec.ts`, `tests/e2e/pagination-completeness.spec.ts` |
| Vector / raster PDF | `src/export/{print,download,footnoteMarkers}.ts` | `tests/export-download.test.ts`, `tests/raster-{content-clone,styles-ready,footnote-markers}.test.ts`, `tests/e2e/export.spec.ts`, `tests/e2e/raster-resolution.spec.ts` (preview isolation), `tests/e2e/raster-{visual,footnotes,styles-ready}.spec.ts` (saved pixels, CSS delay/failure recovery and damage controls); spec §§5,10 and `docs/PDF_VISUAL_REGRESSION.md` |
| Offline raster capture document and CSS ownership | `src/export/offlineCapture.ts`, `src/export/download.ts` | `tests/raster-offline-capture.test.ts`, `tests/e2e/raster-offline-frame.spec.ts`, existing saved-PDF pixels and real CSS/font cache-loss/no-save/retry in `tests/e2e/raster-{visual,styles-ready,fonts-ready}.spec.ts`; spec §§5,6,10; `docs/design/RASTER_OFFLINE_CAPTURE.md` |
| Export progress and outcomes in every workspace view | `src/ui/ExportStatus.ts`, `src/app/App.ts`, `src/export/download.ts` | `tests/export-status.test.ts`, export-lifetime/download tests, `tests/e2e/export-status.spec.ts`, `tests/e2e/export-cancel.spec.ts` (#201 cancellation: `App.cancelPdfExport`, `FallbackPdfOptions.signal`, `ExportCanceled`); spec §§5,7, `docs/design/EXPORT_STATUS.md`, `RASTER_OFFLINE_CAPTURE.md` |
| Exact source download and filename | `src/export/markdown.ts` | `tests/markdown-download.test.ts`, `tests/e2e/workspace-design.spec.ts` |
| Local Open/Save and optional desktop New keyboard adapter and hint | `src/ui/DocumentShortcuts.ts`, `src/main.ts` | `tests/document-shortcuts.test.ts`, `tests/e2e/document-shortcuts.spec.ts`; spec §§6-8 |
| Action hierarchy, layout disclosure, source-save UI | `src/ui/Toolbar.ts`, `src/styles/workspace.css` | Workspace and existing export/editor E2E |
| Preview zoom envelope, horizontal reach, pinned feedback | `src/ui/Canvas.ts`, `src/styles/{preview,workspace}.css` | `tests/e2e/workspace-design.spec.ts` and canvas E2E |
| Textarea/backdrop, native editing/ownership, split layout | `src/ui/{Editor,Splitter}.ts`, `src/styles/editor.css` | Editor/splitter unit and `tests/e2e/editor.spec.ts`; `chrome-heading-scope.spec.ts` protects authored chrome-named headings, print and parked-canvas layout |
| Guarded Markdown writing commands | `src/ui/{MarkdownCommands,EditorFormatting,Editor}.ts`, `src/styles/editor.css` | Command/formatting units, `tests/e2e/editor-formatting.spec.ts`; native one-step Undo, final-selection ownership and compact disclosure; spec §12 and `docs/design/MARKDOWN_COMMANDS.md` |
| Session positions and keyboard document navigation | `src/app/positions.ts`, `src/ui/DocumentNavigation.ts`, store/editor/desktop session seams | Position/navigation units and both `session-navigation.spec.ts` production suites; bounded ID ownership, fresh undo hosts and reader/workspace transfer; spec §§7,9,12 and `docs/design/SESSION_NAVIGATION.md` |
| Empty state, warnings, error feedback | `src/ui/{EmptyState,Banner}.ts`, `src/app/App.ts` | `tests/app-ingestion-notices.test.ts`, `tests/app-export-lifetime.test.ts`, `tests/e2e/{empty-error,raster-styles-ready}.spec.ts`; spec §7 pins independent notice/warning lifetimes and visible, recoverable fatal feedback |
| Offline precache and worker policy | `vite.config.ts`, `src/main.ts`, `src/styles/pwa.css` | PWA tests; operator gates still apply |
| Patched transitive dependencies and supported Node floor | `package.json`, `package-lock.json` | `tests/dependency-security.test.ts` checks the wrapper-resolved KaTeX trust boundary and encoded-host normalization; spec §2 |
| Bounded native smoke worker startup | `scripts/desktop-smoke.ps1`, `scripts/lib/desktop-probe-wait.ps1` | `scripts/test-desktop-probe-wait.ps1` runs in the existing Windows smoke; bootstrap and UI-operation budgets remain capped by action/overall deadlines; `docs/design/NATIVE_SMOKE_BOOTSTRAP.md` |
| Required verification and browser artifacts | `.github/workflows/ci.yml` | Node 24 verification and production Chromium; retained Node 22 compatibility probe |
| Second-engine authoring and accessibility | `playwright.authoring.config.ts`, `.github/workflows/ci.yml`, `src/styles/editor.css` | Production Firefox plus both `authoring-accessibility.spec.ts` suites; actual undo/focus, forced-colors Find outline, native source paint and short reflow; `docs/design/AUTHORING_QUALITY.md`; AI-6/#169 remain open |

## New or changed public seams

```typescript
// Existing RenderScheduler additionally owns the host for the awaited task.
withRenderLock<T>(task: () => Promise<T>): Promise<T>;
// Never call flush from inside a lease. Pending preparation and later close are serialized.

// src/paginate/footnoteLinks.ts
repairFootnoteLinks(host: ParentNode): void;
// Called inside paginate after awaited Previewer.preview; only citation hrefs change.

// src/paginate/paginate.ts — signature unchanged; the result and failure widen.
paginate(source: DocumentFragment, css: string, host: HTMLElement): Promise<PaginatedFlow>;
interface PaginatedFlow extends PagedFlow { recoveredSplits?: string[] } // set only after a recovery run
class PaginationIncompleteError extends Error {} // thrown after teardown; App shows the fatal state
auditPagination(source: ParentNode, host: HTMLElement): PaginationProblem | null;

// src/paginate/shrinkToFit.ts (afterParsed, in order)
recordSourceHeights(content: ParentNode, area: PageArea): void; // in-context, batched
shrinkToFit(content: ParentNode, area: PageArea): void;          // Tier 3
markOverTallSplittable(content: ParentNode, area: PageArea): void; // Tier 4 -> data-mdv-splittable

// src/paginate/handler.ts (filter hook)
restoreDisplayedElements(content: ParentNode): void; // undo Paged.js marking inline-styled elements hidden

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

Screen import order is app, editor, preview, document, workspace, print, shiki, pwa. Never use CSS `zoom` for the preview scale or change natural page dimensions; the preview scale is a paint-only transform, and `paginate` lays out at `--preview-zoom: 1` because Paged.js is not scale-invariant. The one CSS `zoom` is the Tier 3 shrink: a constant per block, applied before layout (`shrinkToFit.ts`), so preview and export lay out the same geometry. Outer scroll sizing is removed before pagination and reset in print. Full-size sheets must remain horizontally reachable on narrow screens.

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


## Readable data (`src/data/`, D1 to D4 and D6)

Pure and DOM-free: a data document's raw text becomes derived Markdown that the existing reader,
Edit preview and PDF workspace render unchanged. Contract: `docs/design/READABLE_DATA.md`.
The document keeps its raw text; Edit shows it and Save writes it byte for byte.

```typescript
// src/data/index.ts (re-exports DataKind, Problem, Readable, ReadableOptions from types.ts)
prepare(kind: DataKind): Promise<void>;                 // loads the lazy YAML reader; await before toReadable(…, "yaml")
dataKindOf(fileName: string): DataKind | null;          // by extension: json/jsonc, jsonl/ndjson, yaml/yml, toml, csv/tsv, txt/log
toReadable(text: string, kind: DataKind, options?: ReadableOptions): Readable; // { markdown, problems, truncated, map }

// src/data/json.ts: source-preserving parser, numbers stay lexemes
parseJson(text: string, comments?: boolean, lineOffset?: number): ParseResult;
type JsonValue; type ParseResult;                       // the tree every format is normalised to

// src/data/lens.ts: the generic lens (tables, sections, records, hints, budgets)
class Lens { line(text?, path?); render(value, path?, level?, indent?, key?); count(value); take(n?); finish(); readonly map }
Lens.recordTable(items): RecordTable | undefined;       // D6: one schema pass; columns, `flatten` for one level of nested objects
Lens.renderTable(rows, plan, path?, level?, indent?, lineColumn?, charged?): void; // record table; `lineColumn` adds a Line column (JSON Lines)
childPath(path: string, key: string): string;           // JSONPath-style child path
hint(value: JsonValue, key: string, timeZone: string): string; shape(value: JsonValue): string;
budget(value: number | undefined, fallback: number): number; count(n: number, noun: string): string;

// src/data/conversation.ts: the conversation lens for chat and agent transcripts (D2)
isConversation(records): boolean; conversationList(value): ArrayValue | undefined;
conversationOverview(lens, records): void; conversationRecord(lens, value, path, index, bad?): void;
renderConversation(lens, root, list): void;

// src/data/{yaml,toml,csv}.ts (D4): parse to JsonValue plus problems
prepareYaml(): Promise<void>; parseYaml(text: string): YamlResult;   // lazy `yaml` package; throws if not prepared
parseToml(text: string): ParseResult;
parseCsv(text: string, delimiter?: string): CsvResult;               // RFC 4180; TSV passes "\t"

// src/data/escape.ts: keep data from becoming Markdown or HTML
escapeText(text: string): string; cellText(text: string): string; fence(text: string): string;

// src/app/renderText.ts: the one seam the reader, Edit preview and PDF workspace share
renderTextOf(name: string, text: string): RenderText;   // { text, data: DataView | null }; Markdown passes through
dataDocumentKind(fileName: string): DataKind | null;    // null for Markdown and for kinds not yet in OPENABLE
dataLabelOf(fileName: string): string | null;           // status-line format name
showMoreOf(name: string): void; showAllOf(name: string): void;       // per-document budget scale, memory only
```

`OPENABLE` in `renderText.ts` is `json`, `jsonl`, `text`, `yaml`, `toml` and `csv` (TSV is the `csv` kind): every
format `src/data/` reads opens as a readable view. `prepareRenderText(name)` awaits `prepare(kind)` before a
render path derives a view, so the lazy YAML parser is loaded first (D4 webview, #288). Relative links
open Markdown only (#283): `assets.rs` `is_markdown_target`. Native side: `file_policy.rs`
`DATA_EXTENSIONS` (`json`, `jsonc`, `jsonl`, `ndjson`, `txt`, `log`, `yaml`, `yml`, `toml`, `csv`, `tsv`) and
`document_extension(name)` are the one list the open checks, the Open dialog filter (`commands/open.rs`),
Save Copy (`commands/export.rs`) and Save As read;
`export_policy.rs` `ExportKind::Data` admits those names under the Markdown text rules (UTF-8, no NUL, 128 MiB cap);
`commands/save.rs` `save_as_choice(name)` keeps a data document's own extension first in Save As
and falls back to Markdown for anything else.

Layout (D6, #293), in `lens.ts`: an object puts its row-sized members (a scalar, or at most four scalars, or at most
eight short list items, under 80 characters) inline in one `Key | Value` table and gives anything larger a section;
a small list of scalars is one inline line. A list of objects with a common shape becomes a record table
(`recordTable`/`renderTable`): one column per key, one level of nested objects flattened to `parent.child`
columns, numeric columns right-aligned, and for JSON Lines a leading **Line** column holding the source line. A
detail section (`line 3: message`, or `2: field`) follows the table
only where the cell cannot show the value well: JSON embedded in a string, clearly Markdown text, or a prose key
(`description`, `content`, `text`, `message`...) holding a line break or more than 160 characters.

**D5, pure part (#289, merged):** `src/data/copy.ts`: `valueAt(text, kind, path, fileName?)` re-parses and walks a
`Readable.map` path (a table row's path returns the whole record), `copyValue` (scalars as written), `subtreeJson`
(pretty JSON, source numbers kept), `pathForms(path, kind)` (JSONPath, jq with `jqSlurp` for JSON Lines); tests in
`tests/data-copy.test.ts`. The webview copy menu and Save readable view as Markdown (#299) are in
`src/desktop/reader/dataCopy.ts`: the reader's selection resolves to a `data-src` line, `Readable.map` gives its path. The native half
of D5, agent data files in the Library, is merged (#290; see the table above).

## Actionable Markdown (A1 to A3)

Contract: `docs/design/ACTIONABLE_MARKDOWN.md`. The parser is pure; the reader and the native host
share its 1-based line numbering and the fixtures in `tests/fixtures/actionable/` (`*.md` with
`*.items.json` and `*.patches.json`).

```typescript
// src/render/actionable.ts
parseActionable(text: string, tokens?: readonly Token[]): ActionableDocument; // { controls, cycle, version, problems }
planChange(text: string, document: ActionableDocument, control: Control, action: ControlAction): LinePatch[];
applyPatches(text: string, patches: readonly LinePatch[]): string;   // in-memory path (web build, unsaved edits)
inversePatches(patches: readonly LinePatch[]): LinePatch[];          // Undo
relocate(text: string, previous: Control, previousLine: string): { document; control } | null; // re-derive after an outside change
nextMark(state: Mark, cycle: readonly Mark[]): Mark | null; nextOption(value: string, options: readonly string[]): string;
spanValue(control: Control): string; splitLines(text: string): { bom; lines; eols };
MARKS, MARK_LABELS, SUPPORTED_VERSION; types Mark, Control, ControlAction, LinePatch, ActionableDocument

// src/render/actionableGlyphs.ts
actionableGlyphs(md: MarkdownIt): void;                              // static glyphs for marks and choices

// src/desktop/reader/actionable.ts: reader-only rendering of fields and status chips
markFields(tokens, actionable, TokenCtor): void; chipRow(actionable): HTMLElement | null;

// src/desktop/reader/controls.ts: DOM decoration, click/keyboard/menu gestures
decorateControls(root: HTMLElement, actionable: ActionableDocument): void;
setControlHandler(next: ControlHandler | null): void; controlHandler(): ControlHandler | null;

// src/desktop/reader/writeback.ts: A3 write-back and Undo notice
createWriteback(deps: WritebackDeps): { change(control, action): Promise<void>; checkOverwritten(doc): void; forget(): void; settled(): Promise<void> };
```

Native: `src-tauri/src/linepatch.rs` (`Patch { line (1-based), id, expect, replace }`,
`MAX_PATCHES` 256, `MAX_LINE_CHARS` 65,536) splits the raw bytes (UTF-8, UTF-16 LE/BE after a
BOM) into lines, keeps the BOM, every terminator and the final-terminator state, and changes only
placed line content. `commands/patch.rs` `patch_document(token, patches)` reads, places and commits
through the conflict-safe replace and returns `PatchResult` (`saved { generation, text }`,
`unplaced { index, text }`, `failed { code }`); the webview sends a document token, never a path.
Line numbers are 1-based on both sides (#266, fixed in #268; native smoke #275 proves toggle and
Undo against exact CRLF bytes). Templates (A4): the native `library_read_template` (#285), the picker and command (#286) and their wiring (#295) are merged:
"New from template…" (More menu and palette) reads a `templates/` file of a pinned project and opens the filled text as an
untitled note in Edit. A5 (embeddable element, #300) is later.

## Desktop foundations (companion push S0)

`src/desktop/documents.ts` `DesktopDocuments` is the one ownership map for open
documents across reading and the PDF workspace: `reader` (the bounded
`ReaderSession`), `baselines` (DocStore id → `WorkspaceBaseline` with the clean
source, stable `key` and optional `binding`) and `workspace` (the mounted App).
Every handoff goes through `adoptReaderInto`, `releaseReader`, `readerSnapshot`
and `returnToReader`; admission and dirty checks through `admitToWorkspace`,
`addBatch`, `workspaceDirty`, `hasUnsavedWork` and `list()`. Each reader
document carries a `key` (from `session.ts` `nextDocumentKey`) and, for
host-opened files with a token, a display-only `Binding {token, path, dir,
encoding, eol, disk, generation}`. Save reads it (`saveTarget`, `completeSave`);
closing releases it through `onRelease` (never during a mode transition). Live reload:
`src-tauri/src/watch.rs` + `commands/reload.rs` (`read_document`), frontend
`byToken`/`markDisk`/`applyReload` and `main.ts` `followChange`; tests
`tests/desktop-live-reload.test.ts`. Links/images: `src-tauri/src/{assets.rs,commands/links.rs}`, `main.ts`
`followRelativeLink`/`loadLocalImages`/back-forward, sanitizer `data-local-src`; tests
`tests/desktop-links.test.ts`. Library: `src-tauri/src/{library.rs,commands/library.rs}`,
`src/desktop/library.ts` (`openLibraryEntry`), `native.library.*`; tests in `library.rs` and
`tests/desktop-library.test.ts`. `src/desktop/commands.ts` `registerCommand({id, title, keys?, enabled?, run})`
is the single action registry: `installShortcuts(window, active)` dispatches `Mod+…`
keys (exact modifiers; a match is always claimed, even repeated or disabled),
`listCommands`/`runCommand` serve a palette or menu. `src/desktop/panels.ts`
`registerPanel({id, title, mount})` lists side panels for the shell. Unit
coverage: `tests/desktop-foundations.test.ts`.

## Desktop New document

`src/desktop/main.ts` owns creation from reader/empty/workspace controls and
Ctrl/Cmd+N; from the reader, New opens the note in Edit (S5). `src/desktop/session.ts` exports
`nextUntitledName(docs: readonly { name: string }[]): string` for case-insensitive
open-name collision avoidance. Desktop admits the empty source through current
count/UTF-8 limits, records a clean baseline, preserves existing sources and late
open selection ownership, then reveals/focuses the source. Mode transitions,
export and native save block creation. Reader startup stays lazy until New or
Export PDF…. `App.init` forwards optional `createDocument?: () => void` through
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
