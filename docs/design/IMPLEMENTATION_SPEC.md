# MDviewer implementation specification (canonical)

This file owns the current render, export, workspace and navigation contracts. Change code and this specification together. The detailed pre-workspace specification is retained **byte-for-byte** in [IMPLEMENTATION_FOUNDATION.md](IMPLEMENTATION_FOUNDATION.md), including its original title. It is a retained foundation, not a competing current specification: its unchanged module signatures, no-slice mechanics and editor details are incorporated here; the explicit replacements and additions below take precedence. Its dependency inventory is historical, not a current installation claim.

Companions: [Product vision](../PRODUCT_VISION.md), [Architecture](../ARCHITECTURE.md), [Agent index](../../autodoc/AGENT_INDEX.md), [Workspace refresh](WORKSPACE_REFRESH.md), [Export/update lifetime](EXPORT_UPDATE_LIFETIME.md), [Offline raster capture](RASTER_OFFLINE_CAPTURE.md), [Future work](../FUTURE_WORK.md).

## 1. What MDviewer is

A local-first Markdown reader/editor and paginated PDF workspace for the web and an experimental Windows desktop app. The Windows entry starts in continuous reading and loads the shared editing/PDF workspace on demand (§14). Documents arrive through file picker, drop, paste or direct editing. Open documents and latest-close recovery stay in memory; there is no automatic/app-managed document or session persistence. Explicit user-selected Markdown copies and PDF saves/exports are supported (§5, §14). Persisted app-managed user state is limited to settings and the approved Pulseboard consent/visit/region/session keys. No upload, remote conversion or document request is permitted.

The approved runtime-network exception is the Pulseboard SDK 3.3 (`public/pulseboard.js`, locked by `observatory.lock.json`, active only on the production origin), and product code reaches it only through `src/app/pulse.ts`, whose events carry closed enums, size buckets and page counts; error events are shielded from it (`installErrorShield`). Document text, file names, titles, headings, document URLs and export contents never reach it (`tests/pulse.test.ts`). Any other runtime request or telemetry still needs an owner decision.

[Future work](../FUTURE_WORK.md) and [#195](https://github.com/Chris0Jeky/MDviewer/issues/195) index proposed scopes. Save/Save As ownership [#196](https://github.com/Chris0Jeky/MDviewer/issues/196) is implemented on Windows (§14, `docs/design/FILE_LIFECYCLE.md`); optional recovery [#197](https://github.com/Chris0Jeky/MDviewer/issues/197) is design-only and sessions stay memory-only.

The product invariant remains page-break-safe output: keep normal-size code blocks, figures, tables and callouts intact; use the foundation's explicit graceful-split/shrink/forced-split tiers for genuinely oversize content. Both PDF paths consume the same prepared page DOM.

## 2. Dependency authority

`package.json` and `package-lock.json` at the checked-out commit are authoritative. The foundation's dated August inventory is retained historical evidence, not a version prescription. Do not infer a successful installation, advisory clearance or supported engine from it. The supported Node range is `^24.15.0 || >=26`; production and Chromium jobs use Node 24 with strict engine checks. The exact-head Node 22 verification context remains a legacy compatibility probe until branch protection is updated, not a supported installation target. Preserve the fine-grained Shiki imports, aligned Shiki siblings, markdown-it 15 named class type, ambient Paged.js types and jsPDF image/page/save API described in foundation section 2.

The scoped `@vscode/markdown-it-katex` override uses npm's `$katex` reference to align the wrapper's fallback with the direct renderer and CSS. The app already injects the direct renderer with `trust: false`; removing the old fallback also closes [GHSA-238p-pmpm-9mq7](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7) in the installed graph. `fast-uri` is locked to a patched 3.1.x release for [GHSA-hrr3-gc8f-f4qj](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj). `tests/dependency-security.test.ts` checks inherited KaTeX trust and encoded-host normalization behavior. Reassess the override when the wrapper adopts a patched dependency range.

Development-only parent overrides coordinate minimatch 11.0.4 for ESLint,
config-array and typescript-estree with glob 14.0.3 for Workbox. Glob 11 cannot
consume minimatch 11's compiled matcher representation. Preserve the direct
tooling versions, production dependency graph and unaffected filelist/minimatch 5
branch. `tests/dev-dependency-compatibility.test.ts` exercises the actual installed
consumers, filesystem cancellation and precache output. See
[`DEVELOPMENT_DEPENDENCIES.md`](../DEVELOPMENT_DEPENDENCIES.md) for advisory sources,
override removal criteria and the primary rejection of deepmerge CVE-2026-93753;
raw audit results may still contain that invalid development-only residue.

## 3. The load-bearing render order (NEVER reorder)

```text
0  capture raw Markdown and settings for this render; readFrontMatter blanks leading YAML
1  await getHighlighter()
1b createMarkdown(null, settings); parse once, retaining tokens and environment
1c await ensureLang for each parsedFenceLanguages(md, tokens) label
2  installMarkdownHighlighter; synchronous renderMarkdownTokens (Shiki and KaTeX)
3  buildPaginationSource (TOC and inline footnote transformation)
4  await renderAllMermaid(source, 'default')
4b stampAtomicBlocks(source)
5  await awaitFontsAndImages(source)
6  fully prepared source for this run
7  registerHandlersOnce; await paginate(source, css, host)
   inside paginate: await Previewer.preview; repairFootnoteLinks(host); return flow
```

Step 0 calls `readFrontMatter(text)` (`src/render/frontmatter.ts`) in both pipelines. A
leading `---` line closed by `---` or `...`, whose first content line looks like YAML, is
replaced by the same number of empty lines so source maps keep original line numbers; any
other document is returned unchanged, so its paginated output is identical. The paginated
pipeline prints no front matter. The Windows reader prepends a collapsible Properties card
(`src/desktop/reader/frontmatter.ts`, text nodes only) that lists the fields read by a
tolerant line reader (flat keys, one nested level, lists, quoted strings, block scalars) or
the raw YAML in monospace. Its lint, open by default when present: an unquoted value
containing `: `, an unterminated block, and a missing `name` or `description` in a skill,
agent definition or memory file (skills by basename, memory files by path or a `metadata.type` key, agents by `.claude/agents/` path).

Grammar preparation uses decoded parser-recognized fences, including nested blockquotes,
lists and footnotes. Fence-shaped text inside code examples does not request a grammar.
Attach Shiki only after preparation settles: its Markdown plugin snapshots the loaded
languages when installed. Render the same tokens and environment after the stale-render
check, using the settings captured for this run.

The final link repair changes **href attributes only**, after Paged.js has generated destinations. It is not another layout pass and must never change geometry. All height-affecting work still precedes the single pagination call. Paged.js handlers remain globally registered once; a fresh Previewer is used per run, and stylesheet Blob URLs are revoked in `finally`.

Reflow keys are `codeTheme`, `docFont`, `fontSizePt`, `paperSize`, `margins`, `showToc`, `showPageNumbers`, `titlePage`, `runningHeader`, `showLineNumbers`. Screen theme, zoom, view mode and split ratio are screen-only. Content debounce remains 250 ms and settings debounce 120 ms. Rendering is serialized, not merely debounced.

Every scheduled content/settings render builds a fresh fragment from its captured input. Export can reuse a matching completed paginated render under the scheduler lease (§5); prepared source is not retained as a re-pagination cache.

## 4. No-slice, TOC and footnote identity

Foundation section 4 remains the detailed no-slice contract: `break-inside: avoid`, keep-with-next headings, orphans/widows, repeated table headers, decoration cloning and the 1.15 shrink threshold. Do not shrink reflowing tables or use a second pagination engine. Paged.js-only declarations (`float: footnote`, `target-counter`, `leader`, `string-set`, `@footnote`, `@page`) belong in `buildStylesheet`, not merely global CSS. Footnote area typography must survive relocation outside `.doc`.

**Replacement for the foundation's `li` listing:** list items are NOT keep-whole atomic blocks. `print.css` gives `li` the same `orphans: 3; widows: 3` clean-split protection as paragraphs and no `break-inside: avoid`: a long checklist item that does not fit the remaining space fragments instead of pushing itself whole onto the next page and leaving the sheet mostly blank (2026-09-26 checklist report: a 610-line todo list paginated four non-last pages over one-third blank, worst 76%; after the change the worst non-last page is 4% and the document shrank from 20 pages to 16). `ATOMIC_BLOCK_SELECTOR` (`src/render/buildSource.ts`) excludes `li` for the same reason — stamping would assert a keep-whole promise the fragmenter no longer makes — while atomics nested inside an item (`pre`, `table`, `figure`, callouts) keep their own rules and stamps. `blockquote` stays keep-whole as the foundation lists it. Cover: `tests/e2e/list-flow.spec.ts` over `tests/fixtures/checklist.md`.

**Completeness outranks keep-whole (2026-11-11).** Keep-whole is the rule only for a block that fits one page. The tiers, all applied in the Paged.js `afterParsed` hook (`src/paginate/shrinkToFit.ts`) before layout:

- **Measure in context.** Every outermost `[data-mdv-atomic-id]` block is measured inside shallow clones of its real ancestors (up to `.doc`) at the printable width, in one batched layout, and recorded as `data-mdv-source-height`. A block that stays whole must match its laid-out height within 2 px (layout px; on-screen rects are zoomed).
- **Tier 3** shrink (≤ 1.15× page) applies to code and diagrams only, as before, but the fit now counts a keep-with-next heading directly above the block (a block that fits a page alone but not under its heading is shrunk too), and the scale is applied with CSS `zoom`, not a transform. A transformed block kept its unscaled content height in layout; the overflow fragmented into the next page column, so "shrunk to fit" blocks were silently split. `zoom` scales the layout box itself (and html2canvas-pro honours it for the raster export).
- **Tier 4.** A code block, table, blockquote or callout still taller than the page, counting a keep-with-next heading directly above it, is marked `data-mdv-splittable`; `print.css` turns that into `break-inside: auto`, so the browser fragmenter and Paged.js agree it may break at line, row or paragraph boundaries with the cloned decoration. Only the marked block (and a code figure's own `<pre>`) is relaxed: a short fence nested in a split quote or callout stays whole. Images and Mermaid SVG cannot split and are capped to the page height by `buildStylesheet`.
- **Paged.js 0.4.3 undisplayed bug.** Its UndisplayedFilter marks every inline-styled element `data-undisplayed`, so a heading's `break-after: avoid` skipped its Shiki `<pre>` and landed on the next heading; when that heading overflowed on a page that began inside the code block, Paged.js backed up to the block's start and stopped with "Layout repeated". `restoreDisplayedElements` (handler `filter` hook) clears the bogus mark before break propagation.
- **Layout runs at zoom 1.** Paged.js 0.4.3 finds the next page column at `bounds.right + column-gap`, adding an unscaled gap to a scaled rect, so under a preview zoom below 1 blocks overflowing into the next column were never cut and stayed hidden. `paginate` sets `--preview-zoom: 1` on the host for layout and audit, then restores the canvas zoom without easing.
- **Audit and recovery.** Paged.js resolves even after it gives up, so `paginate` audits every run (`auditPagination`): each text-bearing source element rendered, no empty page, nothing laid out twice, nothing below a page or in a hidden overflow column. A failed audit re-runs from a pristine copy with the offending block splittable, then with every splittable keep-whole block, and returns `recoveredSplits` for a reader-facing warning. If that still fails, the pages are torn down and `PaginationIncompleteError` puts the App in its fatal state with export ineligible. A truncated document is never presented.

Cover: `tests/e2e/pagination-completeness.spec.ts` over `tests/fixtures/long-prose-fences.md`, plus forced-stall and fatal cases.

An author-placed `[[toc]]` stays in place; a synthesized TOC follows the first h1, or starts the document when no h1 exists.

`transformFootnotesToInline` allocates one retained float per note. It preserves the original ID unless occupied outside the removed endnote section, then allocates a collision-free `-footnote-N` suffix. Every citation, including repeats, is rewritten before the single-float guard. Never rename a heading to make room for a note.

Paged.js replaces a floated note's ID and retains its source identity in `data-id`. `repairFootnoteLinks` maps `[data-footnote-marker][data-id][id]` back to those generated destinations. Only citation hrefs change; generated IDs, unrelated links, unmatched references, page geometry and counters stay untouched. The repair is idempotent.

## 5. Export ownership and source saving

Raster progress and outcomes live in the direct `#app > #export-status` shell row,
outside the hidden preview and scrolling toolbar. `ExportState.pdf` exposes
Preparing, completed-page Rendering, native Saving, browser Downloading and
Saved/Download requested/Canceled/Failed outcomes. The mounted polite atomic
`#export-status-live` announces the first page and quarter milestones (at most five
progress messages); the visible count updates for every completed capture. A native
save is successful only after its destination settles; jsPDF browser handoff says
“download requested,” which does not claim disk persistence. The visible failure
reason is text-only and capped at 180 characters; the existing fatal card keeps its
full detail. Status updates do not change focus, source selection/scroll or page
identity. The strip is excluded from print/capture, and selectors are scoped to the
shell so an authored `#export-status` heading remains printable. No Cancel control
or overall capture timeout is introduced. See `EXPORT_STATUS.md` and
`tests/e2e/export-status.spec.ts`; #201 remains separate.

Vector `exportViaPrint` remains primary. Raster `exportPaginatedToPdf` remains a best-effort fallback, one canvas per existing page. Keep print sheets dark-on-white, html2canvas logging disabled, and task checkbox pseudo-elements off form controls. Foundation section 5's rendering constraints still apply.

Raster normalization changes only html2canvas's disposable clone. Remove the preview's ancestor scale/envelope and reveal the copied sheet. Restore authored SVG visibility declarations after the cloner has inlined computed hiding from Markdown-only mode; explicit author hiding must remain hidden. Materialized TOC leaders retain an automatic flex width so copied used widths cannot wrap titles and reflow the page. Capture styled task checkboxes as static spans with their computed paint, bypassing the renderer's native-control painter. The embedded tick SVG has intrinsic dimensions for canvas resizing. The live sheet, controls, transforms and document source remain untouched.

Offline capture qualification is tracked in [#174](https://github.com/Chris0Jeky/MDviewer/issues/174) and [#178](https://github.com/Chris0Jeky/MDviewer/pull/178). It requires actual saved-PDF pixels and damaged controls after service-worker control and a failed uncached network probe are established. The earlier 2.5.2 containment pin alone does not establish offline pixel fidelity. See [Offline raster capture](RASTER_OFFLINE_CAPTURE.md) for exact-head evidence and remaining gates.

The raster adapter requires html2canvas-pro 2.6's synchronous mount contract: `html2canvas()` creates its clone Document in the supplied `iframeContainer` before returning its promise, while resource events and `onclone` run later. Each capture gets a fixed, zero-size container marked `data-html2canvas-ignore`. Immediately after calling the library, the adapter observes load/error events for every enabled, non-alternate linked stylesheet with an `href` in that owned iframe. A non-null `link.sheet` does not prove success: Chromium can retain a sheet after a failed request. Empty CSS and sheets with inaccessible rules remain valid after an observed load; the adapter never reads `cssRules`.

At `onclone`, the adapter verifies the observed Document and required link identities, then awaits their recorded outcomes before normalization. These promises resolve outcomes instead of rejecting early; a recorded failure rejects only inside the awaited callback. The library's stylesheet wait also settles on error, timeout or sheet polling, so its callback can precede a queued load/error event. Pending outcomes retain their ten-second deadline from observation at mount; entering `onclone` never restarts that wait. After CSS succeeds, the adapter normalizes and reveals the clone, forces layout, then starts a fresh ten-second font deadline and awaits `document.fonts.ready`; any font with error status also rejects the capture. Upstream font/image waits precede the callback and the whole export has no total timeout. A failure saves no PDF. An outer `finally` removes the owned container, frames, listeners and timers even if the library fails outside `onclone`; unrelated iframes remain untouched. A missing/unobserved callback fails closed. See `docs/PDF_VISUAL_REGRESSION.md` for the 2.6 compatibility regression and source references.

When the source reports `navigator.onLine === false` and has an accessible service-worker controller, `offlineCapture.ts` prepares an empty controlled `srcdoc` destination before cloning, with a ten-second navigation deadline. Chromium's initial `about:blank` frame does not inherit the controller in the observed production run. The offline path omits exact source stylesheet links from that temporary frame, then adopts the cloned root into the verified destination during `onclone`. Fresh links preserve their original positions among source inline head styles, ahead of renderer-appended adopted styles; generated pseudo styles remain in body. Source link attributes/order and clone ownership must still match the plan. Real final-document load/error events are observed in the same task as insertion and use the same fail-closed CSS/font gates. The source base URI and asset URLs are retained. This is scoped to same-origin app CSS linked directly from head, not a generalized shadow-DOM adapter. Online capture and desktop documents without a controller retain the original route; arbitrary initial failures are never retried through this path. No worker policy, document persistence, export API or print routing changes.

The fallback paints Paged.js's default native decimal footnote `::marker` as absolute text inside the cloned note, retaining the space already reserved by the native marker. Numbers come from repaired citation targets across the paginated stack, including repeated references and double digits. Continued fragments and explicit custom/hidden markers are left alone. Temporary zero-size probes measure the actual first-line baseline, including tall inline content, and are removed before capture. Both probing and final paint must preserve the note box and original content rectangles; otherwise capture rejects with the Print fallback. Generated IDs, counters, live footnotes and primary Print output remain unchanged.

**Replacement for the old flush-only export contract:** each public export captures `{ doc: copy of id/name/text or null, settings: copy }` synchronously when requested, before joining the queue. `withRenderLock` flushes pending preparation and owns the host until the entire export settles. Later renders, switches and closes queue behind it. Each lease seals the coalescing batch so later requests cannot cancel preparation on its earlier side.

Inside the lease, App compares the completed snapshot's id, name, text and reflow settings to the captured input. A matching snapshot is reused. Otherwise App runs the exact captured input through the normal pipeline under the lease. It must not re-read mutable editor input as the export request. Successful pagination publishes the exportable snapshot. Starting newer preparation invalidates that eligibility; retained older pages can remain readable after failure but cannot masquerade as current output. Both export paths release ownership on success or failure. Do not call scheduler flush from inside a lease.

Closing the final document calls `teardownPagination`, removing injected Paged.js styles and sheets. A close during export is processed after capture finishes.

`downloadMarkdown(name, text): void | Promise<void>` exports the exact captured text with a portable Markdown filename. The web path removes its transient anchor and revokes its Blob URL after download initiation. The native destination returns a promise that the source-save action awaits (§14). This explicit Save Copy does not adopt an original-file binding, clear the dirty baseline, persist a session or disable navigation protection.

## 6. File tree and ownership

The foundation section 6 tree remains the map for unchanged modules. These current seams are added:

| Path | Owner and responsibility |
| --- | --- |
| `src/paginate/footnoteLinks.ts` | Generated destination repair, called only after preview resolves |
| `src/export/footnoteMarkers.ts` | Clone-only default footnote numeral paint and baseline/layout preservation |
| `src/export/offlineCapture.ts` | Offline controller predicate, owned `srcdoc` destination, source CSS-order plan and clone adoption |
| `src/export/markdown.ts` | Exact source download and portable filename |
| `src/app/reloadGuard.ts` | Native navigation guard and one explicitly accepted update reload |
| `src/ui/UpdatePrompt.ts` | Recoverable activation/readiness/reload presentation state |
| `src/ui/DocumentShortcuts.ts` | Ctrl/Cmd+O and Ctrl/Cmd+S adapter over the existing document buttons |
| `src/styles/workspace.css` | Screen toolbar hierarchy, disclosure, session row and preview envelope |

`App.ts` remains the only render/export orchestrator. `state.ts` owns the scheduler lease. `main.ts` connects the service-worker plugin and native readiness notifications to UpdatePrompt and App's reload decision, and mounts document keyboard shortcuts after the toolbar exists. UI modules do not paginate directly.

## 7. Module API (pinned signatures)

Unchanged exports retain the signatures in foundation section 7 and its section 12 workspace additions. The following are the current additions/replacements. `Settings`, `Doc`, `App` and imported library types mean their actual project types.

```typescript
// src/app/state.ts: DocStore additionally supports atomic imports
addBatch(docs: readonly Pick<Doc, "name" | "text">[], activate?: boolean, position?: DocumentPosition): Doc[];
// Defaults to selecting the first added document; false preserves the current selection.

// src/app/state.ts: adds to the existing scheduler surface
export interface RenderScheduler {
  schedule(reason: RenderReason): void;
  flush(): Promise<void>;
  withRenderLock<T>(task: () => Promise<T>): Promise<T>;
  readonly isPending: boolean;
}

// src/paginate/footnoteLinks.ts
export function repairFootnoteLinks(host: ParentNode): void;

// src/export/download.ts
export type PdfExportResult = "saved" | "download-requested";
// FallbackPdfOptions additionally accepts onSaving?(destination: "native" | "browser"): void;
// exportPaginatedToPdf now returns Promise<PdfExportResult>; native cancellation rejects SaveCanceled.

// src/export/markdown.ts
export function markdownFilename(name: string): string;
export function downloadMarkdown(name: string, text: string): void | Promise<void>;

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

// Replacement for the foundation's input rejection callback: one call per batch.
export function installInputHandlers(store: DocStore, opts: {
  onReject(names: string[], tooLarge: string[], unreadable: string[]): void;
  onLargeFile(bytes: number): Promise<boolean>;
  onTooLarge?(name: string): void;
}): () => void;

// src/ui/Banner.ts: render warnings and ingestion notices have separate lifetimes.
export interface BannerController {
  warn(warnings: RenderWarning[]): void;
  notice(warnings: RenderWarning[]): void;
  fatal(msg: string): void;
  clearFatal(): void;
  clear(): void;
}

// src/app/App.ts: category-specific messages for one skipped-file batch.
export function skippedFileWarnings(
  rejected: string[], tooLarge: string[], unreadable?: string[],
): RenderWarning[];

// src/app/App.ts: additional public method; other public signatures unchanged
// App.reloadForUpdate(): boolean
```

`paginate(source, css, host): Promise<PagedFlow>` retains its signature; it now calls `repairFootnoteLinks` between awaited preview and returning the flow. `CanvasController` signatures are unchanged. Snapshot capture and export preparation are private App details, not new global hooks.

File picks/drops report unsupported types, hard-cap refusals and failed local reads separately in one callback. Declined soft-cap confirmations remain silent. App sends these messages (and paste/editor hard-cap refusals) to `BannerController.notice`. The latest ingestion batch stays visible across render completion, reflow and closing the last document until the user dismisses it or another ingestion notice replaces it. `warn` replaces only render warnings; `clear` clears render warnings and fatal errors while retaining ingestion notices. `clearFatal` hides and empties only fatal feedback, preserving both warning categories. A successful raster save invokes it before releasing the export lease; a canceled or failed save does not clear existing failure feedback. Dismiss clears both warning categories, including notices dismissed during an asynchronous render. Long render-warning lists may be summarized, but ingestion details always remain explicit. Feedback stays outside the paginated/exported document. Cover: `tests/input.test.ts`, `tests/app-ingestion-notices.test.ts`, `tests/e2e/empty-error.spec.ts`.

Fatal feedback stays visible and actionable in Markdown-only mode while the preview and paged stack remain hidden and measurable. Showing a fatal error returns only the canvas scroll position to its origin instantly, restoring its prior scroll policy; it does not change view mode, Markdown text, or the source editor's selection and scroll. The error card remains excluded from print and capture. Recovery coverage: `tests/app-export-lifetime.test.ts` and `tests/e2e/raster-styles-ready.spec.ts`.

Each file pick/drop appends its accepted documents in one store notification and selects the first accepted file only while that request still owns the editor context. Newer file/paste requests, active-document changes (including switching away and back) and text edits invalidate that selection right. Superseded reads still append documents passively; unchanged active text leaves the editor's caret, focus and native undo intact. Teardown aborts further reads/confirmations in a batch and ignores pending file/paste completions and notices. An already-started `File.text()` may settle without mutating the destroyed app. Coverage: `tests/input-race.test.ts`, `tests/state.test.ts`, `tests/e2e/input-race.spec.ts`.

## 8. DOM IDs and CSS cascade

Existing IDs and named contracts stay in `src/app/dom.ts`; Paged.js-owned names must never be renamed. `workspaceAction` styles source New/Open/Save buttons and distinguishes them from `exportPrimary` and `exportSecondary`, which remain PDF-only control identities.

Import order in `main.ts` is **app → editor → preview → document → workspace → print → shiki → pwa**. Workspace styles are chrome, not document typography. Print overrides the screen envelope, and the generated Paged.js stylesheet remains independent.

The primary toolbar row contains identity, optional desktop New, Open, View, Screen and PDF actions. A native `details`/`summary` groups document formatting. The web entry starts it expanded above 760 px and collapsed at narrower widths. The experimental Windows desktop starts it collapsed at every width to preserve writing space. Escape closes it and returns focus to its summary without resetting settings. The local-session row explains the document lifetime and provides Save Markdown. The active filename is visible even with one document. Controls remain reachable at narrow widths: at widths up to 760px the primary row is a single-row horizontal strip (no wrap; swipe/focus scrolls controls into view) so the toolbar stays compact and the preview keeps its height. Cover: `tests/e2e/responsive-toolbar.spec.ts`.

`DocumentShortcuts` requires exactly one direct `button[data-document-command="open"]` in `.workspace-actions`, one `button[data-document-command="save"]` in `.workspace-session`, and the session's `.workspace-privacy` hint host. An optional unique `button[data-document-command="new"]` in `.workspace-actions` adds desktop New. Missing required or ambiguous controls are an explicit mount error; styling classes do not determine routing. Shortcuts call these existing buttons synchronously; they do not duplicate creation/input/download logic. Ctrl/Cmd+N creates a document when supplied; Ctrl/Cmd+O opens Markdown; Ctrl/Cmd+S saves current source. A `.workspace-shortcuts` hint, button titles and `aria-keyshortcuts` expose the available actions. At viewport heights up to 600px, opening Format hides only this redundant key legend to retain usable source space with both Find and Format open; the memory warning, document count, Save action and every command remain visible. Closing Format restores the legend. Already-handled events, IME composition, Alt/Shift, unrelated keys and combined Ctrl+Meta remain untouched. Matched disabled/repeated events are prevented without clicking, so browser Save never downloads app HTML in the empty state. Teardown removes the listener/hint and restores attributes; detached roots are inert. `main.ts` owns the lifetime and registers HMR disposal. Tests: `tests/document-shortcuts.test.ts`, `tests/e2e/document-shortcuts.spec.ts`.

## 9. Persistence and navigation

`SessionPositions` holds at most 64 LRU entries of source selection/direction and
source/preview/reader scroll coordinates, keyed by document ID. It stores no source,
DOM nodes, undo history or disk/browser state. `DocStore.beforechange` captures the
outgoing identity before append, switch or remove; close prunes that entry and the
single Undo Close snapshot may transfer its coordinates to a fresh restored ID.
Same-ID selection and inactive imports do not trigger pagination. Desktop mode
handoffs transfer coordinates explicitly between owners, including failed-return
recovery, without loading the editor or paginator during reader navigation.

Previous/Next buttons and the native picker remain keyboard reachable. Windows/Linux
use Alt+Shift+P/N for previous/next and Alt+Shift+D for the picker, with visible hints
and `aria-keyshortcuts`. Apple platforms leave these Option chords unbound, preserving
native text entry and selection. Composition, handled events, held-key repeats,
detached/hidden/inert controls and disabled selection cannot navigate. Duplicate
filenames receive ordinal picker labels; identity never comes from the label.
Source restoration clamps UTF-16 offsets and browser scroll geometry in a fresh
textarea; preview positions restore only after the corresponding identity renders.
See `SESSION_NAVIGATION.md`, position/navigation units and both production
`session-navigation.spec.ts` suites. This is session navigation, not persisted recents.

Settings persist under `mdviewer.settings.v1`; the approved SDK keys are the separate exception described in §1. Open document bytes, latest-close recovery, source-download state and export snapshots remain in memory. Explicit user-selected saves/exports write their requested files without adding automatic/app-managed document or session storage. Preserve validation/clamping for view mode, split ratio and title-page settings described in foundation sections 9 and 12. Preserve the pristine-sample exemption in `hasProtectableWork`; modifying the sample restores protection.

Worker activation and document reload are distinct. UpdatePrompt remains dismissible during activation; it recovers after failure or timeout. A cancelled reload can be retried without waiting for a second controllerchange. Dismissal removes owned listeners/timers and invalidates queued activation work. Plugin and native readiness converge idempotently; another tab's activation is not consent to reload this one.

`onNeedReload` explicitly suppresses vite-plugin-pwa 1.3's own reload because the legacy reloadPage argument is ignored. App refuses update reload during export. Otherwise ReloadGuard checks current work immediately before navigation and requires explicit confirmation when work would be lost. Positive confirmation bypasses native beforeunload for that single navigation only; the bypass expires and is cleared if navigation throws. Cancellation leaves normal protection armed. No document is silently persisted as part of this handoff.

## 10. Testing and evidence

Keep foundation section 10's unit/real-browser distinction. Added regressions cover note target uniqueness after actual pagination, heading collisions, queued edit/close export races, metadata consistency, stale-output refusal, lease failure recovery, one-shot navigation consent, update retries and late callbacks, exact Unicode source-download bytes, disclosure focus, narrow controls, zoom scroll extent, horizontal access and print reset, running-header `start` semantics over pushed content, and titlePage page-1 chrome (`tests/e2e/running-header.spec.ts`).

`tests/e2e/raster-visual.spec.ts` checks independent RGB/ink expectations in the actual downloaded PDF, including HSL, a filter chain, linear/radial gradients, SVG transforms and intentional hiding, stacking, syntax colors, math, table/TOC content, and task checks. The production run deliberately delays only the clone's linked CSS and verifies the delay occurred. `raster-styles-ready.spec.ts` rejects clone CSS twice in Split and Markdown-only modes after scrolling a long preview, checks visible error/Reload geometry before interaction, no download or retained iframe, then succeeds on retry and clears the fatal card. It preserves source selection/scroll/text and view mode, keeps the hidden preview measurable, and saves failure/recovery screenshots. `raster-footnotes.spec.ts` checks numeral-only regions in a multi-page saved PDF, including repeated citations, a heading ID collision, double digits, tall inline content and a block-first note; live geometry/IDs must remain unchanged. `tests/helpers/rasterPdf.ts` follows the generated PDF's xref/page/resource/content references, requires a full-paper opaque RGB image on every page, and rewraps its PNG-predictor stream for Chromium decoding; unsupported encodings fail explicitly. Second downloads with color/code/tick or only numeral paint deliberately removed must fail the same visual criteria. This complements the zoom-state comparison in `raster-resolution.spec.ts`; it is not a general PDF renderer or a font-perfect snapshot. See `docs/PDF_VISUAL_REGRESSION.md` for reproduction and evidence scope.

Required check names remain Node 22 and 24 typecheck/lint/unit/build plus the production Chromium suite and Observatory guard. Node 24 is the supported strict-install lane; Node 22 remains a legacy compatibility probe until branch protection is updated. Chromium and deployment run on Node 24. Browser artifacts are uploaded on both success and failure. Do not weaken no-slice or export assertions to make a UI change pass.

Required tests must pass. Report the existing opt-in performance-ladder cases and their skips separately; optional measurement coverage does not replace any required gate.

`playwright.authoring.config.ts` adds a bounded production Firefox lane for native
textarea undo, source/backdrop geometry, Find/Replace, shortcuts and desktop New/
layout behavior. `authoring-accessibility.spec.ts` in both browser suites checks
accessible names/state, keyboard focus, status exposure, composition guards and
short reflow. Forced-colors mode uses native system-colored source text with the
decorative backdrop hidden, and an actual outline for Find because forced colors
can suppress translucent fills and shadows. The rule is screen-only. The lane
records actual browser versions and retains failures without retries. Synthetic
composition/paste payloads exercise application guards, not operating-system IME
or clipboard UI. See `AUTHORING_QUALITY.md`; AI-6 and #169 remain human gates.

Offline capture also has real resource-loss controls: `raster-styles-ready.spec.ts` deletes the exact cached app stylesheet after the source is styled; `raster-fonts-ready.spec.ts` deletes the cached KaTeX Main-Regular woff2 after the source's corresponding font face is loaded. Each requires two no-save failures with complete iframe cleanup, restores the original cached response, and parses the actual PDF saved on retry. HTTP/memory cache is disabled so it cannot conceal the missing CacheStorage entry. The extra CDP session agrees with the context's offline emulation; the source offline hint and controller, a failed uncached request, controlled-frame resource errors, and worker-served recovery are asserted. No route supplies CSS or fonts. `raster-offline-frame.spec.ts` separately checks controller inheritance through adoption, CSS/font worker responses and a missing-cache error. That primitive proof does not replace saved-PDF pixels and damaged controls. Unit coverage in `tests/raster-offline-capture.test.ts` checks cascade order, generated styles, controller refusal, bounded navigation, inactive links and cleanup/retry. Exact-head evidence and limits are recorded in `docs/design/RASTER_OFFLINE_CAPTURE.md`.

An isolated component probe is not a production-app test. A local dependency-install failure is not a successful suite. Validation applies to the exact tested head; integration needs its own checks even when constituent heads are green. Independent latest-head review and resolved actionable threads remain merge gates.

## 11. Known risks and release gates

All foundation section 11 Paged.js, main-thread, oversize-block, fallback-raster and editor-tokenizing risks remain. The source archive provenance part of #62 is closed by the `MDVIEWER_SOURCE_ID` build labelling (a supplied release tag or archive checksum names the archive in `dist/SOURCE.txt`; runtime export fixes alone never could). #59's historical deployment-evidence inconsistency is closed; its reconciled header evidence does not close the separate AI-7 live/PWA acceptance work. Preserve the dated deployment and failure-ledger records.

**AI-6 second-engine/manual-feel, AI-7 live/PWA verification, AI-8 live Pulseboard acceptance, AI-9 production promotion, and Windows acceptance/performance #169 remain OPEN.** Hosted Chromium success does not close them. This specification makes no new deployment, Safari/Firefox acceptance, live cache-header, installed-PWA or operator-sign-off claim.

## 12. Split workspace and preview geometry

Foundation section 12 remains the detailed editor contract: mounted panes, an invisible but measurable parked canvas in Markdown mode, in-place text events, native textarea editing, synchronous backdrop freshness, matched layer metrics, glued scrolling, bounded tokenization and editor-free print output.

Workspace chrome selectors follow the mounted `#app > #workspace` parent chain;
pane, splitter and canvas rules address its direct children, and the active-match
cue belongs to the source pane's `.editor-scroll`. The app root is a direct child
of `body` on the web or the body's `#desktop-workspace` on desktop. Desktop shell
rules address the body's actual shells. These IDs are not reserved document
names: the literal 17-heading fixture in `tests/helpers/chromeHeadings.ts` retains
authored text and ordinary document flow in Split, Preview, forced colors and
print, including App, Status live, Error card and Reader shell. App feedback
lookups also target the actual canvas's direct error/live children, never a
heading inside the paginated document. Print hides only actual chrome.
Short-window Find layout matches the pane's direct search panel, never an
authored heading with the same ID. A parked canvas remains measurable and its
direct fatal card remains visible and actionable. Production web and desktop
`chrome-heading-scope.spec.ts` cases run beside the existing editor geometry,
search cue and failed-export recovery specifications.

The editor accepts `setDocument({ id?: string, name: string, text: string } | null)`;
App supplies the stable DocStore ID and legacy callers fall back to the name.
Same-document, same-text notifications preserve live selection and native undo.
A different identity fences delayed edits even when text and filename are equal;
every real identity boundary replaces the textarea to isolate native undo history.
`setDocument(doc, position?: EditorPosition)` may restore that identity's bounded
coordinates. `capturePosition()` and `restorePosition(position)` expose coordinates
without editing source or rebuilding the host; native undo remains per textarea.
The read-only `input` getter returns the current node; integrations must rebind
node listeners after a switch. App's synchronous adoption of the first typed
document preserves its node and first undo entry.

`EditorController.replaceRange(start: number, end: number, text: string,
signal?: AbortSignal, selectionAfter?: MarkdownSelection): Promise<boolean>` uses
native textarea UTF-16 offsets. The optional final selection is validated before
admission and applied only to the same editing host after its accepted command's
owned input-event sequence, with value/revision/focus fencing; reentrant input cannot redirect it. It
shares byte admission and the undo-aware insertion path with intercepted paste,
text drop and Tab. A delayed confirmation captures document identity, edit/source
revision, exact text, selection/revision/direction and focused element. Focus must
still match before commitment; document, value and selection ownership are
rechecked after focusing the source. Refusal, rejection, abortion, composition, teardown,
detachment, invalid range and unchanged replacement return false. A configured
hard limit refuses even if the host accepts; ordinary typing and small paste/drop
remain native. Abort prevents commitment but does not dismiss a host confirmation
UI or settle an unresolved host promise. Native insertText supplies the browser's
input-event sequence. The manual fallback dispatches one exact owned Event;
foreign or reentrant events cannot earn a stale final selection. Coverage:
`tests/editor-edit-safety.test.ts` and `tests/e2e/editor-edit-safety.spec.ts`.

### Source Markdown formatting

A collapsed Format disclosure beside Find exposes Bold, Italic, inline Code, Code
block, H1–H3, Link, Bullets, Numbers and Tasks. Ctrl/Cmd+B, I and K act only in the
source textarea. The labelled button group remains keyboard accessible; Escape
closes it and returns source focus. The panel wraps/scrolls within a bounded height
and uses the existing short-window measurable-preview parking behavior. Opening
controls never changes source or requests pagination; formatting stays out of print.

`MarkdownCommands.ts` produces pure UTF-16 range replacements and final selections;
`EditorFormatting.ts` applies them exclusively through guarded `replaceRange`.
Commands reject split surrogate boundaries and multiline inline code/link requests.
The exact empty-selection, multiline, indentation, toggle and placeholder rules
are pinned in `MARKDOWN_COMMANDS.md`; no parser or rich editor dependency is added.
Each accepted command makes one native undo edit in supporting engines; a native
multiline insertion can emit several input events. The manual fallback emits one
owned event and cannot supply native history. A delayed
confirmation, document switch, IME, aborted command or reentrant observer must not
modify a different host or apply a stale final selection. Coverage:
`tests/markdown-commands.test.ts`, `tests/editor-formatting.test.ts` and the real
production `tests/e2e/editor-formatting.spec.ts` Undo/geometry/keyboard matrix.

### Source Find and Replace

`EditorSearchModel.ts` owns escaped literal Unicode matching with UTF-16 offsets,
case matching, wrapping navigation and literal replacement construction. Queries
longer than 2,000 characters receive an explicit recoverable error; at most 10,000
matches are stored and a truncated set disables Replace all. Bulk UTF-8 size is
computed before allocating the replacement result, including surrogate pairs
formed across replacement boundaries.

`mountEditorSearch(pane, head, input, backdrop, options)` receives only the editor's
`replaceRange` callback and optional hard limit. Its controller exposes
`setInput(input)`, `sourceChanged(documentChanged?)`, and `destroy()`. Editor rebinds
Search after replacing its textarea, before restoring source focus. Document
changes, close and teardown abort pending replacement commitment. Rebinding removes
selection listeners from the old node; teardown removes the global shortcut.

Find opens from the source header or Ctrl/Cmd+F; Ctrl/Cmd+H reveals Replace.
Preview-only, inert, detached and composed contexts retain the host shortcuts.
Search is literal, supports Match case, and wraps through Enter/Shift+Enter, F3
and previous/next controls. Escape closes and returns to source. Navigation keeps
query focus. Delayed counting cannot replace a caret chosen after the query.
Replace all uses one native undo edit; replacement text has no substitution syntax.
An accepted delayed edit or completion cannot reclaim focus after the user moves.

Closed Search does not scan source text. While open, input changes schedule a
90ms idle recomputation. `EditorMatchCue.ts` paints the active full match in one
accessibility-hidden, pointer-transparent rectangle layer while query focus stays
in Find. It measures existing backdrop ranges across syntax spans; large sources
with highlighting disabled use a temporary text-only mirror through the matched
logical line, removed immediately after measurement. Cached content-coordinate
geometry preserves the shared authored `--editor-line-height` rather than its
computed pixel serialization, which can accumulate a different row advance in
long sources. The measured
rectangles serve both reveal and paint. Scroll only translates and clips that
cache; active layout/font changes remeasure once per animation frame. Source or
query changes, close, input rebinding and destroy clear geometry and pending work.
The cue never changes source, native selection, focus or undo, and retains no
source copy after measurement. Search controls occupy their own
grid row, adapt to narrow source panes and inherit source print suppression. No
new dependencies, network traffic or document persistence are introduced.

Coverage: `tests/editor-search-model.test.ts`, `tests/editor-search.test.ts`,
`tests/editor-match-cue.test.ts`, `tests/e2e/editor-search.spec.ts`,
`tests/e2e/editor-search-cue.spec.ts` and `tests/desktop-e2e/editor-search.spec.ts`.
Native undo, source geometry and print visibility require real browser evidence.
A generated zero-width sentinel after the highlight code retains the textarea's
empty final line after a trailing newline without changing backdrop textContent;
both layers therefore have the same scroll range.
At viewport heights up to 600px, open Find temporarily gives the source the Split
workspace and hides its redundant header. The canvas remains measurable and fatal
feedback remains visible. Closing Find restores the previous split geometry;
view mode, split ratio and document layout settings are not changed or persisted.
This also keeps source text usable in the supported 560×420 desktop window.

Canvas zoom is still a paint-only transform and never a reflow key. The screen-only outer host envelope tracks the painted stack height to remove the unscaled blank scroll tail. Its width is at least the painted sheet plus gutters and viewport width so explicit 100% or 50% zoom retains horizontal access to the whole sheet. Remove the envelope before pagination. Reset height and width to auto and overflow to visible for print. Do not scale sheet layout measurements or crop exported pages.

A zero-height sticky overlay anchor keeps progress feedback in the preview viewport during deep scroll. The page chip and zoom controls retain their existing sticky behavior. Production browser tests, not jsdom rectangles, determine whether these geometry contracts hold.

## 13. Undo the latest explicit close

`src/ui/DocumentRecovery.ts` is owned by Toolbar, not a second document store or renderer. Its pinned interface is:

```typescript
export interface DocumentRecoveryController {
  closeActive(): void;
  destroy(): void;
}
export type RestoreAdmission = (doc: Readonly<Pick<Doc, "name" | "text">>) => boolean;
export function mountDocumentRecovery(
  root: HTMLElement,
  store: DocStore,
  returnFocus: () => void,
  canRestore?: RestoreAdmission,
): DocumentRecoveryController;
```

Toolbar mounts it in its own bar, delegates its Close button, and destroys it during toolbar teardown. The controller keeps only the latest explicitly closed name and exact text in memory. Another real close replaces that snapshot. Undo consumes it once and calls `DocStore.add`, yielding a fresh identity and appending to the open set without overwriting another document. Discard and teardown clear both the snapshot and filename DOM text/title. Detached or destroyed controls cannot act. No disk/browser storage, automatic reload recovery, timer or global listener is added. Explicitly closed content is not part of the open-document navigation guard; the recovery row warns that reload or tab close clears it.

An optional synchronous admission callback runs before Undo consumes its snapshot.
Refusal leaves the source, filename and offer available for retry; a later explicit
close still replaces the offer. The ordinary web entry supplies no callback and
retains its existing restoration behavior. Desktop supplies the same open-document
count/UTF-8-byte gate used by its importer, including current edited source sizes.

The `.document-recovery` row contains `.document-recovery-status`, `.document-recovery-name`, `.document-recovery-action` buttons and `.document-recovery-hint`. It is hidden without recovery and in print. Names use text nodes, full titles and narrow-screen ellipsis. Recovery buttons must not borrow the `data-document-command` identities used by New/Open/Save. Close focuses Undo; Undo/Discard return focus to the editor when visible, the active-document selector in Preview-only mode, or Open when no document remains. View mode does not change.

Store notifications continue through App's existing render scheduler and export leases. The pipeline and DocStore signatures are unchanged; App's optional desktop admission hook is described in section 14. Coverage: `tests/document-recovery.test.ts`, `tests/e2e/undo-close.spec.ts`, and `tests/e2e/undo-close-lifetime.spec.ts`. The test-first baseline run 36192170082 failed exactly the three missing-Undo assertions while 83 existing browser tests passed. Final-head CI and independent review, not this baseline, determine readiness.


## 14. Experimental Windows reader

Owned Save (`Ctrl+S`) and Save As (`Ctrl+Shift+S`, plus workspace **Save** / **Save As**
buttons, `data-desktop-command`) run from reading view and the workspace when the
native host is present; the browser build of the desktop entry keeps today's keys.
`DesktopDocuments.saveTarget()` captures the active document's text and binding;
`completeSave()` applies a `saved` completion only to the same still-open document
(baseline = captured text, newer edits stay dirty, Save As renames through
`DocStore.rename`). Unbound documents go to Save As. Closing a bound document calls
`release_document`; mode transitions never do. Save Markdown remains the copy.

Links and images (S6 native half): `src/render/sanitize.ts` keeps a relative image `src` as an
inert `data-local-src` (web output unchanged otherwise, still counted as blocked). The desktop
reader fills those through `native.readAsset` as blob URLs (revoked on the next render).
Document clicks on relative links and `@path` imports call `native.openRelative`; web links keep
`open_external`. `navigate.back` / `navigate.forward` (Alt+Left/Right) step through documents
reached by links or the picker. The paginated workspace does not load local images yet.

Session restore (S7): after the first launch drain, `native.session.restore()` reopens the last
session's bound files (focus stays with launch files; unreopenable files are summarised in one
notice). `recordSession()` sends the open bound tokens, coalesced (500 ms, deduplicated) and never
during a mode transition. Command `session.toggleRestore`. Unsaved-content recovery (#197) is
not implemented; sessions keep paths only.

Library (S4 native half): `native.library.*` lists, scans and opens entries by opaque id;
`src/desktop/library.ts` `openLibraryEntry(id)` is the panel's seam into the entry's normal
batch/admission/notice path (`openFromLibrary` in `main.ts`). Palette commands:
`library.pinDocument`, `library.addProject`, `library.clear` (confirms first). The panel UI is
the shell's (S4 panel half).

Live reload: `native.onFilesChanged(tokens)` drives `followChange(token)` in
`main.ts`. A clean document re-reads with `adopt: true` and `DesktopDocuments.applyReload`
replaces its text and baseline (the reader re-renders; S2c's block patching and change
flash will replace the full re-render). A dirty document re-reads with `adopt: false`,
is marked `disk: "changed"` and shows the `.file-conflict` bar (Reload / Keep mine /
Save As) next to the notice line; Keep mine hides it for that token until the next
change. `missing` keeps the text and reports it.

`desktop.html` and `vite.desktop.config.ts` build a separate `dist-desktop` entry.
`src/desktop/main.ts` starts a continuous, sanitized reader with no editor, Paged.js,
service worker or Pulseboard SDK. Rich rendering shares highlighter/Markdown/KaTeX
and sanitized Mermaid preparation, but does not call the pagination source builder;
footnotes remain natural endnotes. Reader renders are serialized because Mermaid is
not re-entrant, and generation checks prevent late results replacing newer selection.

`ReaderSession` keeps up to 32 documents / 25,000,000 UTF-8 bytes in memory. Browser
file pickers and drops, native picker results and second-instance launch batches all
pass through that session gate, including when the editing workspace is active.
Undo Close also checks the gate before consuming recovery; refusal retains the
latest offer. Editing an open document can free bytes for a later retry. Closing
another document replaces recovery, as in the web workspace.
Native reads also bound disk bytes, decoded bytes and queue length. A mode transition
queues incoming batches and preserves their focus generation. Returning from Edit &
PDF transfers exact current text, preserves dirty state and selection, flushes the
render scheduler, clears the Paged.js host and tears down the App. If edits exceed the
reader bound, the workspace remains open with a useful error so nothing is discarded.

After all documents, dirty baselines and active selection transfer successfully,
the old reader session releases its sources. Workspace baselines are pruned against
the current store on each document-set change, and cleared after successful teardown.
An unknown identity (including Undo's fresh ID) stays conservatively dirty. Title
and hidden reader document-picker metadata follow the workspace while it owns the
documents, including queued imports. Return admission runs before any removal;
a failed teardown flush restores the same document objects, IDs, selection and
baselines so the user can retry. The temporary rollback snapshot ends with that
transition. The separate one-close recovery source is released by Discard, a later
close or workspace teardown. These ownership rules do not claim a total heap cap.
The App subtree is inert during entry as well as return. Entry keeps it visible
for layout but unavailable until the initial flush completes, then releases the
guard, drains queued imports and focuses the current editor. Desktop also captures
action clicks during mode changes (including shortcut-generated clicks), so new
edits, sample loads or native saves cannot race the handoff. The interaction guard
is released in `finally`, including mount/flush failures. Reading view and New
derive availability from the same transition/export/native-save state; an immediate
idle export notification cannot expose them during entry. The Windows smoke polls
visible, enabled UI Automation controls and records/rechecks that state before
invocation, with no fixed settling delay or replayed Save action. See
`docs/design/2026-11-05-desktop-workspace-readiness.md` for the retained failure and
deterministic delayed-render regression.

`App.init(root, { inputHandlers?: boolean, openFilePicker?: () => void, canRestoreDocument?: RestoreAdmission, createDocument?: () => void, layoutInitiallyOpen?: boolean })` retains the
ordinary web defaults. Desktop disables App's second input adapter and supplies its
own picker; both modes use one bounded importer. The web fallback caches the genuine
body file input before authored IDs can collide with it. The desktop passes its
cached application root explicitly and clears the reading DOM before App mounts its
canonical IDs. Dirty document close requires confirmation; native window close and
mode return are blocked during an export or mode transition.
`tests/desktop-lifetime.test.ts` exercises real entry-point ownership with rendering
and host boundaries stubbed; `tests/desktop-e2e/recovery.spec.ts` drives actual
production controls for count/UTF-8-byte refusal, retry and dirty round trips.

Desktop owns New from the reader toolbar, empty state, workspace toolbar and
Ctrl/Cmd+N. `App.init` forwards its optional `createDocument` callback through
`buildShell` and `mountToolbar`; the ordinary web entry omits it. Desktop also
passes `layoutInitiallyOpen: false` through that same shell boundary. This is a
transient initial disclosure preference, not a persisted setting. One-click
expansion and Escape focus return retain every document layout setting, Markdown
source, paginated sheet identity and export behavior. See
`tests/desktop-toolbar.test.ts` and `tests/desktop-e2e/toolbar.spec.ts`.
`nextUntitledName(docs: readonly { name: string }[]): string` chooses the first
available case-insensitive `Untitled.md` / `Untitled N.md` name. Creation admits
through the current 32-document / 25,000,000 UTF-8-byte limits, records a clean
empty baseline and preserves prior sources. A refusal preserves selection and
content. Reader creation enters the lazy workspace; a mount failure retains its
sources for retry. New reveals a Preview-only source pane and preserves existing
Markdown/Split layout. Mode transitions, export and native save block creation;
interaction generations keep older opens passive. Save Copy baseline semantics are
unchanged. Coverage: `tests/desktop-new-document.test.ts`,
`tests/desktop-e2e/new-document.spec.ts` and the existing shortcut suites.

The optional `src/export/destination.ts` Blob destination is installed only by the
native entry. The web build retains browser source downloads and jsPDF save. Source
save awaits the native result; PDF export holds its existing render lease until that
result settles. `SaveCanceled` releases the lease and reports cancellation without a
fatal error or successful-export event. The Windows host accepts bounded raw bytes
and a safe basename through `save_export`, opens a native dialog off the WebView2
callback thread, and writes only its explicitly selected path via atomic replacement.
It never accepts a write path from JavaScript. Cancel and failed writes preserve any
existing destination. Exports over 128 MiB fail before the frontend IPC allocation;
Rust independently enforces the same cap. Generic browser downloads are denied in
the native host, avoiding modal UI inside WebView2's synchronous download callback.

Tauri capabilities expose only selected-file input, pending launch input, explicit
HTTP(S) link opening, explicit export saving, event listening and guarded window
close. There is no general filesystem, shell or network API. The host denies external
navigation and new windows; production CSP permits bundled assets, IPC and required
print blobs only. Source/Cargo locks and versioned license provenance accompany both
the per-user installer and portable artifact. Windows CI tests the actual executable
and records the complete associated WebView2 process tree. This does not establish a
comparative RAM target, install/default-app acceptance or signed-release readiness.
See `../WINDOWS_DESKTOP.md`, `WINDOWS_READER.md` and `../../src-tauri/README.md`.


Native smoke worker bootstrap has a separate bounded allowance: 30 seconds through
framework/helper readiness, then eight seconds for UI operations, always capped by
the existing 45-second action and 180-second overall defaults. Phase updates never
renew the budget; timeout fails with classified diagnostics instead of repeatedly
restarting an unknown worker. The existing Windows path runs the pure deadline
policy tests and still requires actual rendered headings, single-instance routing,
owned native Save dialogs and exact saved Markdown/PDF bytes. See
`NATIVE_SMOKE_BOOTSTRAP.md`; these are harness limits, not app performance claims.

Reader text first (`src/desktop/render.ts`). `renderReaderDocument(text, settings,
fileName?, paint?)` parses and renders synchronously with fences as plain-text
placeholders (`pre.shiki.reader-pending` holding Shiki's own `span.line` structure, so
heights match within a pixel), hands that document to `paint` and marks
`mdv:reader-text`. It then loads the reader highlighter, replaces each placeholder still
in the live root with its sanitized highlighted fence, runs `renderAllMermaid` on the live
root and marks `mdv:reader-rich`. All of this stays inside main's serialized
`renderChain`, so Mermaid is never re-entered and an obsolete render's `paint` returns
null. A highlighter failure leaves readable plain code and a warning. Without `paint`
the returned document is complete. `src/desktop/reader/patch.ts` `patchDocument(live,
next)` is the `paint` step for re-rendering an open document: top-level blocks whose
source text is unchanged keep their live node (highlighted code, figures) with line
ranges moved; only the others are replaced and upgraded. Live reload (S1c) and Edit (S5)
are its callers. Coverage: `tests/desktop-e2e/text-first.spec.ts` (first text under
100 ms for the sample in the production build; code heights within 1 px),
`tests/reader-patch.test.ts`.

Actionable Markdown, A1 (static; `docs/design/ACTIONABLE_MARKDOWN.md`).
`src/render/actionable.ts` is DOM-free: `parseActionable(text, tokens?)` finds marks, choices
(grouped per list), fields, front matter chips and ids from the CommonMark block parse (never in
code or HTML blocks), the `marks:` cycle and the `actionable:` version; `planChange` and
`applyPatches` produce and apply byte-exact line patches (BOM, every terminator and the final
newline kept). `src/render/actionableGlyphs.ts`, in `createMarkdown`, draws `[/] [-] [!] [?]`
and `( ) (x)` as named static glyphs in both pipelines; `[ ]`/`[x]` stay with task lists, so
ordinary documents render unchanged. The reader (`src/desktop/reader/actionable.ts`) labels field
keys, shows chips above the document and reports actionable problems on the Properties card; the
paginated output keeps fields as text and omits chips with the front matter. Nothing is
interactive yet (A3). Conformance: `tests/fixtures/actionable/*` (byte-exact, `-text` in
`.gitattributes`), `tests/actionable.test.ts`, `tests/desktop-e2e/actionable.spec.ts`.

Reader source map and copy (`src/desktop/reader/{sourcemap,copy}.ts`). After parsing,
the reader stamps every block token with `data-src="start-end"` (1-based, inclusive,
clamped, trailing blank lines dropped) and stamps the rules that print their own tag
(fences, display math, callouts). The paginated pipeline never installs it, so its
output is unchanged. Fence bodies are captured before rendering because Shiki's notation
transformers rewrite token content. Each fenced code block gets a Copy button (shown on
hover and focus) that copies the fence body exactly; top-level headings get Copy link
(`name.md#id`) and Copy section as Markdown (to the next heading of the same or higher
level). Ctrl/Cmd+Shift+C copies the source lines of every block the selection touches;
Ctrl+C stays the browser default. Heading buttons hold no text so heading text and the
outline are unchanged. Copy path and Copy reference wait for display paths (S0) and the
command palette (S3). Coverage: `tests/reader-sourcemap.test.ts`,
`tests/desktop-e2e/copy.spec.ts` (asserts the text the app writes; the OS clipboard is
shared machine state on Windows hosts).

Reader shell (S3; `src/desktop/shell/*`, `desktop.html`). With a document open the window
shows one 40 px bar (Library and outline toggle, document tabs, Edit & PDF, More), the document
and a 24 px status line (display path or name, words, a ~4-characters-per-token estimate, save
state). Every former control is a registered command: the More menu, the Ctrl+K palette and
the shortcuts read the same registry (`commands.ts`). Tabs replace the document picker (APG
tabs with automatic activation; Delete or Ctrl+W closes; close buttons sit beside each tab);
a tab's filled dot means unsaved changes, while the Library's hollow diamond means changed on
disk since last viewed, each with a name and a tooltip. Ctrl+P runs the paginated Print / Save as
PDF path (entering the workspace if needed); the webview's own print of the reading view never
runs. The More menu offers Save only when there is something to save; Ctrl+S still explains
why not. The left panel (Library in the native app, Outline) and the palette are separate
chunks loaded on first use, after the first document paints. Below 860 px the panel is a
drawer that Escape closes. `Settings.followSystemTheme` follows Windows light or dark.
Pin on top calls `setAlwaysOnTop` and needs the window capability. Coverage:
`tests/desktop-e2e/shell.spec.ts`, `tests/helpers/desktopTabs.ts` for the jsdom suites.

## 15. Reader-only syntax-engine admission

The continuous reader parses once with `createMarkdown(null, settings)`. It inspects actual
`fence` tokens (including their nested children), not fence-shaped source lines. Prose,
math, Mermaid-only documents and ordinary plaintext/unknown fences do not initialize Shiki
or request its WASM, themes or grammars. Actual supported code fences await the shared
highlighter with only their requested grammar modules and those modules' embedded language
dependencies. Explicit line numbering, case-insensitive notation directives or
fence metadata also enable the existing code transformers, including for plaintext.

`getReaderHighlighter(languages)` normalizes and deduplicates grammar labels, prepares
those modules alongside the shared engine, and retains all eleven existing themes.
Plaintext transformers request an empty grammar list. Concurrent aliases share one pending
registration per engine; failed registrations can be retried. `getHighlighter()` has a
separate readiness promise that still prepares all sixteen common workspace grammars.
Reader-first, workspace-first and concurrent handoffs reuse the same engine; failed engine
or workspace preparation does not permanently cache a rejection.

Grammar modules with optional embedded languages also await the existing common workspace
set before rendering. With the pinned grammar bundle this applies to Markdown, Ruby
(through its HAML member), Vue, Svelte and LaTeX. It preserves previously available embedded
syntax colors without adding a separate language resolver. Workspace preparation bypasses
this compatibility step, avoiding a dependency on its own readiness promise.

`installMarkdownHighlighter(md, hl, settings)` installs the synchronous highlight callback
on that same parser; it does not parse or replace the structural plugin stack.
`renderMarkdownTokens(md, tokens, env)` must receive the exact tokens and environment from
that parser's parse. This retains heading, TOC, footnote and math plugin state and applies
the same sanitization and warning pass as `renderMarkdown(md, src)`. The latter remains the
public synchronous convenience path and delegates to parse plus token rendering. Unknown-language
warnings now describe real parsed fences, not examples inside code or HTML blocks.
`parsedFenceLanguages(md, tokens)` returns distinct normalized labels in parser traversal
order. Language and transformer admission decode fence-info escapes and character references
with that parser's `utils.unescapeAll`, matching markdown-it's fence renderer. Warnings use
those same decoded language labels.

Shared fence rendering applies that same case and optional `language-` prefix normalization
to Shiki and Mermaid. Shiki's highlight callback already receives a decoded label, so it
must not decode again: `&amp;#109;ermaid` stays an unknown literal label. Existing lowercase
aliases such as `cs` retain their rendered classes, and code metadata remains unchanged.

The paginated workspace uses the same parsed-fence preparation and late Shiki installation
before the unchanged no-slice layout stages in section 3. No document tokens are cached or persisted. This
change proves avoided engine initialization and asset requests, not a measured RAM or
startup-time improvement. Unit admission/transformer controls and production browser asset
checks live in `tests/desktop-lazy-highlight.test.ts` and `tests/desktop-e2e/startup.spec.ts`.
Real-engine language/dependency, handoff and retry controls live in
`tests/highlight-reader.test.ts`. The browser request audit checks that a C# reader leaves
unrelated common grammar assets unloaded until Edit & PDF prepares the workspace.
