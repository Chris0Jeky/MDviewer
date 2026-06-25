/**
 * App controller — owns Settings + DocStore and drives the load-bearing render pipeline.
 *
 * Responsibilities:
 *  - Build the application shell DOM (toolbar / canvas / empty-state / overlays / banner).
 *  - Coalesce render requests through the debounced scheduler (settings 120ms, content 250ms).
 *  - Run `runPipeline` in the EXACT order mandated by IMPLEMENTATION_SPEC §3. Pagination is
 *    always last, exactly once, after every async height-affecting step settles.
 *  - Swap empty / loaded / error panes, surface render warnings, and keep the last good
 *    render on screen if a later render throws.
 *  - Apply CSS-only setting changes (screen theme, code-theme family) without repaginating.
 *
 * Local-first: no network calls, no document persistence — only `Settings` round-trips
 * through localStorage.
 */

import { getHighlighter } from "../render/highlight";
import { createMarkdown, renderMarkdown } from "../render/markdown";
import type { RenderWarning } from "../render/markdown";
import { renderAllMermaid } from "../render/mermaid";
import type { MermaidTheme } from "../render/mermaid";
import { buildPaginationSource, awaitFontsAndImages } from "../render/buildSource";
import { buildStylesheet } from "../paginate/cssBuilder";
import { paginate } from "../paginate/paginate";
import { registerHandlersOnce } from "../paginate/handler";
import { measurePageArea } from "../paginate/measure";
import { exportViaPrint } from "../export/print";
import { exportPaginatedToPdf } from "../export/download";
import { mountToolbar } from "../ui/Toolbar";
import { mountCanvas } from "../ui/Canvas";
import { mountEmptyState } from "../ui/EmptyState";
import { mountBanner } from "../ui/Banner";
import { DocStore } from "./state";
import type { RenderReason } from "./state";
import { createRenderScheduler } from "./state";
import { loadSettings, saveSettings } from "./settings";
import type { Settings } from "./settings";
import { IDS, ATTRS, el } from "./dom";
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

/** Screen theme → Mermaid theme. The exported PDF is always light, but on-screen diagrams
 * should match the chrome; pagination uses the screen-derived theme since the SVG is fixed. */
function mermaidThemeFor(screen: Settings["screenTheme"]): MermaidTheme {
  return screen === "dark" ? "dark" : "default";
}

type Pane = "empty" | "loaded" | "error";

export class App {
  settings: Settings;
  store: DocStore;

  private root: HTMLElement;
  private toolbar!: { destroy(): void };
  private canvas!: {
    host: HTMLElement;
    setPaginating(b: boolean): void;
    setPageCount(n: number): void;
    setZoom(z: Settings["zoom"]): void;
  };
  private emptyState!: { destroy(): void };
  private banner!: { warn(w: RenderWarning[]): void; fatal(msg: string): void; clear(): void };

  private emptyEl!: HTMLElement;

  private scheduleRenderImpl!: (reason: RenderReason) => void;
  private detachInput: (() => void) | null = null;

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

    // Register Paged.js handlers exactly once; they read the live page area each run.
    registerHandlersOnce(() => measurePageArea(app.settings));

    // Ingestion → store. The store's "change" event triggers a content render.
    app.detachInput = installInputHandlers(app.store, {
      onReject: (names) => app.onReject(names),
      onLargeFile: (bytes) => app.confirmLargeFile(bytes),
    });

    app.store.on("change", () => app.scheduleRender("content"));

    // Debounced scheduler wraps the async pipeline.
    app.scheduleRenderImpl = createRenderScheduler((reason) => app.runPipeline(reason));

    return app;
  }

  /**
   * Build the shell. Each `mount*` helper creates its own canonically-id'd root
   * element (#toolbar, #canvas, #empty-state, #warning-banner, #error-card), so App
   * only decides WHERE those roots attach — it never re-creates those ids itself.
   *
   * Layout (matches the CSS grid in app.css / overlays in preview.css):
   *   #app  (grid: auto 1fr)
   *     #toolbar                     row 1
   *     #canvas                      row 2 (scroll container, position: relative)
   *       #paged-output, page chip, zoom, paginating overlay, #status-live  (mountCanvas)
   *       #empty-state               absolute overlay (mountEmptyState)
   *       #warning-banner, #error-card  overlays (mountBanner)
   *       #drag-overlay              fixed overlay
   */
  private buildShell(): void {
    // Row 1 then row 2 — append order defines the grid rows.
    this.toolbar = mountToolbar(this.root, this);
    this.canvas = mountCanvas(this.root);

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

  /** Public: request a render. Reason picks the debounce window. */
  scheduleRender(reason: RenderReason): void {
    this.scheduleRenderImpl(reason);
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

    // Always reflect theme attributes immediately (cheap, no reflow).
    if (patch.screenTheme !== undefined) {
      document.documentElement.setAttribute(ATTRS.appTheme, next.screenTheme);
    }
    if (patch.codeTheme !== undefined) {
      const out = document.getElementById(IDS.pagedOutput);
      if (out) out.setAttribute(ATTRS.codeTheme, next.codeTheme);
    }
    if (patch.zoom !== undefined) {
      this.canvas.setZoom(next.zoom);
    }

    // Does this patch touch anything that changes laid-out heights?
    const needsReflow = REFLOW_KEYS.some(
      (k) => patch[k] !== undefined && patch[k] !== prev[k],
    );
    if (needsReflow) this.scheduleRender("settings");
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
    await exportViaPrint(this.canvas.host);
  }

  /** Trigger the fallback (rasterized) PDF export. */
  async exportPdf(): Promise<void> {
    const name = this.store.active?.name ?? "document";
    const base = name.replace(/\.(md|markdown)$/i, "") || "document";
    try {
      await exportPaginatedToPdf(this.canvas.host, this.settings, {
        fileName: `${base}.pdf`,
      });
    } catch (err) {
      this.banner.fatal(`PDF export failed: ${errorMessage(err)}`);
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

    this.canvas.setPaginating(true);

    try {
      // 0 — raw markdown
      const src = doc.text;

      // 1 — highlighter singleton (await once)
      const hl = await getHighlighter();
      if (stale()) return;

      // 2 — markdown → html (SYNC: Shiki via fromHighlighter + KaTeX inline)
      const md = createMarkdown(hl, this.settings);
      const { html, warnings } = renderMarkdown(md, src);

      // 3 — pagination source (inject TOC nav; end-of-doc footnotes → inline float spans)
      const source = buildPaginationSource(html, this.settings);

      // 4 — async Mermaid → fixed-size SVG figures
      const mermaidResult = await renderAllMermaid(
        source,
        mermaidThemeFor(this.settings.screenTheme),
      );
      if (stale()) return;

      // 5 — fonts + images settle so heights are final
      await awaitFontsAndImages(source);
      if (stale()) return;

      // 6 — pristine clone for re-pagination without re-render (kept by paginate path)
      //     We pass `source` directly to paginate; Paged.js consumes a fresh fragment each
      //     run, and the next render rebuilds from scratch, so no baked transforms persist.

      // 7 — PAGINATION LAST
      const css = buildStylesheet(this.settings);
      const flow = await paginate(source, css, this.canvas.host);
      if (stale()) return;

      // Success: swap to loaded pane, report page count + warnings.
      this.hasGoodRender = true;
      this.showPane("loaded");
      this.canvas.setPageCount(flow.total);
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

  /** Detach global listeners — used by tests/teardown. */
  destroy(): void {
    this.detachInput?.();
    this.detachInput = null;
    this.toolbar.destroy();
    this.emptyState.destroy();
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
