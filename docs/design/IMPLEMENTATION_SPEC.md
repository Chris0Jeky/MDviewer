# MDviewer implementation specification (canonical)

This file owns the current render, export, workspace and navigation contracts. Change code and this specification together. The detailed pre-workspace specification is retained **byte-for-byte** in [IMPLEMENTATION_FOUNDATION.md](IMPLEMENTATION_FOUNDATION.md), including its original title. It is a retained foundation, not a competing current specification: its unchanged module signatures, no-slice mechanics and editor details are incorporated here; the explicit replacements and additions below take precedence. Its dependency inventory is historical, not a current installation claim.

Companions: [Product vision](../PRODUCT_VISION.md), [Architecture](../ARCHITECTURE.md), [Agent index](../../autodoc/AGENT_INDEX.md), [Workspace refresh](WORKSPACE_REFRESH.md), [Export/update lifetime](EXPORT_UPDATE_LIFETIME.md).

## 1. What MDviewer is

A browser-based, local-first Markdown editor and PDF preview/export tool for research and technical documents. Documents arrive through file picker, drop, paste or direct editing. Document content stays in memory. Only settings persist. No upload, document persistence, runtime telemetry, remote conversion or new runtime request is permitted.

The product invariant remains page-break-safe output: keep normal-size code blocks, figures, tables and callouts intact; use the foundation's explicit graceful-split/shrink/forced-split tiers for genuinely oversize content. Both PDF paths consume the same prepared page DOM.

## 2. Dependency authority

`package.json` and `package-lock.json` at the checked-out commit are authoritative. The foundation's dated August inventory is retained historical evidence, not a version prescription. Do not infer a successful installation, advisory clearance or supported engine from it. Use the declared engines and exact-head Node 22/24 CI. Preserve the fine-grained Shiki imports, aligned Shiki siblings, markdown-it 15 named class type, ambient Paged.js types and jsPDF image/page/save API described in foundation section 2.

## 3. The load-bearing render order (NEVER reorder)

```text
0  capture raw Markdown and settings for this render
1  await getHighlighter()
1b await ensureMarkdownLanguages(hl, src)
2  createMarkdown + synchronous renderMarkdown (Shiki and KaTeX)
3  buildPaginationSource (TOC and inline footnote transformation)
4  await renderAllMermaid(source, 'default')
4b stampAtomicBlocks(source)
5  await awaitFontsAndImages(source)
6  retain fully prepared source
7  registerHandlersOnce; await paginate(source, css, host)
   inside paginate: await Previewer.preview; repairFootnoteLinks(host); return flow
```

The final link repair changes **href attributes only**, after Paged.js has generated destinations. It is not another layout pass and must never change geometry. All height-affecting work still precedes the single pagination call. Paged.js handlers remain globally registered once; a fresh Previewer is used per run, and stylesheet Blob URLs are revoked in `finally`.

Reflow keys are `codeTheme`, `docFont`, `fontSizePt`, `paperSize`, `margins`, `showToc`, `showPageNumbers`, `titlePage`, `runningHeader`, `showLineNumbers`. Screen theme, zoom, view mode and split ratio are screen-only. Content debounce remains 250 ms and settings debounce 120 ms. Rendering is serialized, not merely debounced.

## 4. No-slice, TOC and footnote identity

Foundation section 4 remains the detailed no-slice contract: `break-inside: avoid`, keep-with-next headings, orphans/widows, repeated table headers, decoration cloning and the 1.15 shrink threshold. Do not shrink reflowing tables or use a second pagination engine. Paged.js-only declarations (`float: footnote`, `target-counter`, `leader`, `string-set`, `@footnote`, `@page`) belong in `buildStylesheet`, not merely global CSS. Footnote area typography must survive relocation outside `.doc`.

**Replacement for the foundation's `li` listing:** list items are NOT keep-whole atomic blocks. `print.css` gives `li` the same `orphans: 3; widows: 3` clean-split protection as paragraphs and no `break-inside: avoid`: a long checklist item that does not fit the remaining space fragments instead of pushing itself whole onto the next page and leaving the sheet mostly blank (2026-09-26 checklist report: a 610-line todo list paginated four non-last pages over one-third blank, worst 76%; after the change the worst non-last page is 4% and the document shrank from 20 pages to 16). `ATOMIC_BLOCK_SELECTOR` (`src/render/buildSource.ts`) excludes `li` for the same reason — stamping would assert a keep-whole promise the fragmenter no longer makes — while atomics nested inside an item (`pre`, `table`, `figure`, callouts) keep their own rules and stamps. `blockquote` stays keep-whole as the foundation lists it. Cover: `tests/e2e/list-flow.spec.ts` over `tests/fixtures/checklist.md`.

An author-placed `[[toc]]` stays in place; a synthesized TOC follows the first h1, or starts the document when no h1 exists.

`transformFootnotesToInline` allocates one retained float per note. It preserves the original ID unless occupied outside the removed endnote section, then allocates a collision-free `-footnote-N` suffix. Every citation, including repeats, is rewritten before the single-float guard. Never rename a heading to make room for a note.

Paged.js replaces a floated note's ID and retains its source identity in `data-id`. `repairFootnoteLinks` maps `[data-footnote-marker][data-id][id]` back to those generated destinations. Only citation hrefs change; generated IDs, unrelated links, unmatched references, page geometry and counters stay untouched. The repair is idempotent.

## 5. Export ownership and source saving

Vector `exportViaPrint` remains primary. Raster `exportPaginatedToPdf` remains a best-effort fallback, one canvas per existing page. Keep print sheets dark-on-white, html2canvas logging disabled, and task checkbox pseudo-elements off form controls. Foundation section 5's rendering constraints still apply.

**Replacement for the old flush-only export contract:** each public export captures `{ doc: copy of id/name/text or null, settings: copy }` synchronously when requested, before joining the queue. `withRenderLock` flushes pending preparation and owns the host until the entire export settles. Later renders, switches and closes queue behind it. Each lease seals the coalescing batch so later requests cannot cancel preparation on its earlier side.

Inside the lease, App compares the completed snapshot's id, name, text and reflow settings to the captured input. A matching snapshot is reused. Otherwise App runs the exact captured input through the normal pipeline under the lease. It must not re-read mutable editor input as the export request. Successful pagination publishes the exportable snapshot. Starting newer preparation invalidates that eligibility; retained older pages can remain readable after failure but cannot masquerade as current output. Both export paths release ownership on success or failure. Do not call scheduler flush from inside a lease.

Closing the final document calls `teardownPagination`, removing injected Paged.js styles and sheets. A close during export is processed after capture finishes.

`downloadMarkdown` is a separate source download, not PDF rendering or persistence. It downloads the exact current text with a portable Markdown filename, removes its transient anchor and revokes its Blob URL after download initiation. It never marks the in-memory session durably saved or disables navigation protection.

## 6. File tree and ownership

The foundation section 6 tree remains the map for unchanged modules. These current seams are added:

| Path | Owner and responsibility |
| --- | --- |
| `src/paginate/footnoteLinks.ts` | Generated destination repair, called only after preview resolves |
| `src/export/markdown.ts` | Exact source download and portable filename |
| `src/app/reloadGuard.ts` | Native navigation guard and one explicitly accepted update reload |
| `src/ui/UpdatePrompt.ts` | Recoverable activation/readiness/reload presentation state |
| `src/ui/DocumentShortcuts.ts` | Ctrl/Cmd+O and Ctrl/Cmd+S adapter over the existing document buttons |
| `src/styles/workspace.css` | Screen toolbar hierarchy, disclosure, session row and preview envelope |

`App.ts` remains the only render/export orchestrator. `state.ts` owns the scheduler lease. `main.ts` connects the service-worker plugin and native readiness notifications to UpdatePrompt and App's reload decision, and mounts document keyboard shortcuts after the toolbar exists. UI modules do not paginate directly.

## 7. Module API (pinned signatures)

Unchanged exports retain the signatures in foundation section 7 and its section 12 workspace additions. The following are the current additions/replacements. `Settings`, `Doc`, `App` and imported library types mean their actual project types.

```typescript
// src/app/state.ts: adds to the existing scheduler surface
export interface RenderScheduler {
  schedule(reason: RenderReason): void;
  flush(): Promise<void>;
  withRenderLock<T>(task: () => Promise<T>): Promise<T>;
  readonly isPending: boolean;
}

// src/paginate/footnoteLinks.ts
export function repairFootnoteLinks(host: ParentNode): void;

// src/export/markdown.ts
export function markdownFilename(name: string): string;
export function downloadMarkdown(name: string, text: string): void;

// src/app/reloadGuard.ts
export interface ReloadGuard {
  tryReload(): boolean;
  destroy(): void;
}
// ReloadActions is module-private; this structural shape documents the optional seam.
export function installReloadGuard(
  hasWork: () => boolean,
  actions?: { confirm(message: string): boolean; reload(): void },
): ReloadGuard;

// src/ui/UpdatePrompt.ts
export interface UpdatePromptController {
  notifyReady(): void;
  destroy(): void;
}
export interface UpdatePromptOptions {
  applyUpdate(): void | Promise<void>;
  requestReload(): boolean;
  activationTarget?: EventTarget;
  onDismiss?(): void;
}
export function mountUpdatePrompt(options: UpdatePromptOptions): UpdatePromptController;

// src/ui/DocumentShortcuts.ts: returns an idempotent teardown function
export function mountDocumentShortcuts(root: HTMLElement): () => void;

// src/app/themeColor.ts: browser chrome tracks the screen theme, never the PDF
export const THEME_COLORS: Record<ScreenTheme, string>;
export function themeColorFor(theme: ScreenTheme): string;
export function syncThemeColor(theme: ScreenTheme): void;

// src/app/App.ts: additional public method; other public signatures unchanged
// App.reloadForUpdate(): boolean
```

`paginate(source, css, host): Promise<PagedFlow>` retains its signature; it now calls `repairFootnoteLinks` between awaited preview and returning the flow. `CanvasController` signatures are unchanged. Snapshot capture and export preparation are private App details, not new global hooks.

## 8. DOM IDs and CSS cascade

Existing IDs and named contracts stay in `src/app/dom.ts`; Paged.js-owned names must never be renamed. `workspaceAction` distinguishes source Open/Save buttons from `exportPrimary` and `exportSecondary`, which remain PDF-only control identities.

Import order in `main.ts` is **app → editor → preview → document → workspace → print → shiki → pwa**. Workspace styles are chrome, not document typography. Print overrides the screen envelope, and the generated Paged.js stylesheet remains independent.

The primary toolbar row contains identity, Open, View, Screen and PDF actions. A native `details`/`summary` groups document formatting; it starts expanded on desktop and collapsed at widths up to 760 px. Escape closes it and returns focus to its summary without resetting settings. The local-session row explains the document lifetime and provides Save Markdown. The active filename is visible even with one document. Controls remain reachable at narrow widths: at widths up to 760px the primary row is a single-row horizontal strip (no wrap; swipe/focus scrolls controls into view) so the toolbar stays compact and the preview keeps its height. Cover: `tests/e2e/responsive-toolbar.spec.ts`.

`DocumentShortcuts` requires exactly one direct `button.workspace-action` in each of `.workspace-actions` (Open) and `.workspace-session` (Save), plus the session's `.workspace-privacy` hint host. Missing/ambiguous controls are an explicit mount error. Shortcuts call these existing buttons synchronously; they do not duplicate input/download logic. Ctrl/Cmd+O opens Markdown; Ctrl/Cmd+S downloads current source. A visible `.workspace-shortcuts` hint, button titles and `aria-keyshortcuts` expose both actions. Already-handled events, IME composition, Alt/Shift, unrelated keys and combined Ctrl+Meta remain untouched. Matched disabled/repeated events are prevented without clicking, so browser Save never downloads app HTML in the empty state. Teardown removes the listener/hint and restores attributes; detached roots are inert. `main.ts` owns the lifetime and registers HMR disposal. Tests: `tests/document-shortcuts.test.ts`, `tests/e2e/document-shortcuts.spec.ts`.

## 9. Persistence and navigation

Only settings persist under `mdviewer.settings.v1`; document bytes, source-download state and export snapshots remain in memory. Preserve validation/clamping for view mode, split ratio and title-page settings described in foundation sections 9 and 12. Preserve the pristine-sample exemption in `hasProtectableWork`; modifying the sample restores protection.

Worker activation and document reload are distinct. UpdatePrompt remains dismissible during activation; it recovers after failure or timeout. A cancelled reload can be retried without waiting for a second controllerchange. Dismissal removes owned listeners/timers and invalidates queued activation work. Plugin and native readiness converge idempotently; another tab's activation is not consent to reload this one.

`onNeedReload` explicitly suppresses vite-plugin-pwa 1.3's own reload because the legacy reloadPage argument is ignored. App refuses update reload during export. Otherwise ReloadGuard checks current work immediately before navigation and requires explicit confirmation when work would be lost. Positive confirmation bypasses native beforeunload for that single navigation only; the bypass expires and is cleared if navigation throws. Cancellation leaves normal protection armed. No document is silently persisted as part of this handoff.

## 10. Testing and evidence

Keep foundation section 10's unit/real-browser distinction. Added regressions cover note target uniqueness after actual pagination, heading collisions, queued edit/close export races, metadata consistency, stale-output refusal, lease failure recovery, one-shot navigation consent, update retries and late callbacks, exact Unicode source-download bytes, disclosure focus, narrow controls, zoom scroll extent, horizontal access and print reset.

Required checks remain Node 22 and 24 typecheck/lint/unit/build plus the production Chromium suite and Observatory guard. Browser artifacts are uploaded on both success and failure. Do not weaken no-slice or export assertions to make a UI change pass.

An isolated component probe is not a production-app test. A local dependency-install failure is not a successful suite. Validation applies to the exact tested head; integration needs its own checks even when constituent heads are green. Independent latest-head review and resolved actionable threads remain merge gates.

## 11. Known risks and release gates

All foundation section 11 Paged.js, main-thread, oversize-block, fallback-raster and editor-tokenizing risks remain. The source archive provenance part of #62 is closed by the `MDVIEWER_SOURCE_ID` build labelling (a supplied release tag or archive checksum names the archive in `dist/SOURCE.txt`; runtime export fixes alone never could). #59's historical deployment-evidence inconsistency also requires reconciliation rather than invented operator evidence.

**AI-6 second-engine/manual-feel and AI-7 live deployment/two-version PWA operator verification remain open.** Hosted Chromium success does not close them. This specification makes no deployment, Safari/Firefox acceptance, live cache-header, installed-PWA or operator-sign-off claim.

## 12. Split workspace and preview geometry

Foundation section 12 remains the detailed editor contract: mounted panes, an invisible but measurable parked canvas in Markdown mode, in-place text events, native textarea editing, synchronous backdrop freshness, matched layer metrics, glued scrolling, bounded tokenization and editor-free print output.

Canvas zoom is still a paint-only transform and never a reflow key. The screen-only outer host envelope tracks the painted stack height to remove the unscaled blank scroll tail. Its width is at least the painted sheet plus gutters and viewport width so explicit 100% or 50% zoom retains horizontal access to the whole sheet. Remove the envelope before pagination. Reset height and width to auto and overflow to visible for print. Do not scale sheet layout measurements or crop exported pages.

A zero-height sticky overlay anchor keeps progress feedback in the preview viewport during deep scroll. The page chip and zoom controls retain their existing sticky behavior. Production browser tests, not jsdom rectangles, determine whether these geometry contracts hold.

## 13. Undo the latest explicit close

`src/ui/DocumentRecovery.ts` is owned by Toolbar, not a second document store or renderer. Its pinned interface is:

```typescript
export interface DocumentRecoveryController {
  closeActive(): void;
  destroy(): void;
}
export function mountDocumentRecovery(
  root: HTMLElement,
  store: DocStore,
  returnFocus: () => void,
): DocumentRecoveryController;
```

Toolbar mounts it in its own bar, delegates its Close button, and destroys it during toolbar teardown. The controller keeps only the latest explicitly closed name and exact text in memory. Another real close replaces that snapshot. Undo consumes it once and calls `DocStore.add`, yielding a fresh identity and appending to the open set without overwriting another document. Discard and teardown clear both the snapshot and filename DOM text/title. Detached or destroyed controls cannot act. No disk/browser storage, automatic reload recovery, timer or global listener is added. Explicitly closed content is not part of the open-document navigation guard; the recovery row warns that reload or tab close clears it.

The `.document-recovery` row contains `.document-recovery-status`, `.document-recovery-name`, `.document-recovery-action` buttons and `.document-recovery-hint`. It is hidden without recovery and in print. Names use text nodes, full titles and narrow-screen ellipsis. Recovery buttons must not use the unique Open/Save `.workspace-action` selector. Close focuses Undo; Undo/Discard return focus to the editor when visible, the active-document selector in Preview-only mode, or Open when no document remains. View mode does not change.

Store notifications continue through App's existing render scheduler and export leases. The pipeline and all App/DocStore public signatures are unchanged. Coverage: `tests/document-recovery.test.ts`, `tests/e2e/undo-close.spec.ts`, and `tests/e2e/undo-close-lifetime.spec.ts`. The test-first baseline run 36192170082 failed exactly the three missing-Undo assertions while 83 existing browser tests passed. Final-head CI and independent review, not this baseline, determine readiness.
