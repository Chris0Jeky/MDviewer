# AGENT_INDEX

Current navigation map for MDviewer. Read the narrow owning seam before editing; do not skim unrelated rendering code to change toolbar behavior. The pre-integration index is retained in [AGENT_INDEX_BASELINE.md](AGENT_INDEX_BASELINE.md) for its detailed older symbol and fixture descriptions. This index and the canonical specification take precedence where behavior changed.

## Read order

1. `../CLAUDE.md` and `../AGENTS.md` for workflow and merge policy.
2. `../docs/design/IMPLEMENTATION_SPEC.md` for current contracts, especially sections 3, 5, 7, 9 and 12.
3. Its retained `IMPLEMENTATION_FOUNDATION.md` only for unchanged API or editor/no-slice details relevant to the task. Its dated dependency inventory is not current evidence.
4. `STATE.md`, `DECISIONS.md`, `FAILURE_PATTERNS.md`, then the owning source/tests below.

Do not change a public export, DOM contract or render ordering without updating this index and the canonical specification in the same change. Keep branch work isolated; use merge commits, exact-head CI and latest-head independent review. Never claim an unavailable local, second-engine or live deployment check passed.

## Product and flow

Local-first Markdown editor and paginated PDF preview. Only settings persist; no Markdown uploads. The only runtime request is the content-free Pulseboard SDK via `src/app/pulse.ts`. Vector print is primary; raster PDF is the fallback. The source-save action downloads exact current text without persisting it in the app.

```text
input / textarea → DocStore → serialized scheduler → App.runPipeline
 → highlighter + curated grammars → synchronous Markdown + KaTeX
 → build source / TOC / one float per footnote → Mermaid → stamp atomic identities
 → fonts/images → Paged.js preview → href-only footnote repair → completed snapshot

Export click → capture document id/name/text and settings NOW
 → scheduler.withRenderLock → prepare/reuse that captured input → print/capture
 → release host → queued edits/switches/closes catch up
```

## Ownership map

| Concern | Owning seam | Tests / contract |
| --- | --- | --- |
| App orchestration, captured export inputs, completed-render eligibility, update reload decision | `src/app/App.ts` | `tests/app-export-fence.test.ts`, `tests/app-export-lifetime.test.ts`; spec §§3,5,9 |
| Document memory and serialized/coalesced render-host leases | `src/app/state.ts` | `tests/state.test.ts`, `tests/render-lease.test.ts` |
| Settings migration, tokens, fonts, paper geometry | `src/app/settings.ts` | `tests/settings.test.ts`; spec §9 |
| Browser-chrome color per screen theme | `src/app/themeColor.ts` | `tests/theme-color.test.ts`, theme-color e2e; spec §7 |
| Input picker/drop/paste validation and sample | `src/app/input.ts`, `src/app/sampleDoc.ts` | `tests/input.test.ts` |
| Pulseboard SDK seam (content-free events, error shield) and locked artifact | `src/app/pulse.ts`, `public/pulseboard.js`, `observatory.lock.json`, `observatory/check.mjs` | `tests/pulse.test.ts`, `npm run agent:observatory:check`; spec §1 |
| DOM IDs/classes and factories | `src/app/dom.ts` | `tests/dom-contract.test.ts`; spec §8 |
| Native beforeunload and explicitly accepted reload | `src/app/reloadGuard.ts` | `tests/reload-guard.test.ts` |
| Recoverable activation/readiness/reload prompt | `src/ui/UpdatePrompt.ts`, `src/main.ts` | `tests/update-prompt.test.ts`; live AI-7 remains open |
| Markdown, sanitization, warnings, anchors | `src/render/markdown.ts`, `src/render/sanitize.ts` | Markdown and sanitizer tests |
| Fine-grained Shiki + curated grammars | `src/render/highlight.ts` | `tests/highlight.test.ts` |
| Mermaid preparation and graceful failure | `src/render/mermaid.ts` | `tests/mermaid.test.ts` |
| TOC placement, unique float identity, source preparation | `src/render/buildSource.ts` | `tests/buildSource.test.ts`, `tests/footnote-targets.test.ts` |
| Generated footnote destinations after preview | `src/paginate/footnoteLinks.ts` | `tests/footnote-targets.test.ts`, `tests/e2e/footnote-targets.spec.ts` |
| Paged.js lifecycle, handlers, CSS, measurement and shrink tiers | `src/paginate/{paginate,handler,cssBuilder,measure,shrinkToFit}.ts` | Unit pagination tests, `tests/e2e/nocutoff.spec.ts` |
| Vector / raster PDF | `src/export/{print,download}.ts` | `tests/export-download.test.ts`, `tests/e2e/export.spec.ts` |
| Exact source download and filename | `src/export/markdown.ts` | `tests/markdown-download.test.ts`, `tests/e2e/workspace-design.spec.ts` |
| Local Open/Save keyboard adapter and hint | `src/ui/DocumentShortcuts.ts`, `src/main.ts` | `tests/document-shortcuts.test.ts`, `tests/e2e/document-shortcuts.spec.ts`; spec §§6-8 |
| Action hierarchy, layout disclosure, source-save UI | `src/ui/Toolbar.ts`, `src/styles/workspace.css` | Workspace and existing export/editor E2E |
| Preview zoom envelope, horizontal reach, pinned feedback | `src/ui/Canvas.ts`, `src/styles/{preview,workspace}.css` | `tests/e2e/workspace-design.spec.ts` and canvas E2E |
| Textarea/backdrop, native editing, split layout | `src/ui/{Editor,Splitter}.ts`, `src/styles/editor.css` | Editor/splitter unit and `tests/e2e/editor.spec.ts` |
| Empty state, warnings, error feedback | `src/ui/{EmptyState,Banner}.ts` | `tests/e2e/empty-error.spec.ts` |
| Offline precache and worker policy | `vite.config.ts`, `src/main.ts`, `src/styles/pwa.css` | PWA tests; operator gates still apply |
| Required verification and browser artifacts | `.github/workflows/ci.yml` | Node 22/24 verification and production Chromium |

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
downloadMarkdown(name: string, text: string): void;

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

Capture export input before queueing, not when a queued render eventually starts. Keep the host leased until capture/print settles; do not teardown it on an intervening close. New failed preparation invalidates export eligibility even if old pages stay visible. Stable input matching avoids unnecessary repagination when the requested document is already current.

Source footnote IDs must avoid headings and suffix collisions. Repeated citations share one float; post-preview repair uses Paged.js `data-id` to generated-note mapping and leaves unrelated links alone.

Screen import order is app, editor, preview, document, workspace, print, shiki, pwa. Never use CSS `zoom` or change natural page dimensions. Outer scroll sizing is removed before pagination and reset in print. Full-size sheets must remain horizontally reachable on narrow screens.

The PDF action classes identify PDF actions only; source Open/Save use `workspaceAction`. Keep filename visible for one document and source bytes exact. Disclosure Escape returns focus and preserves settings.

Document shortcuts call the existing direct `button.workspace-action` controls in `.workspace-actions` and `.workspace-session`, not a new download/ingestion path. The session `.workspace-privacy` hosts the visible `.workspace-shortcuts` hint. Respect handled/IME/Alt/Shift/combined-modifier events; prevent matched disabled or repeated keys without clicking. Detached workspaces are inert. Main owns installation and HMR disposal; all original button attributes are restored on teardown. Saving source never persists it in the app or removes unload protection.

UpdatePrompt readiness is not reload consent. `onNeedReload` suppresses the plugin's automatic navigation. App rejects reload during export; current work is checked immediately before an explicitly accepted navigation. Cancellation, dismissal, rejection and timeout must leave usable controls and navigation protection.

## Validation and handoff

Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run agent:observatory:check`, `npm run build`, then production Playwright (`E2E_TARGET=preview`). The required workflow runs supported Node 22 and 24 plus Chromium. Inspect exact-head job results and actual failure artifacts. Independent review findings require evidence-backed fixes, not just green CI.

No-slice, vector/raster export, source-download bytes, phone layout and print reset are real-browser assertions. An isolated stub-App/placeholder-sheet probe is only component evidence. Keep AI-6 second-engine/manual-feel and AI-7 live/PWA operator work open. #62 archive provenance is closed by the `MDVIEWER_SOURCE_ID` build labelling; runtime fixes alone never closed it. #59's contradictory historical deployment receipts still need reconciliation. Record remaining gates and actual commit/run identifiers in handoffs.

## Latest-close recovery seam

`src/ui/DocumentRecovery.ts`, mounted and destroyed by `src/ui/Toolbar.ts`, owns a single memory-only closed-document snapshot. See canonical specification section 13. Signature:

```typescript
export interface DocumentRecoveryController { closeActive(): void; destroy(): void; }
export function mountDocumentRecovery(
  root: HTMLElement,
  store: DocStore,
  returnFocus: () => void,
): DocumentRecoveryController;
```

Toolbar Close delegates to `closeActive`; Undo consumes the copied name/text and calls the existing `DocStore.add` with a fresh identity. Existing App store listeners continue to own rendering/export coordination. A later real close replaces recovery. Discard and toolbar teardown clear it and the displayed filename/title. Nothing persists, no timer/global listener is added, and reload/tab close loses recovery. Closed content is not an open document for navigation protection.

Screen-only `.document-recovery` and its status/name/action/hint classes live in `workspace.css`, with explicit hidden/print handling. Do not reuse `.workspace-action` for these buttons or break the unique keyboard Open/Save selectors. Close focuses Undo; completion returns focus to an appropriate visible editor/document/Open control without changing view mode. Unit coverage: `tests/document-recovery.test.ts`; production geometry, exact source, multi-document, discard and focus: `tests/e2e/undo-close*.spec.ts`.
