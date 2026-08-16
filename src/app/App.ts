/**
 * App controller — owns Settings + DocStore and drives the load-bearing render pipeline.
 *
 * Responsibilities:
 *  - Build the application shell DOM (toolbar / workspace / editor / splitter / canvas /
 *    empty-state / overlays / banner).
 *  - Coalesce render requests through the debounced scheduler (settings 120ms, content 250ms),
 *    which also serializes them: pagination owns one shared host, so runs must never overlap.
 *    Exports call `flushRender()` first so they can never emit stale pages.
 *  - Run `runPipeline` in the EXACT order mandated by IMPLEMENTATION_SPEC §3. Pagination is
 *    always last, exactly once, after every async height-affecting step settles.
 *  - Swap empty / loaded / error panes, surface render warnings, and keep the last good
 *    render on screen if a later render throws.
 *  - Apply CSS-only setting changes (screen theme, code-theme family) without repaginating.
 *
 * Local-first: no network calls, no document persistence — only `Settings` round-trips
 * through localStorage.
 */

import { ensureMarkdownLanguages, getHighlighter } from "../render/highlight";
import { createMarkdown, renderMarkdown } from "../render/markdown";
import type { RenderWarning } from "../render/markdown";
import { renderAllMermaid } from "../render/mermaid";
import {
  buildPaginationSource,
  awaitFontsAndImages,
  stampAtomicBlocks,
} from "../render/buildSource";
import { buildStylesheet } from "../paginate/cssBuilder";
import { paginate } from "../paginate/paginate";
import { registerHandlersOnce, setPaginationProgress } from "../paginate/handler";
import { measurePageArea } from "../paginate/measure";
import { exportViaPrint } from "../export/print";
import { exportPaginatedToPdf } from "../export/download";
import { mountToolbar } from "../ui/Toolbar";
import { mountCanvas } from "../ui/Canvas";
import type { CanvasController, CanvasPosition } from "../ui/Canvas";
import { mountEditor } from "../ui/Editor";
import type { EditorController } from "../ui/Editor";
import { mountSplitter } from "../ui/Splitter";
import type { SplitterController } from "../ui/Splitter";
import { mountEmptyState } from "../ui/EmptyState";
import { mountBanner } from "../ui/Banner";
import { DocStore, hasProtectableWork } from "./state";
import type { RenderReason, RenderScheduler } from "./state";
import { createRenderScheduler } from "./state";
import { loadSettings, saveSettings } from "./settings";
import type { Settings } from "./settings";
import { IDS, ATTRS, SPLIT_RATIO_VAR, el } from "./dom";
import { installInputHandlers } from "./input";
import { SAMPLE_MARKDOWN } from "./sampleDoc";

/** Which settings, when changed, require a full re-pagination (heights move). */
const REFLOW_KEYS: ReadonlyArray<keyof Settings> = [
  "codeTheme",
  "docFont",
  "fontSizePt",
  "paperSize",
  "margins",
  "showToc",
  "showPageNumbers",
  "runningHeader",
  "showLineNumbers",
];

type Pane = "empty" | "loaded" | "error";

/** What the export controls need to know to render themselves correctly. */
export interface ExportState {
  /** An export is in flight — both buttons must be inert until it settles. */
  busy: boolean;
  /** At least one document is open, so there is something to export at all. */
  hasDocument: boolean;
}

export class App {
  settings: Settings;
  store: DocStore;

  private root: HTMLElement;
  private toolbar!: { destroy(): void };
  private canvas!: CanvasController;
  private editor!: EditorController;
  private splitter!: SplitterController;
  private emptyState!: { destroy(): void };
  private banner!: { warn(w: RenderWarning[]): void; fatal(msg: string): void; clear(): void };

  private workspaceEl!: HTMLElement;
  private emptyEl!: HTMLElement;

  private scheduler!: RenderScheduler;
  private detachInput: (() => void) | null = null;
  private settingsListeners = new Set<(settings: Readonly<Settings>) => void>();
  private exportListeners = new Set<(state: ExportState) => void>();
  private detachBeforeUnload: (() => void) | null = null;
  /** True between the start and the end of an export (either path). */
  private exportBusy = false;

  /** Monotonic token so a slow render can't overwrite a newer one (last-write-wins). */
  private renderToken = 0;
  /** True once at least one successful pagination has painted (so errors keep last good). */
  private hasGoodRender = false;
  private currentPane: Pane = "empty";

  private constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    this.store = new DocStore();
  }

  static init(root: HTMLElement): App {
    const app = new App(root);
    app.buildShell();
    app.applyThemeAttributes();
    app.applyViewMode();

    // Ingestion → store. The store's "change" event triggers a content render.
    app.detachInput = installInputHandlers(app.store, {
      onReject: (names) => app.onReject(names),
      onLargeFile: (bytes) => app.confirmLargeFile(bytes),
    });

    // "change" = a different document is active → re-seed the editor and re-render.
    app.store.on("change", () => {
      app.editor.setDocument(app.store.active);
      app.emitExportState();
      app.scheduleRender("content");
    });
    // "text" = the active document was edited in the editor. The editor is already
    // showing that text, so only the pipeline needs waking.
    app.store.on("text", () => app.scheduleRender("content"));

    // Debounced + serialized scheduler wraps the async pipeline. Serialization is the
    // load-bearing half: two overlapping runPipeline calls would share one Paged.js
    // host and page counter (see createRenderScheduler).
    app.scheduler = createRenderScheduler((reason) => app.runPipeline(reason));

    // Nothing is persisted (local-first), so a reload silently destroys whatever is
    // open. Warn — but only when there is real work to lose, never for the pristine
    // bundled sample (UX-6).
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!hasProtectableWork(app.store.openDocs, SAMPLE_MARKDOWN)) return;
      event.preventDefault();
      // Chromium still requires a truthy returnValue to arm the native dialog.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    app.detachBeforeUnload = () => window.removeEventListener("beforeunload", onBeforeUnload);

    return app;
  }

  /**
   * Build the shell. Each `mount*` helper creates its own canonically-id'd root
   * element (#toolbar, #editor-pane, #split-handle, #canvas, #empty-state,
   * #warning-banner, #error-card), so App only decides WHERE those roots attach —
   * it never re-creates those ids itself.
   *
   * Layout (matches the CSS grids in app.css / editor.css, overlays in preview.css):
   *   #app  (grid: auto 1fr)
   *     #toolbar                     row 1
   *     #workspace                   row 2 (grid: editor | handle | preview)
   *       #editor-pane               Markdown source (mountEditor)
   *       #split-handle              draggable divider (mountSplitter)
   *       #canvas                    scroll container, position: relative
   *         #paged-output, page chip, zoom, paginating overlay, #status-live  (mountCanvas)
   *         #empty-state             absolute overlay (mountEmptyState)
   *         #warning-banner, #error-card  overlays (mountBanner)
   *         #drag-overlay            fixed overlay
   *
   * `data-view-mode` on #workspace decides which of the three columns are shown; the
   * panes are always mounted so switching modes never rebuilds or re-renders anything.
   */
  private buildShell(): void {
    // Row 1 then row 2 — append order defines the grid rows.
    this.toolbar = mountToolbar(this.root, this);

    this.workspaceEl = el("div", { id: IDS.workspace, class: "workspace" });
    this.root.append(this.workspaceEl);

    // Column order inside the workspace: source, divider, preview.
    this.editor = mountEditor(this.workspaceEl, {
      codeTheme: this.settings.codeTheme,
      onInput: (text) => this.onEditorInput(text),
    });
    this.splitter = mountSplitter(this.workspaceEl, {
      track: this.workspaceEl,
      initialRatio: this.settings.splitRatio,
      onPreview: (ratio) => this.applySplitRatio(ratio),
      onCommit: (ratio) => this.updateSettings({ splitRatio: ratio }),
    });
    // Zoom is CSS-only: it routes through updateSettings (persisted, aria-pressed
    // synced) but is absent from REFLOW_KEYS, so it can never trigger a re-paginate.
    this.canvas = mountCanvas(this.workspaceEl, {
      onZoom: (zoom) => this.updateSettings({ zoom }),
    });

    const canvasEl = document.getElementById(IDS.canvas);
    if (!canvasEl) throw new Error("MDviewer: canvas failed to mount");

    // Overlays live inside #canvas so their absolute positioning anchors to it.
    this.emptyState = mountEmptyState(
      canvasEl,
      () => this.openFilePicker(),
      () => this.loadSample(),
    );
    const emptyEl = document.getElementById(IDS.emptyState);
    if (!emptyEl) throw new Error("MDviewer: empty-state failed to mount");
    this.emptyEl = emptyEl;

    this.banner = mountBanner(canvasEl);

    const dragOverlay = el(
      "div",
      {
        attrs: { id: IDS.dragOverlay, "aria-hidden": "true" },
        class: "drag-overlay",
        hidden: true,
      },
      el(
        "div",
        { class: "drag-frame" },
        el("div", { class: "drag-icon", attrs: { "aria-hidden": "true" } }, "⬇"),
        el("div", { class: "drag-title" }, "Release to open"),
      ),
    );
    canvasEl.append(dragOverlay);

    this.canvas.setZoom(this.settings.zoom);
    this.showPane("empty");
  }

  /** Apply persisted zoom + theme attributes on the relevant roots. */
  private applyThemeAttributes(): void {
    document.documentElement.setAttribute(ATTRS.appTheme, this.settings.screenTheme);
    const out = document.getElementById(IDS.pagedOutput);
    if (out) out.setAttribute(ATTRS.codeTheme, this.settings.codeTheme);
  }

  /**
   * Reflect the current view mode + split ratio on the workspace. Both are pure CSS
   * state: no pane is unmounted and no re-pagination is needed, because the paginated
   * sheets are sized in millimetres from the @page rules, not from the canvas width.
   */
  private applyViewMode(): void {
    this.workspaceEl.setAttribute(ATTRS.viewMode, this.settings.viewMode);
    this.applySplitRatio(this.settings.splitRatio);
  }

  private applySplitRatio(ratio: number): void {
    this.workspaceEl.style.setProperty(SPLIT_RATIO_VAR, String(ratio));
  }

  /**
   * The editor's write path. Editing an open document mutates it in place; typing into
   * an empty app creates an untitled document so the first keystroke already produces a
   * live preview. Text never leaves memory — nothing is written to storage.
   */
  private onEditorInput(text: string): void {
    const active = this.store.active;
    if (active) {
      this.store.updateText(active.id, text);
      return;
    }
    if (!text) return;
    this.store.add("Untitled.md", text);
  }

  /** Public: request a render. Reason picks the debounce window. */
  scheduleRender(reason: RenderReason): void {
    this.scheduler.schedule(reason);
  }

  /**
   * Public: settle the preview against the current text — run any debounced render
   * now and wait for the in-flight one. Both exports read the paginated host directly,
   * so without this an export fired within the 250ms content debounce (or while a long
   * pagination is still running) would hand out the *previous* pages: the newest edits
   * silently missing, or an empty PDF for a document that has only just been typed.
   */
  async flushRender(): Promise<void> {
    await this.scheduler.flush();
  }

  /**
   * Public: merge a settings patch, persist it, and react. CSS-only changes (screen theme,
   * same-family code light/dark flip) update attributes without repaginating; structural
   * changes schedule a settings re-pagination.
   */
  updateSettings(patch: Partial<Settings>): void {
    const prev = this.settings;
    const next: Settings = { ...prev, ...patch };
    this.settings = next;
    saveSettings(next);
    for (const listener of this.settingsListeners) listener(next);

    // Always reflect theme attributes immediately (cheap, no reflow).
    if (patch.screenTheme !== undefined) {
      document.documentElement.setAttribute(ATTRS.appTheme, next.screenTheme);
    }
    if (patch.codeTheme !== undefined) {
      const out = document.getElementById(IDS.pagedOutput);
      if (out) out.setAttribute(ATTRS.codeTheme, next.codeTheme);
      this.editor.setCodeTheme(next.codeTheme);
    }
    if (patch.zoom !== undefined) {
      this.canvas.setZoom(next.zoom);
    }
    // Layout-only state: pure CSS, never a reflow (see applyViewMode).
    if (patch.viewMode !== undefined) {
      this.workspaceEl.setAttribute(ATTRS.viewMode, next.viewMode);
    }
    if (patch.splitRatio !== undefined) {
      this.applySplitRatio(next.splitRatio);
      this.splitter.sync(next.splitRatio);
    }

    // Does this patch touch anything that changes laid-out heights?
    const needsReflow = REFLOW_KEYS.some(
      (k) => patch[k] !== undefined && patch[k] !== prev[k],
    );
    if (needsReflow) this.scheduleRender("settings");
  }

  /** Subscribe UI surfaces to settings changes, including programmatic updates. */
  onSettingsChange(listener: (settings: Readonly<Settings>) => void): () => void {
    this.settingsListeners.add(listener);
    return () => this.settingsListeners.delete(listener);
  }

  /**
   * Subscribe the export controls to their own availability. Mirrors the
   * onSettingsChange pattern; fires immediately with the current state so a fresh
   * subscriber never has to duplicate the initial sync.
   */
  onExportStateChange(listener: (state: ExportState) => void): () => void {
    this.exportListeners.add(listener);
    listener(this.exportState);
    return () => this.exportListeners.delete(listener);
  }

  get exportState(): ExportState {
    return { busy: this.exportBusy, hasDocument: this.store.openDocs.length > 0 };
  }

  private emitExportState(): void {
    const state = this.exportState;
    for (const listener of this.exportListeners) listener(state);
  }

  private setExportBusy(busy: boolean): void {
    if (this.exportBusy === busy) return;
    this.exportBusy = busy;
    this.emitExportState();
  }

  /** Open the hidden file input dialog. */
  openFilePicker(): void {
    const input = document.getElementById(IDS.fileInput) as HTMLInputElement | null;
    input?.click();
  }

  /** Load the bundled sample document through the normal store path. */
  loadSample(): void {
    this.store.add("Sample.md", SAMPLE_MARKDOWN);
  }

  /** Trigger the primary (vector) print export. */
  async exportPrint(): Promise<void> {
    if (this.exportBusy) return;
    this.setExportBusy(true);
    try {
      // Export what the user can see, not what the host happens to still hold.
      await this.flushRender();
      await exportViaPrint(this.canvas.host);
    } finally {
      this.setExportBusy(false);
    }
  }

  /**
   * Trigger the fallback (rasterized) PDF export. Rasterizing is a long blocking
   * loop, so this owns the user-facing feedback: both export buttons go inert, the
   * canvas overlay reports the page being rendered, and #status-live carries the
   * same story for assistive tech — sampled, not once per page, so a 60-page export
   * does not turn into 60 announcements.
   */
  async exportPdf(): Promise<void> {
    if (this.exportBusy) return;
    this.setExportBusy(true);
    try {
      await this.flushRender();
      const name = this.store.active?.name ?? "document";
      const base = name.replace(/\.(md|markdown)$/i, "") || "document";
      this.canvas.setBusy(true, "Preparing PDF…");
      this.announce("Preparing PDF export…");
      try {
        await exportPaginatedToPdf(this.canvas.host, this.settings, {
          fileName: `${base}.pdf`,
          onProgress: (done, total) => {
            this.canvas.setBusy(true, `Rendering page ${done} of ${total}…`);
            if (done === 1 || done === total || done % 5 === 0) {
              this.announce(`Rendering page ${done} of ${total}.`);
            }
          },
        });
        this.announce("PDF downloaded.");
      } catch (err) {
        this.banner.fatal(`PDF export failed: ${errorMessage(err)}`);
      } finally {
        this.canvas.setBusy(false);
      }
    } finally {
      this.setExportBusy(false);
    }
  }

  // ---- pipeline ------------------------------------------------------------

  /**
   * THE load-bearing render order (§3). Steps 0–6 prepare a DocumentFragment whose heights
   * are final; step 7 paginates exactly once. Resilient: on failure we surface the error
   * but keep the last good render painted.
   */
  private async runPipeline(_reason: RenderReason): Promise<void> {
    const doc = this.store.active;
    if (!doc) {
      this.showPane("empty");
      this.hasGoodRender = false;
      this.banner.clear();
      return;
    }

    const token = ++this.renderToken;
    const stale = (): boolean => token !== this.renderToken;

    // Where the reader is right now. Pagination tears the host down, which collapses
    // scrollTop to 0, so without this every tweak (and every keystroke past the
    // debounce) throws the reader back to page 1 (UX-4 ii). Both reasons restore:
    // a settings change and an edit are equally disorienting to lose your place in.
    const restoreTo: CanvasPosition | null = this.hasGoodRender
      ? this.canvas.capturePosition()
      : null;

    // The empty pane sits UNDER the 70%-alpha paginating overlay (z-10 vs z-40), so
    // leaving it up during the first pagination shows the dropzone card ghosted
    // through the spinner (UX-4 iii). A document exists, so it has no business here.
    this.emptyEl.hidden = true;

    this.canvas.setPaginating(true);

    try {
      // 0 — raw markdown
      const src = doc.text;

      // 1 — highlighter singleton (await once)
      const hl = await getHighlighter();
      if (stale()) return;

      // Pre-load curated fenced-code grammars before markdown-it's synchronous render.
      await ensureMarkdownLanguages(hl, src);
      if (stale()) return;

      // 2 — markdown → html (SYNC: Shiki via fromHighlighter + KaTeX inline)
      const md = createMarkdown(hl, this.settings);
      const { html, warnings } = renderMarkdown(md, src);

      // 3 — pagination source (inject TOC nav; end-of-doc footnotes → inline float spans)
      const source = buildPaginationSource(html, this.settings);

      // 4 — async Mermaid → fixed-size SVG figures
      // SVG is shared by preview and print, so keep it light/theme-independent.
      const mermaidResult = await renderAllMermaid(source, "default");
      if (stale()) return;

      // Stable source identities make cross-page clone/split verification honest.
      stampAtomicBlocks(source);

      // 5 — fonts + images settle so heights are final
      await awaitFontsAndImages(source);
      if (stale()) return;

      // 6 — fully prepared source. We pass it directly to paginate; the next
      //     render rebuilds a fresh fragment, so no baked transforms persist.

      // 7 — PAGINATION LAST
      await registerHandlersOnce(() => measurePageArea(this.settings));
      if (stale()) return;
      const css = buildStylesheet(this.settings);
      // Paged.js gives no progress signal; its per-page handler hook is the only one.
      setPaginationProgress((page) => {
        if (!stale()) this.canvas.setProgress(page);
      });
      let flow;
      try {
        flow = await paginate(source, css, this.canvas.host);
      } finally {
        setPaginationProgress(null);
      }
      if (stale()) return;

      // Success: swap to loaded pane, report page count + warnings.
      this.hasGoodRender = true;
      this.showPane("loaded");
      this.canvas.setPageCount(flow.total);
      // Put the reader back where they were, clamped to the new page count.
      this.canvas.restorePosition(restoreTo);
      this.announce(`Document paginated into ${flow.total} ${flow.total === 1 ? "page" : "pages"}.`);

      const allWarnings = withMermaidWarnings(warnings, mermaidResult.failed);
      if (allWarnings.length > 0) this.banner.warn(allWarnings);
      else this.banner.clear();
    } catch (err) {
      if (stale()) return;
      // Keep the last good render on screen; surface a fatal banner over it.
      this.banner.fatal(`Render failed: ${errorMessage(err)}`);
      if (!this.hasGoodRender) this.showPane("error");
    } finally {
      if (!stale()) this.canvas.setPaginating(false);
    }
  }

  // ---- pane / aria helpers -------------------------------------------------

  private showPane(pane: Pane): void {
    this.currentPane = pane;
    // The canvas is always present; #empty-state overlays it until a document loads.
    this.emptyEl.hidden = pane !== "empty";
    if (pane !== "error") {
      const errorCard = document.getElementById(IDS.errorCard);
      if (errorCard) errorCard.hidden = true;
    }
  }

  private onReject(names: string[]): void {
    const list = names.join(", ");
    this.banner.warn([
      {
        kind: "lang",
        message:
          names.length === 1
            ? `Skipped “${list}” — only .md and .markdown files are supported.`
            : `Skipped ${names.length} files (${list}) — only .md and .markdown are supported.`,
      },
    ]);
  }

  private async confirmLargeFile(bytes: number): Promise<boolean> {
    const mb = (bytes / 1_000_000).toFixed(1);
    return Promise.resolve(
      window.confirm(
        `This document is about ${mb} MB. Pagination may briefly freeze the page. Open it anyway?`,
      ),
    );
  }

  private announce(message: string): void {
    const live = document.getElementById(IDS.statusLive);
    if (live) live.textContent = message;
  }

  /** Move keyboard focus into the Markdown source pane. */
  focusEditor(): void {
    this.editor.focus();
  }

  /** Detach global listeners — used by tests/teardown. */
  destroy(): void {
    this.detachInput?.();
    this.detachInput = null;
    this.detachBeforeUnload?.();
    this.detachBeforeUnload = null;
    this.toolbar.destroy();
    this.splitter.destroy();
    this.editor.destroy();
    this.emptyState.destroy();
    this.canvas.destroy();
    this.settingsListeners.clear();
    this.exportListeners.clear();
  }

  get pane(): Pane {
    return this.currentPane;
  }
}

/** Append a synthesized diagram warning when Mermaid blocks failed. */
function withMermaidWarnings(warnings: RenderWarning[], failed: number): RenderWarning[] {
  if (failed <= 0) return warnings;
  return [
    ...warnings,
    {
      kind: "diagram",
      message:
        failed === 1
          ? "One Mermaid diagram failed to render and was replaced with its source."
          : `${failed} Mermaid diagrams failed to render and were replaced with their source.`,
    },
  ];
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error.";
}
