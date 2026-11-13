import "../styles/document.css";
import "../styles/shiki.css";
import "./reader.css";
import "./shell/shell.css";
import { loadSettings, saveSettings } from "../app/settings";
import { SIZE_HARD_BYTES, SIZE_SOFT_BYTES, isMarkdownFile } from "../app/input";
import { SAMPLE_MARKDOWN } from "../app/sampleDoc";
import type { App } from "../app/App";
import type { Doc } from "../app/state";
import { native, type OpenBatch, type ReadResult, type SaveResult } from "./native";
import { decodeMarkdown, drainSerially, nextUntitledName } from "./session";
import { DesktopDocuments, type SaveTarget } from "./documents";
import { PdfTabs, isPdfFile, MAX_PDF_BYTES } from "./pdfs";
import type { PdfView } from "../pdf";
import { installShortcuts, registerCommand } from "./commands";
import { registerPanel } from "./panels";
import { mountTabs } from "./shell/tabs";
import { mountMenu, type MenuEntry } from "./shell/menu";
import { statusParts } from "./shell/status";
import { selectionRange } from "./reader/sourcemap";
import { setLibraryOpener } from "./library";
import { renderReaderDocument } from "./render";
import { dataDocumentKind, dataLabelOf, prepareRenderText, renderTextOf, showAllOf, showMoreOf } from "../app/renderText";
import { patchDocument } from "./reader/patch";
import type { EditorController, SplitterController } from "./edit";
import { mountSelectionCopy } from "./reader/copy";
import { dataCopy, dataReference, dataViewOf, hasValues, readableCopy, trackDataTarget, type DataCopyKind } from "./reader/dataCopy";
import { setControlHandler } from "./reader/controls";
import { createWriteback, type Notice } from "./reader/writeback";
import { SaveCanceled, setDownloadDestination } from "../export/destination";
import { downloadMarkdown } from "../export/markdown";
import { documentLabels } from "../ui/DocumentNavigation";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing reader element: ${id}`);
  return node as T;
}

const shell = element("reader-shell");
const content = element("reader-document");
const empty = element("reader-empty");
const outline = element("reader-outline");
const notice = element("reader-notice");
const workspaceNotice = element("workspace-notice");
const appRoot = element("app");
const scroll = element("reader-scroll");
const pdfHost = element("reader-pdf");
const status = element("reader-status");
const fileInput = element<HTMLInputElement>("reader-file-input");
const workspace = element("desktop-workspace");
const editHost = element("reader-edit");
const editToggle = element<HTMLButtonElement>("reader-edit-toggle");
const newButtons = [element<HTMLButtonElement>("reader-new-empty")];
const saveState = element("reader-save-state");
const panel = element("shell-panel");
const panelToggle = element<HTMLButtonElement>("shell-panel-toggle");
const returnButton = element<HTMLButtonElement>("reader-return");
const settings = loadSettings();
// The single owner of open documents across reading and the PDF workspace.
const docs = new DesktopDocuments();
// PDF tabs (PDF_WORKBENCH.md, P1). The view loads lazily; at most one is mounted at a time.
const pdfs = new PdfTabs();
let pdfView: { id: string; view: Promise<PdfView>; abort: AbortController } | null = null;
/** A PDF is shown when one is active and no reader document is. */
const pdfShown = (): boolean => !app && !!pdfs.active && !docs.reader.activeId;
const isPdfTab = (id: string): boolean => pdfs.tabs.some(tab => tab.id === id);
let app: App | null = null;
let detachWorkspace: (() => void) | null = null;
let changingMode = false;
let generation = 0;
let renderGeneration = 0;
let noticeGeneration = 0;
let renderChain: Promise<void> = Promise.resolve();
// Edit (S5): one source editor beside the reader, kept while hidden so undo survives a toggle.
let editor: EditorController | null = null;
let editing = false;
let editTimer: ReturnType<typeof setTimeout> | undefined;
let editSplitter: SplitterController | null = null;
let textSize = 17;
let nativeSaveBusy = false;
const queuedBatches: Array<{ batch: OpenBatch; request: number }> = [];
let renderedReaderId: string | null = null;
const tabs = mountTabs(element("shell-tabs"), { activate: activateDocument, close: closeDocumentById });

mountSelectionCopy(content);
trackDataTarget(content);

// Actionable Markdown (A3): a short non-modal notice offers Undo after a saved change.
const actionNotice = document.createElement("div");
actionNotice.className = "am-notice";
actionNotice.setAttribute("role", "status");
actionNotice.hidden = true;
document.body.append(actionNotice);
let actionNoticeTimer: ReturnType<typeof setTimeout> | undefined;
function showActionNotice(notice: Notice | null): void {
  clearTimeout(actionNoticeTimer);
  actionNotice.replaceChildren();
  actionNotice.hidden = !notice;
  if (!notice) return;
  const text = document.createElement("span");
  text.textContent = notice.text;
  actionNotice.append(text);
  if (notice.action) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "am-notice-action";
    action.textContent = notice.action.label;
    action.addEventListener("click", () => notice.action!.run());
    actionNotice.append(action);
  }
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "am-notice-close";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => { showActionNotice(null); writeback.forget(); });
  actionNotice.append(dismiss);
  // Long enough to reach Undo by keyboard; hovering or focusing it keeps it open.
  const hide = (): void => { if (actionNotice.matches(":hover, :focus-within")) { actionNoticeTimer = setTimeout(hide, 2000); return; }
    showActionNotice(null); writeback.forget(); };
  actionNoticeTimer = setTimeout(hide, 10_000);
}
const writeback = createWriteback({
  active: () => (app || changingMode ? undefined : docs.reader.active),
  // While Edit is open a control changes the open text, saved with the document: a direct file
  // write would race the typing (and its adopt would replace what was typed meanwhile).
  native: { get available() { return native.available && !editing; }, patchDocument: (token, patches) => native.patchDocument(token, patches) },
  // The host wrote the file: adopt its text and binding generation, or the next Save is stale.
  adopt: (doc, text, generation) => {
    const target = docs.saveTarget();
    if (!target || target.id !== doc.id || !doc.binding) return false;
    return docs.applyReload(target, { outcome: "changed", text, generation, encoding: doc.binding.encoding, eol: doc.binding.eol });
  },
  setText: (doc, text) => { doc.text = text; doc.dirty = true; ++generation; syncDocuments(); },
  // A write re-renders the document: return focus to the same control so keyboard users keep their place.
  rerender: () => {
    const key = (document.activeElement as HTMLElement | null)?.dataset?.amKey;
    void render().then(() => {
      if (key && !document.querySelector(".am-menu")) content.querySelector<HTMLElement>(`[data-am-key="${key}"]`)?.focus({ preventScroll: true });
    });
  },
  notice: showActionNotice,
  report,
});
setControlHandler((control, action) => { void writeback.change(control, action); });

// Screen theme: a fixed choice, or follow Windows (light or dark) when the setting says so.
const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)");
const systemTheme = (): "light" | "dark" => systemDark?.matches ? "dark" : "light";
let themeAtEntry = settings.screenTheme;
function applyTheme(): void {
  if (settings.followSystemTheme && settings.screenTheme !== systemTheme()) {
    // Stored too, so the editing workspace (which reads screenTheme) matches.
    settings.screenTheme = systemTheme();
    saveSettings({ ...loadSettings(), screenTheme: settings.screenTheme, followSystemTheme: true });
  }
  document.documentElement.dataset.appTheme = settings.screenTheme;
}
systemDark?.addEventListener?.("change", () => { if (!app) applyTheme(); });
applyTheme();
function setTheme(choice: "light" | "dark" | "sepia" | "system"): void {
  if (choice === "system") settings.followSystemTheme = true;
  else { settings.followSystemTheme = false; settings.screenTheme = choice; }
  if (choice === "system") settings.screenTheme = systemTheme();
  saveSettings({ ...loadSettings(), screenTheme: settings.screenTheme, followSystemTheme: settings.followSystemTheme });
  applyTheme();
}

// Live reload (S1c): a dirty document whose file changed on disk gets a
// non-modal bar. Nothing is discarded without a click.
const dismissedConflicts = new Set<string>();
function conflictBar(after: HTMLElement): { bar: HTMLElement; text: HTMLElement } {
  const bar = document.createElement("div");
  bar.className = "reader-notice file-conflict";
  bar.setAttribute("role", "alert");
  bar.hidden = true;
  const text = document.createElement("span");
  const button = (label: string, action: string): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = label;
    control.dataset.conflictAction = action;
    return control;
  };
  bar.append(text, " ", button("Reload", "reload"), " ", button("Keep mine", "keep"), " ", button("Save As", "save-as"));
  after.after(bar);
  return { bar, text };
}
const conflictBars = [conflictBar(notice), conflictBar(workspaceNotice)];

function report(message: string): void {
  ++noticeGeneration;
  notice.textContent = message;
  notice.hidden = !message;
  workspaceNotice.textContent = message;
  workspaceNotice.hidden = !message;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Remember which bound files are open (tokens -> paths natively), coalesced.
let sessionReady = false;
let sessionTimer: ReturnType<typeof setTimeout> | undefined;
let lastSession = "";
function recordSession(): void {
  if (!native.available || !sessionReady) return;
  // A mode transition empties one owner before the other takes over: never record that.
  if (changingMode) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    if (changingMode) return; // finishMode syncs and schedules again.
    const tokens = docs.boundTokens();
    const key = tokens.join(",");
    if (key === lastSession) return;
    lastSession = key;
    void native.session.record(tokens).catch(() => undefined);
  }, 500);
}

/** On window close: send the current open set now instead of after the debounce. */
async function flushSession(): Promise<void> {
  if (!native.available || !sessionReady) return;
  clearTimeout(sessionTimer);
  const tokens = docs.boundTokens();
  if (tokens.join(",") === lastSession) return;
  lastSession = tokens.join(",");
  await native.session.record(tokens);
}

function syncDocuments(): void {
  const { docs: open, active } = docs.list();
  const labels = documentLabels(open);
  const pdfItems = app ? [] : pdfs.tabs.map(tab => ({ id: tab.id, label: tab.name, dirty: false }));
  tabs.render([...open.map(doc => ({ id: doc.id, label: labels.get(doc.id)!, dirty: doc.dirty })), ...pdfItems],
    pdfShown() ? pdfs.activeId : active?.id ?? null, changingMode);
  const target = docs.saveTarget();
  const shown = !app && active && renderedReaderId === active.id ? docs.reader.active : null;
  if (shown) {
    const parts = statusParts({ name: shown.name, path: shown.binding?.path, text: shown.text, dirty: shown.dirty, disk: shown.binding?.disk, format: dataLabelOf(shown.name) });
    status.textContent = `${parts.where} · ${parts.size}`;
  }
  saveState.textContent = target
    ? statusParts({ name: target.name, path: target.binding?.path, text: "", dirty: target.dirty, disk: target.binding?.disk }).state
    : "";
  editToggle.disabled = !!app || changingMode || pdfShown();
  editToggle.setAttribute("aria-pressed", String(editing));
  editHost.hidden = !editing;
  const divider = editHost.nextElementSibling;
  if (divider?.id === "split-handle") (divider as HTMLElement).hidden = !editing;
  document.body.classList.toggle("reader-editing", editing);
  const workspaceBusy = changingMode || nativeSaveBusy || !!app?.exportState.busy;
  returnButton.disabled = workspaceBusy;
  for (const button of newButtons) button.disabled = workspaceBusy;
  const workspaceNew = appRoot.querySelector<HTMLButtonElement>('.workspace-actions > button[data-document-command="new"]');
  if (workspaceNew) workspaceNew.disabled = workspaceBusy;
  for (const button of appRoot.querySelectorAll<HTMLButtonElement>("button[data-desktop-command]")) {
    button.disabled = workspaceBusy || !active;
  }
  const titled = pdfShown() ? pdfs.active : active;
  document.title = titled ? `${titled.name} — MDviewer` : "MDviewer";
  recordSession();
  const conflicted = !!target?.binding && target.binding.disk === "changed" && target.dirty
    && !dismissedConflicts.has(target.binding.token);
  for (const { bar, text } of conflictBars) {
    bar.hidden = !conflicted;
    const message = conflicted ? `${target.name} changed on disk. Your edits are kept until you choose.` : "";
    // role=alert re-announces on every text write; write only when it changes.
    if (conflicted && text.textContent !== message) text.textContent = message;
    for (const control of bar.querySelectorAll("button")) control.disabled = changingMode || nativeSaveBusy;
  }
}

function rememberReaderPosition(): void {
  if (renderedReaderId && docs.reader.documents.some(doc => doc.id === renderedReaderId)) {
    docs.reader.positions.set(renderedReaderId, { reader: { scrollTop: scroll.scrollTop, scrollLeft: scroll.scrollLeft } });
  }
}

/**
 * Render the active document. `patch` (typing in Edit) keeps the shown document in place and
 * replaces only changed blocks (S2c); anything else (another document, settings) is a full render.
 */
function render(importErrors: readonly string[] = [], patch = false): Promise<void> {
  if (pdfShown()) { ++renderGeneration; syncDocuments(); showPdf(); return Promise.resolve(); }
  pdfHost.hidden = true;
  scroll.hidden = false;
  const patching = patch && !!docs.reader.active && renderedReaderId === docs.reader.active.id;
  // A switch to another document may reuse that document's kept DOM; the one being left is kept.
  // Re-rendering the shown document (new text, settings, warnings) never reuses anything.
  const switching = !patching && !!docs.reader.active && docs.reader.active.id !== renderedReaderId;
  if (kept && !docs.reader.documents.some(open => open.id === kept!.id)) kept = null; // closed since
  const candidate = switching ? kept : null;
  if (!patching) {
    rememberReaderPosition();
    if (switching) keepRendered();
    renderedReaderId = null;
  }
  const current = ++renderGeneration;
  const currentNotice = noticeGeneration;
  const doc = docs.reader.active;
  syncDocuments();
  if (!patching) { outline.replaceChildren(); syncEditor(); }
  content.hidden = !doc;
  empty.hidden = !!doc;
  if (!doc) {
    kept = null; // nothing open: nothing to switch back to
    content.replaceChildren();
    releaseImages();
    status.textContent = "Local files · No uploads";
    return Promise.resolve();
  }
  if (candidate && reuseRendered(candidate, doc)) return Promise.resolve();
  if (!patching) {
    content.setAttribute("aria-busy", "true");
    content.replaceChildren(); // A failed new document must not display the previous file's contents.
    // Reset while the reader is empty (cheap); the first paint then restores a saved offset only.
    const behavior = scroll.style.scrollBehavior;
    scroll.style.scrollBehavior = "auto";
    scroll.scrollTop = 0;
    scroll.scrollLeft = 0;
    scroll.style.scrollBehavior = behavior;
    status.textContent = `Opening ${doc.name}…`;
  }
  // Mermaid's singleton is not re-entrant; serialize and skip obsolete renders.
  renderChain = renderChain.catch(() => undefined).then(async () => {
    if (current !== renderGeneration) return;
    const position = patching ? undefined : docs.reader.positions.get(doc.id)?.reader;
    const restore = (): void => {
      const previousBehavior = scroll.style.scrollBehavior;
      scroll.style.scrollBehavior = "auto";
      scroll.scrollTop = position?.scrollTop ?? 0;
      scroll.scrollLeft = position?.scrollLeft ?? 0;
      scroll.style.scrollBehavior = previousBehavior;
    };
    let restoredTop = -1;
    // Text first: the document is readable, navigable and scrollable from this point;
    // code and diagrams upgrade in place afterwards.
    const show = (from: HTMLElement): void => {
      // Patching keeps the loaded images (imageCache); a full render releases them.
      if (patching) outline.replaceChildren();
      else releaseImages();
      // Through the patcher even on a full render (into the emptied reader), so every block gets
      // its reuse key and the first keystroke in Edit replaces only the block it changed.
      patchDocument(content, from);
      // Relative images load natively into blob URLs (S6); upgrades later happen in place.
      if (native.available && doc.binding) void loadLocalImages(content, doc.binding.token, current);
      content.setAttribute("data-code-theme", settings.codeTheme);
      buildOutline();
      // The outline changes text wrapping and the maximum scroll offset. Reveal
      // it first so saved offsets clamp against the reader geometry.
      // A first open needs no reset (the emptied reader is at 0) and no forced layout.
      if (position) { restore(); restoredTop = scroll.scrollTop; }
      renderedReaderId = doc.id;
    };
    try {
      // A data document renders its readable view; its raw text stays the document (renderText.ts).
      // Its kind's parser loads first (D4: YAML on demand); a failed load is this render's error.
      const preparing = prepareRenderText(doc.name);
      if (preparing) { await preparing; if (current !== renderGeneration) return; }
      const view = renderTextOf(doc.name, doc.text);
      const renderedText = doc.text; // what this DOM shows (S9 reuse compares against it)
      const renderedSettings = JSON.stringify(settings);
      const result = await renderReaderDocument(view.text, settings, doc.name, first => {
        if (current !== renderGeneration) return null;
        show(first);
        return content;
      }, { data: !!view.data });
      if (current !== renderGeneration) return;
      if (result.document !== content) show(result.document); // A renderer that did not paint early.
      // Diagrams change heights: re-clamp a saved offset unless the reader has scrolled since.
      else if (position && scroll.scrollTop === restoredTop) restore();
      content.setAttribute("aria-busy", "false");
      renderedState = { id: doc.id, name: doc.name, text: renderedText, settings: renderedSettings, warnings: result.warnings };
      const parts = statusParts({ name: doc.name, path: doc.binding?.path, text: doc.text, dirty: doc.dirty, disk: doc.binding?.disk, format: view.data?.label });
      status.textContent = `${parts.where} · ${parts.size}`;
      if (view.data?.readable.truncated) content.append(moreBar(doc.name));
      // A new open/action may have reported a newer failure while this render ran.
      const warnings = editing ? result.warnings.filter(warning => !warning.startsWith("This document is empty.")) : result.warnings;
      if (warnings.length && currentNotice === noticeGeneration) {
        report([...importErrors, ...warnings].join(" "));
      }
    } catch (error) {
      if (current !== renderGeneration) return;
      content.setAttribute("aria-busy", "false");
      if (currentNotice === noticeGeneration) {
        report([...importErrors, `Could not render ${doc.name}: ${errorText(error)}`].join(" "));
      }
      status.textContent = "Rendering failed. You can still open Edit & PDF or another file.";
    }
  });
  return renderChain;
}

/**
 * Hand the view to the active PDF tab: flush and close Edit (its text stays with its document),
 * remember the reader position, and leave no reader document active, so no reader command (Save,
 * Edit, Export, copy) can act on a document that is not shown.
 */
function focusPdf(): void {
  if (editing) { flushEdit(); editing = false; }
  rememberReaderPosition();
  docs.reader.activeId = null;
}

/** Show the active PDF tab, mounting its view (and loading the PDF chunk) when needed. */
function showPdf(): void {
  const tab = pdfs.active;
  if (!tab) return;
  scroll.hidden = true;
  pdfHost.hidden = false;
  if (pdfView?.id === tab.id) { void pdfView.view.then(view => view.showOutline(), () => undefined); return; }
  closePdfView();
  outline.replaceChildren();
  status.textContent = `Opening ${tab.name}…`;
  saveState.textContent = "";
  const abort = new AbortController();
  const view = import("../pdf").then(module => module.mountPdf(pdfHost, {
    name: tab.name, bytes: tab.bytes, outline, openExternal: openWebLink, signal: abort.signal,
    status: text => { if (pdfView?.id === tab.id && pdfShown()) status.textContent = text; },
  }));
  const current = { id: tab.id, view, abort };
  pdfView = current;
  view.catch(error => {
    if (pdfView !== current) return;
    pdfView = null; // the next activation retries
    report(`Could not open ${tab.name}: ${errorText(error)}`);
  });
}

function closePdfView(): void {
  const current = pdfView;
  pdfView = null;
  current?.abort.abort();
  void current?.view.then(view => view.destroy(), () => undefined);
}

/** Fetch natively opened PDFs' bytes and add them as tabs; the last one shows unless Markdown came too. */
async function openNativePdfs(documents: OpenBatch["documents"], showLast: boolean): Promise<void> {
  const problems: string[] = [];
  let opened = false;
  for (const doc of documents) {
    if (!doc.token) { problems.push(`${doc.name}: this PDF is not linked to its file.`); continue; }
    try {
      const problem = pdfs.add(doc.name, await native.readPdf(doc.token), doc.token);
      if (problem) { problems.push(`${doc.name}: ${problem}`); void native.releasePdf(doc.token); } else opened = true;
    } catch (error) {
      problems.push(`${doc.name}: ${errorText(error) === "changed" ? "the file changed after it was chosen. Open it again." : errorText(error)}`);
      void native.releasePdf(doc.token);
    }
  }
  if (problems.length) report(problems.join(" "));
  if (!opened) return;
  if (showLast && !app && !changingMode) { rememberReaderPosition(); docs.reader.activeId = null; void render(); }
  else syncDocuments();
}

function commitBatch(batch: OpenBatch, request: number): void {
  if (changingMode) { queuedBatches.push({ batch, request }); return; }
  const pdfDocuments = batch.documents.filter(doc => doc.kind === "pdf");
  if (pdfDocuments.length) {
    batch = { ...batch, documents: batch.documents.filter(doc => doc.kind !== "pdf") };
    void openNativePdfs(pdfDocuments, !batch.documents.length && request === generation);
  }
  const errors = batch.errors.map(error => `${error.name}: ${error.message}`);
  const previousActiveId = docs.reader.activeId;
  const keepPdf = pdfShown() && request !== generation;
  errors.push(...docs.addBatch(batch.documents, request === generation));
  if (keepPdf) docs.reader.activeId = null;
  syncDocuments(); // The workspace's addBatch emits before the imported clean baselines are recorded.
  if (errors.length) report(errors.join(" "));
  // Capture the notices for this batch only, after publishing its immediate errors.
  if (!app && batch.documents.length && docs.reader.activeId !== previousActiveId) void render(errors);
}

function canRestoreDocument(doc: Readonly<Pick<Doc, "name" | "text">>): boolean {
  if (!app || changingMode) return false;
  const errors = docs.admitToWorkspace([doc]);
  report(errors.join(" "));
  return errors.length === 0;
}

async function readFiles(files: File[]): Promise<void> {
  const request = ++generation;
  const batch: OpenBatch = { documents: [], errors: [], canceled: false };
  let total = 0;
  let openedPdf = false;
  report("");
  for (const file of files.slice(0, 32)) {
    try {
      if (isPdfFile(file.name, file.type)) {
        if (app || changingMode) throw new Error("Return to the reading view to open a PDF.");
        if (file.size > MAX_PDF_BYTES) throw new Error("PDFs larger than 200 MB cannot be opened.");
        const problem = pdfs.add(file.name, new Uint8Array(await file.arrayBuffer()));
        if (problem) throw new Error(problem);
        openedPdf = true;
        continue;
      }
      if (!isMarkdownFile(file.name, file.type)) throw new Error("Only Markdown, PDF and data files (JSON, JSON Lines, YAML, TOML, CSV, TSV, plain text) are supported.");
      if (file.size > SIZE_HARD_BYTES || total + file.size > SIZE_HARD_BYTES) throw new Error("This batch exceeds the 25 MB limit.");
      if (file.size > SIZE_SOFT_BYTES && !window.confirm(`Open ${file.name}? Large documents can take longer to render.`)) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > SIZE_HARD_BYTES || total + bytes.length > SIZE_HARD_BYTES) throw new Error("This batch exceeds the 25 MB limit.");
      total += bytes.length;
      const text = decodeMarkdown(bytes);
      // A data document's readable view can outgrow its file: confirm on the view too. (If its
      // parser cannot load, the document opens and its render shows the error.)
      if (bytes.length <= SIZE_SOFT_BYTES && dataDocumentKind(file.name) && await (prepareRenderText(file.name) ?? Promise.resolve()).then(() => true, () => false)
        && new TextEncoder().encode(renderTextOf(file.name, text).text).length > SIZE_SOFT_BYTES
        && !window.confirm(`Open ${file.name}? Its readable view is large and can take longer to render.`)) continue;
      batch.documents.push({ name: file.name, text, bytes: bytes.length });
    } catch (error) {
      batch.errors.push({ name: file.name, message: errorText(error) });
    }
  }
  if (files.length > 32) batch.errors.push({ name: "Extra files", message: "Open at most 32 files at once." });
  // A batch of only PDFs shows the last one; Markdown in the same batch takes the view instead.
  // Only the newest import may take the view (a slow PDF read must not override a later choice).
  const showPdfNow = openedPdf && !batch.documents.length && request === generation && !app && !changingMode;
  if (showPdfNow) focusPdf();
  commitBatch(batch, request);
  if (showPdfNow) void render(batch.errors.map(error => `${error.name}: ${error.message}`));
  else if (openedPdf) syncDocuments();
}

async function open(): Promise<void> {
  if (changingMode) return;
  if (!native.available) { fileInput.click(); return; }
  const request = ++generation;
  report("");
  try { commitBatch(await native.open(), request); }
  catch (error) { report(`Could not open files: ${errorText(error)}`); }
}

/** Open a library entry exactly like a picked file (same admission and notices). */
async function openFromLibrary(id: string): Promise<void> {
  if (changingMode || !native.available) return;
  const request = ++generation;
  report("");
  try { commitBatch(await native.library.open(id), request); }
  catch (error) { report(`Could not open this file: ${errorText(error)}`); }
}

/** New: an untitled note in Edit. `text` (from a template) starts it with content, unsaved. */
async function createDocument(text = ""): Promise<void> {
  if (changingMode || nativeSaveBusy || app?.exportState.busy) {
    if (text) report("Wait for the current action to finish, then choose the template again.");
    return;
  }
  const doc = { name: nextUntitledName(app ? app.store.openDocs : docs.reader.documents), text };
  if (app) {
    if (!canRestoreDocument(doc)) return;
    ++generation;
    docs.addNewToWorkspace(app, doc);
    if (app.settings.viewMode === "preview") app.updateSettings({ viewMode: "editor" });
    syncDocuments(); // add emits before the explicit clean baseline is recorded.
    app.focusEditor();
    return;
  }
  const errors = docs.reader.append([doc]);
  report(errors.join(" "));
  if (errors.length) return;
  ++generation;
  // Text from a template is unsaved work: closing asks, and Save goes through Save As.
  if (text && docs.reader.active) docs.reader.active.dirty = true;
  await setEditing(true); // before the render, so an empty note is not reported as a problem
  await render();
}

function buildOutline(): void {
  for (const heading of content.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id]")) {
    const link = document.createElement("a");
    link.href = `#${encodeURIComponent(heading.id)}`;
    link.textContent = heading.textContent;
    link.dataset.level = heading.tagName;
    outline.append(link);
  }
  if (!outline.childElementCount) outline.textContent = "This document has no headings.";
}

/**
 * S9: the last fully rendered Markdown document's DOM, kept when another document is shown, so
 * switching back is a swap instead of a full render. Reused only for the same document, name,
 * exact text and settings. Not kept for data documents (their view depends on a budget) or for
 * documents with local images (their blob URLs are released on every full render).
 * ponytail: one entry; a small LRU if switching among three or more large documents matters.
 */
type RenderedState = { id: string; name: string; text: string; settings: string; warnings: string[] };
/** What the reader's DOM was rendered from (set when a render completes): not the current text. */
let renderedState: RenderedState | null = null;
let kept: (RenderedState & { nodes: Node[] }) | null = null;
function keepRendered(): void {
  const state = renderedState;
  kept = null;
  renderedState = null;
  if (!state || state.id !== renderedReaderId || content.getAttribute("aria-busy") !== "false" || dataLabelOf(state.name)
    || content.querySelector("img[data-local-src]") || !docs.reader.documents.some(doc => doc.id === state.id)) return;
  kept = { ...state, nodes: [...content.childNodes] };
}
function reuseRendered(entry: RenderedState & { nodes: Node[] }, doc: { id: string; name: string; text: string }): boolean {
  if ( entry.id !== doc.id || entry.name !== doc.name || entry.text !== doc.text || entry.settings !== JSON.stringify(settings)) return false;
  content.setAttribute("aria-busy", "true"); // the same busy-then-ready signal as a render
  releaseImages(); // the document left may have held local images; this one has none
  content.replaceChildren(...entry.nodes);
  content.setAttribute("data-code-theme", settings.codeTheme);
  content.setAttribute("aria-busy", "false");
  performance.mark("mdv:reader-text");
  renderedState = { id: entry.id, name: entry.name, text: entry.text, settings: entry.settings, warnings: entry.warnings };
  if (entry.warnings.length) report(entry.warnings.join(" ")); // as its render reported them
  buildOutline();
  const position = docs.reader.positions.get(doc.id)?.reader;
  const behavior = scroll.style.scrollBehavior;
  scroll.style.scrollBehavior = "auto";
  scroll.scrollTop = position?.scrollTop ?? 0;
  scroll.scrollLeft = position?.scrollLeft ?? 0;
  scroll.style.scrollBehavior = behavior;
  renderedReaderId = doc.id;
  syncDocuments();
  return true;
}

/** A cut-short readable view offers the next part and everything (budgets live in renderText). */
function moreBar(name: string): HTMLElement {
  const bar = document.createElement("p");
  bar.className = "reader-data-more";
  const button = (label: string, widen: (name: string) => void): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = label;
    control.addEventListener("click", () => {
      widen(name);
      void render().then(() => content.querySelector<HTMLElement>(".reader-data-more button")?.focus({ preventScroll: true }));
    });
    return control;
  };
  bar.append("This view was cut short. ", button("Show more", showMoreOf), " ", button("Show all", showAllOf));
  return bar;
}

/** Keep the editor on the active document. A same-document, same-text call keeps caret and undo. */
function syncEditor(): void {
  if (!editor || !editing) return;
  const doc = docs.reader.active;
  if (!doc) { editing = false; syncDocuments(); return; }
  editor.setDocument({ id: doc.id, name: doc.name, text: doc.text });
}

/** Show or hide the Edit surface (Ctrl+E). With nothing open it starts a new note. */
async function setEditing(on: boolean): Promise<void> {
  if (app || changingMode) return;
  if (!on) {
    flushEdit();
    editing = false;
    syncDocuments();
    content.focus({ preventScroll: true });
    return;
  }
  if (!docs.reader.active) { await createDocument(); return; }
  if (!editor) {
    try {
      const { mountEditor, mountSplitter } = await import("./edit");
      if (!editSplitter) {
        const layout = editHost.parentElement!;
        const applyRatio = (ratio: number): void => { layout.style.setProperty("--edit-ratio", String(ratio)); };
        applyRatio(settings.splitRatio);
        editSplitter = mountSplitter(layout, {
          track: layout, initialRatio: settings.splitRatio, onPreview: applyRatio,
          onCommit: ratio => { applyRatio(ratio); settings.splitRatio = ratio; saveSettings({ ...loadSettings(), splitRatio: ratio }); },
        });
        const handle = layout.lastElementChild as HTMLElement;
        handle.hidden = !editing; // shown by syncDocuments while editing
        editHost.after(handle); // the handle sits between the source and the reader
      }
      editor ??= mountEditor(editHost, {
        onInput: editInput,
        codeTheme: settings.codeTheme,
        placeholder: "Start writing Markdown…",
        largeInsertBytes: SIZE_SOFT_BYTES,
        hardLimitBytes: SIZE_HARD_BYTES,
        confirmLargeInsert: async bytes => bytes <= SIZE_HARD_BYTES && window.confirm(
          `Inserting this would make the document about ${(bytes / 1_000_000).toFixed(1)} MB. Insert it anyway?`),
      });
    } catch (error) { report(`Could not open Edit: ${errorText(error)}`); return; }
  }
  // A control write in flight would adopt the host's text after typing began: let it land first.
  await writeback.settled();
  if (app || changingMode || !docs.reader.active) return;
  editing = true;
  syncDocuments();
  syncEditor();
  editor.focus();
}

/** Typing: the open text changes at once; the reader follows by patching changed blocks. */
function editInput(text: string): void {
  const doc = docs.reader.active;
  if (!doc || !editing || app || doc.text === text) return;
  doc.text = text;
  doc.dirty = true;
  ++generation;
  if (notice.textContent?.startsWith("This document is empty.")) report("");
  syncDocuments();
  clearTimeout(editTimer);
  // The reader then follows the caret, now that the edited block exists.
  editTimer = setTimeout(() => { editTimer = undefined; void render([], true).then(followCaret); }, 120);
}

/** Paint a pending edit now (before hiding Edit, saving or leaving for the workspace). */
function flushEdit(): void {
  if (editTimer === undefined) return;
  clearTimeout(editTimer);
  editTimer = undefined;
  void render([], true);
}

// On the host, once: the editor replaces its textarea when the document changes.
editHost.addEventListener("keyup", event => { if (event.target === editor?.input) followCaret(); });
editHost.addEventListener("click", event => { if (event.target === editor?.input) followCaret(); });

/** Scroll follows the caret (S2a's line map): bring the block holding the caret line into view. */
function followCaret(): void {
  if (!editor || !editing || (docs.reader.active && dataLabelOf(docs.reader.active.name))) return;
  const input = editor.input;
  const line = input.value.slice(0, input.selectionStart).split("\n").length;
  let target: Element | null = null;
  for (const block of content.querySelectorAll(":scope > [data-src]")) {
    const [start, end] = block.getAttribute("data-src")!.split("-").map(Number);
    if (line < start!) break;
    target = block;
    if (line <= end!) break;
  }
  target?.scrollIntoView({ block: "nearest" });
}

async function enterWorkspace(revealEditor = false): Promise<void> {
  // A pending save must finish before its document changes owner (FILE_LIFECYCLE).
  if (app || changingMode || nativeSaveBusy || !docs.reader.active) return;
  flushEdit();
  revealEditor ||= editing; // from Edit, the workspace opens on its source pane
  editor?.destroy();
  editor = null;
  editSplitter?.destroy(); // the workspace mounts its own divider with the same id
  editSplitter = null;
  editing = false;
  editHost.replaceChildren();
  rememberReaderPosition();
  themeAtEntry = settings.screenTheme;
  changingMode = true; ++generation; ++renderGeneration;
  // Layout needs a visible workspace, but its controls must not accept input
  // until the initial render and source handoff have finished.
  appRoot.inert = true;
  syncDocuments();
  let focusWhenReady = false;
  try {
    await renderChain;
    const { startWorkspace } = await import("./workspace");
    shell.hidden = true;
    workspace.hidden = false;
    document.body.classList.add("desktop-editing");
    // App's canonical IDs must not collide with authored IDs in the reading DOM.
    content.replaceChildren();
    renderedReaderId = null;
    const mounted = startWorkspace(appRoot, () => { void open(); }, canRestoreDocument, () => createDocument(),
      native.available ? { save: () => { void saveDocument(false); }, saveAs: () => { void saveDocument(true); } } : undefined);
    app = mounted.app;
    docs.adoptReaderInto(app);
    if (revealEditor && app.settings.viewMode === "preview") app.updateSettings({ viewMode: "editor" });
    const offText = app.store.on("text", () => { generation += 1; });
    let activeId = app.store.activeId;
    const offChange = app.store.on("change", () => {
      if (!app) return;
      // A mode transition empties the store; those documents move, they do not close.
      docs.pruneBaselines(!changingMode);
      if (app.store.activeId !== activeId) { activeId = app.store.activeId; generation += 1; }
      syncDocuments();
    });
    const offExport = app.onExportStateChange(() => syncDocuments());
    detachWorkspace = () => { mounted.detachShortcuts(); offText(); offChange(); offExport(); };
    // The App, selection and dirty baselines now own every transferred source.
    // Keep the old session intact until that handoff succeeds, then release it.
    docs.releaseReader();
    content.replaceChildren(); // Release the reader DOM while the PDF workspace owns the document.
    await app.flushRender();
    focusWhenReady = true;
  } catch (error) {
    const failure = `Could not open the editing workspace: ${errorText(error)}`;
    report(failure);
    if (!app) {
      workspace.hidden = true; shell.hidden = false; document.body.classList.remove("desktop-editing");
      void render([failure]);
    }
  } finally { appRoot.inert = false; finishMode(); }
  // An inert textarea cannot receive focus. Also finish queued imports before
  // announcing entry by focusing the current editor.
  if (focusWhenReady) app?.focusEditor();
}

async function returnToReader(): Promise<void> {
  if (!app || changingMode || app.exportState.busy || nativeSaveBusy) return;
  changingMode = true; ++generation;
  appRoot.inert = true; // No edits or sample actions may race the ownership snapshot.
  syncDocuments();
  try {
    await app.flushRender();
    app.captureDocumentPosition();
    const next = docs.readerSnapshot(app);
    const previousDocs = [...app.store.openDocs];
    const previousActive = app.store.activeId;
    const previousOriginals = new Map(docs.baselines);
    try {
      for (const doc of previousDocs) app.store.remove(doc.id);
      await app.flushRender(); // Tear down Paged.js while its canvas still exists.
    } catch (error) {
      // Roll back with the same identities, including unknown/Undo-restored docs.
      // This snapshot is local to the transition and is released after success.
      const previousIds = new Set(previousDocs.map(doc => doc.id));
      app.store.openDocs = [...previousDocs, ...app.store.openDocs.filter(doc => !previousIds.has(doc.id))];
      for (const [id, original] of previousOriginals) docs.baselines.set(id, original);
      for (const [index, doc] of previousDocs.entries()) {
        const position = next.positions.get(next.documents[index]!.id);
        if (position) app.store.positions.set(doc.id, position);
      }
      if (previousActive) app.store.setActive(previousActive);
      app.restoreDocumentPosition();
      throw error;
    }
    detachWorkspace?.(); detachWorkspace = null;
    app.destroy(); app = null;
    docs.returnToReader(next);
    appRoot.replaceChildren();
    workspace.hidden = true; shell.hidden = false;
    document.body.classList.remove("desktop-editing");
    Object.assign(settings, loadSettings());
    // A theme picked in the workspace is an explicit choice: stop following Windows. A Windows
    // change while the workspace was open is not (the stored theme is then still the entry one).
    if (settings.followSystemTheme && settings.screenTheme !== themeAtEntry) {
      settings.followSystemTheme = false;
      saveSettings({ ...loadSettings(), followSystemTheme: false });
    }
    applyTheme();
    report("");
    await render();
    content.focus({ preventScroll: true });
  } catch (error) { report(`Could not return to reading: ${errorText(error)}`); }
  finally { appRoot.inert = false; finishMode(); }
}

function finishMode(): void {
  changingMode = false;
  for (const { batch, request } of queuedBatches.splice(0)) commitBatch(batch, request);
  syncDocuments();
}

function closeDocument(): void {
  if (docs.reader.activeId) closeDocumentById(docs.reader.activeId);
  else if (pdfShown() && pdfs.activeId) closeDocumentById(pdfs.activeId);
}

function closeDocumentById(id: string): void {
  if (isPdfTab(id)) {
    if (changingMode) return;
    const wasShown = pdfShown() && pdfs.activeId === id;
    if (pdfView?.id === id) closePdfView();
    const token = pdfs.tabs.find(tab => tab.id === id)?.token;
    if (token) void native.releasePdf(token).catch(() => undefined);
    pdfs.close(id);
    report("");
    if (!wasShown) { syncDocuments(); return; }
    if (!pdfs.active && docs.reader.documents.length) docs.reader.activeId = docs.reader.documents.at(-1)!.id;
    void render();
    return;
  }
  const doc = docs.reader.documents.find(candidate => candidate.id === id);
  if (!doc || changingMode) return;
  if (nativeSaveBusy) { report("Wait for the save to finish before closing this document."); return; }
  if (doc.dirty && !window.confirm(`Discard unsaved edits to ${doc.name}?`)) return;
  ++generation;
  const wasActive = docs.reader.activeId === doc.id;
  docs.closeReaderDocument(doc.id);
  report("");
  if (wasActive) void render(); else syncDocuments();
  if (!docs.reader.documents.length && (document.activeElement === document.body || !document.activeElement)) newButtons[0]?.focus();
}

function activateDocument(id: string): void {
  if (isPdfTab(id)) {
    if (changingMode || (pdfShown() && pdfs.activeId === id)) return;
    focusPdf();
    ++generation; pdfs.activeId = id; report(""); void render();
    return;
  }
  if (changingMode || docs.reader.activeId === id || !docs.reader.documents.some(doc => doc.id === id)) return;
  visit(id, docs.reader.activeId);
  ++generation; docs.reader.activeId = id; report(""); void render();
}

function stepDocument(delta: number): void {
  const open = docs.reader.documents;
  if (app || changingMode || open.length < 2) return;
  const at = open.findIndex(doc => doc.id === docs.reader.activeId);
  activateDocument(open[(at + delta + open.length) % open.length]!.id);
  tabs.focusActive();
}

element("reader-open-empty").addEventListener("click", () => { void open(); });
for (const button of newButtons) button.addEventListener("click", () => { void createDocument(); });
for (const input of [fileInput, element<HTMLInputElement>("file-input")]) {
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    void readFiles(files);
  });
}
appRoot.addEventListener("click", event => {
  // Inert blocks physical input; shortcuts also dispatch programmatic clicks.
  if (changingMode) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  const button = (event.target as Element | null)?.closest("button.doc-close");
  const doc = app?.store.active;
  if (!button || !doc) return;
  if (nativeSaveBusy) {
    report("Wait for the save to finish before closing this document.");
    event.preventDefault(); event.stopImmediatePropagation(); return;
  }
  if (docs.workspaceDirty(doc) && !window.confirm(`Discard unsaved edits to ${doc.name}?`)) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
editToggle.addEventListener("click", () => { void setEditing(!editing); });
returnButton.addEventListener("click", () => { void returnToReader(); });
function openSample(): void {
  ++generation;
  const errors = docs.reader.append([{ name: "Sample.md", text: SAMPLE_MARKDOWN }]);
  report(errors.join(" "));
  void render(errors);
}
element("reader-sample").addEventListener("click", openSample);
function resizeText(delta: number): void {
  if (pdfShown()) { void pdfView?.view.then(view => view.zoomBy(delta), () => undefined); return; }
  textSize = Math.min(26, Math.max(13, textSize + delta));
  content.style.setProperty("--reader-text-size", `${textSize}px`);
}
window.addEventListener("dragover", event => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
window.addEventListener("drop", event => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  void readFiles(Array.from(event.dataTransfer.files));
});

const SAVE_AS_HINT = "Use Save As (Ctrl+Shift+S) to keep your text in another file.";
function conflictText(name: string, reason: Extract<SaveResult, { outcome: "conflict" }>["reason"]): string {
  const what = reason === "missing" ? "was moved or deleted"
    : reason === "locked" ? "is open in another program or read-only"
      : "changed on disk since MDviewer last read or saved it";
  return `${name} ${what}. Nothing was written and your text is still open. ${SAVE_AS_HINT}`;
}
const FAILURES: Record<string, string> = {
  busy: "Another save or file dialog is already open.",
  revoked: "is no longer linked to its file.",
  stale: "was saved from another view since. Try Save again.",
  unsupported: "is on a network drive, link or disk MDviewer cannot save over safely.",
  "write-failed": "could not be written. Check free space and access.",
  "too-large": "is larger than the 25 MB save limit.",
  "invalid-destination": "needs a .md or .markdown file name.",
  "revoked-after-write": "was saved, but it was closed while saving.",
};

/** Owned Save / Save As (docs/design/FILE_LIFECYCLE.md); Save Copy stays the export path. */
async function saveDocument(as: boolean): Promise<void> {
  if (!native.available || changingMode || nativeSaveBusy) return;
  if (app?.exportState.busy) { report("Wait for the PDF export to finish, then save."); return; }
  const target: SaveTarget | null = docs.saveTarget();
  if (!target) return;
  if (!as && !target.binding) return saveDocument(true);
  // An outside change the user has not taken (Keep mine, or edits typed while a
  // reload was being read) must never be overwritten in place.
  if (!as && target.binding?.disk === "changed") { report(conflictText(target.name, "changed")); return; }
  if (!as && !target.dirty) { report(`${target.name} has no unsaved changes.`); return; }
  let acceptLf = false;
  if (target.binding?.eol === "mixed") {
    if (!window.confirm(`${target.name} mixes line ending styles. Saving writes every line ending as LF. Continue?`)) return;
    acceptLf = true;
  }
  const captured = target.text; // Later edits, tab switches or a slow dialog never change these bytes.
  nativeSaveBusy = true;
  syncDocuments();
  let result: SaveResult;
  try {
    result = as || !target.binding
      ? await native.saveDocumentAs(target.binding?.token ?? null, target.name, captured, acceptLf)
      : await native.saveDocument(target.binding.token, target.binding.generation, captured, acceptLf);
  } catch (error) {
    report(`Could not save ${target.name}: ${errorText(error)} Your text is still open.`);
    return;
  } finally {
    nativeSaveBusy = false;
    syncDocuments();
  }
  switch (result.outcome) {
    case "saved": {
      // The view depends on the extension, not only the kind (a CSV and a TSV split differently).
      const viewBefore = dataDocumentKind(target.name) && target.name.split(".").pop()!.toLowerCase();
      const applied = docs.completeSave(target, captured, result);
      syncDocuments();
      const viewAfter = dataDocumentKind(result.name) && result.name.split(".").pop()!.toLowerCase();
      if (!app && viewAfter !== viewBefore && docs.reader.active?.name === result.name) void render();
      if (applied === "saved") report(`Saved ${result.name}.`);
      else if (applied === "saved-newer-edits") report(`Saved ${result.name}; newer edits remain unsaved.`);
      return;
    }
    case "canceled": report("Save canceled. Your document is still open."); return;
    case "conflict": report(conflictText(target.name, result.reason)); return;
    case "mixed-line-endings": report(`${target.name} mixes line ending styles; save again to convert them to LF.`); return;
    case "failed": {
      const detail = FAILURES[result.code] ?? "could not be saved.";
      report(`${target.name} ${detail} ${result.code === "busy" ? "" : "Your text is still open. " + SAVE_AS_HINT}`.trim());
      return;
    }
  }
}

function saveCopy(): void {
  const target = docs.saveTarget();
  if (!target || changingMode || nativeSaveBusy) return;
  void Promise.resolve(downloadMarkdown(target.name, target.text)).then(
    () => report(`Saved a copy of ${target.name}. The open document is unchanged.`),
    error => { if (!(error instanceof SaveCanceled)) report(`Could not save a copy: ${errorText(error)}`); },
  );
}

/** Handle one changed file reported by the host watcher. */
async function followChange(token: string): Promise<void> {
  const target = docs.byToken(token);
  if (!target) return;
  let result: ReadResult;
  try { result = await native.readDocument(token, !target.dirty, target.binding?.generation ?? 0); }
  catch { return; } // A failed re-read changes nothing; the next notification retries.
  const current = docs.byToken(token);
  if (!current || current.id !== target.id) return;
  if (result.outcome === "unchanged") {
    if (current.binding?.disk !== "synced") { docs.markDisk(token, "synced"); syncDocuments(); }
    return;
  }
  if (result.outcome === "missing") {
    docs.markDisk(token, "missing");
    report(`${current.name} was moved or deleted. Your text is still open. ${SAVE_AS_HINT}`);
    syncDocuments();
    return;
  }
  if (result.outcome !== "changed") return;
  if (result.text === null || current.dirty) {
    // Dirty: keep the edits and the old read, so Save conflicts instead of overwriting.
    dismissedConflicts.delete(token);
    docs.markDisk(token, "changed");
    syncDocuments();
    return;
  }
  if (!docs.applyReload(current, { ...result, text: result.text })) return;
  if (current.owner === "reader") {
    const doc = docs.reader.documents.find(open => open.id === current.id);
    if (doc) writeback.checkOverwritten(doc);
  }
  if (current.owner === "reader" && docs.reader.activeId === current.id) void render();
  syncDocuments();
}

async function reloadFromDisk(): Promise<void> {
  const target = docs.saveTarget();
  if (!target?.binding || changingMode || nativeSaveBusy) return;
  const result = await native.readDocument(target.binding.token, true, target.binding.generation).catch(() => null);
  if (result?.outcome === "changed" && result.text !== null && docs.applyReload(target, { ...result, text: result.text })) {
    if (target.owner === "reader") void render();
    report(`Reloaded ${target.name} from disk.`);
  } else if (result?.outcome === "unchanged") {
    docs.markDisk(target.binding.token, "synced");
    report(`${target.name} already matches the file on disk.`);
  } else if (result?.outcome === "missing") {
    docs.markDisk(target.binding.token, "missing");
    report(`${target.name} was moved or deleted. Your text is still open. ${SAVE_AS_HINT}`);
  }
  syncDocuments();
}

for (const { bar } of conflictBars) {
  bar.addEventListener("click", event => {
    const action = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-conflict-action]")?.dataset.conflictAction;
    const token = docs.saveTarget()?.binding?.token;
    if (!action || !token) return;
    if (action === "reload") void reloadFromDisk();
    if (action === "keep") { dismissedConflicts.add(token); syncDocuments(); }
    if (action === "save-as") void saveDocument(true);
  });
}

// Reading-mode actions; the workspace keeps its own shortcuts while mounted.
const reading = (): boolean => !changingMode;
registerCommand({ id: "document.new", title: "New document", keys: ["Mod+N"], enabled: reading, run: () => createDocument() });
// Templates (A4) need the host's read-only template read; until it exists the entry stays hidden.
const readTemplate = (native.library as { readTemplate?: (id: string) => Promise<{ name: string; text: string }> } | undefined)?.readTemplate;
if (native.available && readTemplate) {
  registerCommand({ id: "document.newFromTemplate", title: "New from template…", enabled: () => !app && !changingMode && !nativeSaveBusy,
    run: async () => {
      let shell: typeof import("./shell/templates");
      try { shell = await import("./shell/templates"); } catch (error) { report(`Could not open templates: ${errorText(error)}`); return; }
      const result = await shell.chooseTemplate({
        list: async () => {
          const entries: Array<{ id: string; name: string; project: string }> = [];
          let incomplete = false;
          for (const project of (await native.library.list()).projects) {
            try {
              const scan = await native.library.scan(project.id);
              incomplete ||= scan.truncated;
              for (const file of scan.files) {
                if (shell.isTemplatePath(file.relative)) entries.push({ id: file.id, name: file.name, project: project.name });
              }
            } catch { incomplete = true; } // an unreadable project: the picker says some may be missing
          }
          return { entries, incomplete };
        },
        read: id => readTemplate(id),
      });
      if (result) await createDocument(result.text);
    } });
}
registerCommand({ id: "document.open", title: "Open files…", keys: ["Mod+O"], enabled: reading, run: open });
registerCommand({ id: "document.close", title: "Close document", keys: ["Mod+W"], enabled: reading, run: closeDocument });
registerCommand({ id: "edit.toggle", title: "Edit the source beside the document", keys: ["Mod+E"], enabled: () => !app && !changingMode && !pdfShown(),
  run: () => setEditing(!editing) });
registerCommand({ id: "workspace.enter", title: "Export PDF…", keys: ["Mod+Shift+E"], enabled: () => !app && !changingMode && !nativeSaveBusy && !!docs.reader.active, run: () => enterWorkspace() });
registerCommand({ id: "workspace.return", title: "Return to reading", enabled: () => !!app && !changingMode, run: returnToReader });
registerCommand({ id: "document.sample", title: "Open sample document", enabled: () => !app && !changingMode, run: openSample });
registerCommand({ id: "view.textSmaller", title: "Smaller text", keys: ["Mod+-"], enabled: () => !app, run: () => resizeText(-1) });
registerCommand({ id: "navigate.back", title: "Back", keys: ["Alt+ArrowLeft"], enabled: () => !app && backStack.length > 0,
  run: () => step(backStack, forwardStack) });
registerCommand({ id: "navigate.forward", title: "Forward", keys: ["Alt+ArrowRight"], enabled: () => !app && forwardStack.length > 0,
  run: () => step(forwardStack, backStack) });
registerCommand({ id: "view.textLarger", title: "Larger text", keys: ["Mod+="], enabled: () => !app, run: () => resizeText(1) });
const modalOpen = (): boolean => !!document.querySelector("dialog[open]");
// Under the open palette, Ctrl+P and Ctrl+S do nothing rather than reach the webview's own print or save.
window.addEventListener("keydown", event => {
  if (modalOpen() && (event.ctrlKey !== event.metaKey) && !event.altKey && ["p", "s"].includes(event.key.toLowerCase())) event.preventDefault();
}, true);
installShortcuts(window, command => !app && !modalOpen() && !command.id.startsWith("document.save"));
// In the workspace Ctrl+P is the paginated print as well, never the webview's own print.
installShortcuts(window, command => !!app && command.id === "export.pdf");
// Save works in every mode and must claim Ctrl+S before the workspace's own
// Save Markdown (copy) shortcut, so it listens in the capture phase.
const saving = (): boolean => native.available && !changingMode && !nativeSaveBusy && !app?.exportState.busy;
// The menu offers Save only when there is something to save; Ctrl+S still explains why not.
const somethingToSave = (): boolean => { const target = docs.saveTarget(); return !!target && (target.dirty || !target.binding); };
registerCommand({ id: "document.save", title: "Save", keys: native.available ? ["Mod+S"] : [], enabled: saving, run: () => saveDocument(false) });
registerCommand({ id: "document.saveAs", title: "Save As…", keys: ["Mod+Shift+S"], enabled: saving, run: () => saveDocument(true) });
registerCommand({ id: "document.saveCopy", title: "Save a copy…", keys: native.available ? [] : ["Mod+S"], enabled: () => !changingMode && !nativeSaveBusy, run: saveCopy });
installShortcuts(window, command => native.available && !modalOpen() && command.id.startsWith("document.save"), { capture: true });
// Without the host (web build), Ctrl+S in the reader or Edit downloads the Markdown, as the workspace does.
installShortcuts(window, command => !native.available && !app && !modalOpen() && command.id === "document.saveCopy");

// ---- Shell (S3): tabs, More menu, panel, palette, print. -------------------------------
registerCommand({ id: "document.next", title: "Next document", keys: ["Alt+Shift+N"], enabled: () => !app && docs.reader.documents.length > 1, run: () => stepDocument(1) });
registerCommand({ id: "document.previous", title: "Previous document", keys: ["Alt+Shift+P"], enabled: () => !app && docs.reader.documents.length > 1, run: () => stepDocument(-1) });
registerCommand({ id: "document.choose", title: "Go to the document tabs", keys: ["Alt+Shift+D"], enabled: () => !app && !!docs.reader.active, run: () => tabs.focusActive() });

// The left panel and the palette load on first use, after the first document has painted.
let panelHost: { show(id: string): void } | null = null;
let panelLoading: Promise<void> | null = null;
const narrow = (): boolean => !!window.matchMedia?.("(max-width: 860px)").matches;
async function openPanel(id?: string, focus = false): Promise<void> {
  panel.hidden = false;
  panelToggle.setAttribute("aria-expanded", "true");
  document.body.classList.add("shell-panel-open");
  panelLoading ??= import("./shell/panel").then(module => { panelHost = module.mountPanelHost(panel, id ?? null); });
  try { await panelLoading; }
  catch (error) { panelLoading = null; closePanel(); report(`Could not open the panel: ${errorText(error)}`); return; }
  if (id) panelHost?.show(id);
  if (focus || narrow()) panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
}
function closePanel(): void {
  if (panel.hidden) return;
  const hadFocus = panel.contains(document.activeElement);
  panel.hidden = true;
  panelToggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("shell-panel-open");
  if (hadFocus) panelToggle.focus();
}
panelToggle.addEventListener("click", () => { if (panel.hidden) void openPanel(); else closePanel(); });
// Below 860 px the panel is a drawer over the document: it must never hide what has focus,
// so it closes when focus leaves it, after following a link in it, and on Escape.
panel.addEventListener("focusout", event => {
  const next = event.relatedTarget as Node | null;
  if (narrow() && next && !panel.contains(next) && next !== panelToggle) closePanel();
});
panel.addEventListener("click", event => {
  if (narrow() && (event.target as Element | null)?.closest("#reader-outline a, .shell-library-open")) closePanel();
});
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !event.defaultPrevented && narrow() && !panel.hidden && !modalOpen()) { event.preventDefault(); closePanel(); }
});
if (native.available) {
  registerPanel({ id: "library", title: "Library", mount: host => {
    let teardown: (() => void) | null = null;
    void import("./shell/library-panel").then(module => { teardown = module.mountLibrary(host); },
      error => { host.textContent = `The library could not load: ${errorText(error)}`; });
    return () => teardown?.();
  } });
}
registerPanel({ id: "outline", title: "Outline", mount: host => { host.append(outline); return () => panel.append(outline); } });
registerCommand({ id: "view.panel", title: "Show or hide the library and outline", keys: ["Mod+B"], enabled: () => !app,
  run: () => { if (panel.hidden) void openPanel(undefined, true); else closePanel(); } });
registerCommand({ id: "view.outline", title: "Show the outline", enabled: () => !app, run: () => openPanel("outline", true) });
if (native.available) registerCommand({ id: "view.library", title: "Show the library", enabled: () => !app, run: () => openPanel("library", true) });

let paletteSelection: [number, number] | null = null;
registerCommand({ id: "palette.open", title: "All commands and files…", keys: ["Mod+K"], enabled: () => !app && !changingMode,
  run: async () => {
    paletteSelection = selectionRange(content, window.getSelection());
    let openPalette: typeof import("./shell/palette").openPalette;
    try { ({ openPalette } = await import("./shell/palette")); }
    catch (error) { report(`Could not open the command palette: ${errorText(error)}`); return; }
    const { docs: open, active } = docs.list();
    const labels = documentLabels(open);
    await openPalette({
      documents: () => open.map(doc => ({ id: doc.id, label: labels.get(doc.id)!, active: doc.id === active?.id,
        detail: docs.reader.documents.find(item => item.id === doc.id)?.binding?.dir || "In memory" })),
      recent: async () => native.available
        ? (await native.library.list()).recent.slice(0, 20).map(entry => ({ id: entry.id, label: entry.name, detail: entry.dir }))
        : [],
      activate: activateDocument,
      openRecent: id => { void openFromLibrary(id); },
    });
  } });

/** Ctrl+P: the paginated print/PDF path. The webview's own print of the reading view must never run. */
async function printOrExport(): Promise<void> {
  if (changingMode || nativeSaveBusy) return;
  if (!app) {
    if (!docs.reader.active) return;
    await enterWorkspace();
  }
  await app?.exportPrint();
}
registerCommand({ id: "export.pdf", title: "Print or export PDF…", keys: ["Mod+P"],
  enabled: () => !changingMode && !nativeSaveBusy && !!(app ? app.store.active : docs.reader.active), run: printOrExport });

for (const [choice, title] of [["light", "Light theme"], ["dark", "Dark theme"], ["sepia", "Sepia theme"], ["system", "Follow Windows theme"]] as const) {
  registerCommand({ id: `view.theme.${choice}`, title, run: () => setTheme(choice) });
}
const themeChecked = (choice: string) => (): boolean =>
  choice === "system" ? settings.followSystemTheme : !settings.followSystemTheme && settings.screenTheme === choice;

let pinnedOnTop = false;
if (native.available) {
  registerCommand({ id: "view.pinOnTop", title: "Keep on top of other windows", run: async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setAlwaysOnTop(!pinnedOnTop);
      pinnedOnTop = !pinnedOnTop;
      report(pinnedOnTop ? "MDviewer stays on top of other windows." : "MDviewer no longer stays on top.");
    } catch (error) { report(`Could not change pin on top: ${errorText(error)}`); }
  } });
}

/** Copy text from a command and say what was copied. */
function copyToClipboard(text: string, done: string): void {
  void navigator.clipboard.writeText(text).then(() => report(done), error => report(`Could not copy: ${errorText(error)}`));
}
const bound = () => docs.saveTarget()?.binding;
registerCommand({ id: "document.copyPath", title: "Copy file path", enabled: () => !!bound(), run: () => {
  const binding = bound();
  if (binding) copyToClipboard(binding.path, "Copied the file path.");
} });
registerCommand({ id: "document.copyReference", title: "Copy reference (path and selected lines)", enabled: () => !app && !!docs.reader.active,
  run: async () => {
    const doc = docs.reader.active;
    if (!doc) return;
    let where = doc.binding?.path ?? doc.name;
    if (doc.binding && native.available) {
      // Inside a pinned project the reference is relative to the project root.
      const projects = await native.library.list().then(view => view.projects, () => []);
      const lower = where.toLowerCase();
      const root = projects.map(project => project.path).filter(path => lower.startsWith(`${path.toLowerCase()}\\`) || lower.startsWith(`${path.toLowerCase()}/`))
        .sort((a, b) => b.length - a.length)[0];
      if (root) where = where.slice(root.length + 1).replace(/\\/g, "/");
    }
    // Run from the palette, the reader selection is the one captured when it opened.
    const range = selectionRange(content, window.getSelection()) ?? paletteSelection;
    paletteSelection = null;
    const dataRef = dataReference(doc, content); // a data document names a value path, not a readable-view line
    if (dataRef !== null) { copyToClipboard(where + dataRef, "Copied a reference to the document."); return; }
    copyToClipboard(range ? `${where}:${range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`}` : where, "Copied a reference to the document.");
  } });
// Readable data (D5): copy what the reader's selection sits on, or save the readable view itself.
const DATA_COPY: [DataCopyKind, string][] = [
  ["value", "Copy value"], ["jsonPath", "Copy path (JSONPath)"], ["jq", "Copy path (jq)"], ["subtree", "Copy subtree as JSON"],
];
const hasData = (): boolean => !app && !changingMode && hasValues(docs.reader.active && dataViewOf(docs.reader.active));
for (const [kind, title] of DATA_COPY) {
  registerCommand({ id: `data.copy.${kind}`, title, enabled: hasData, run: () => {
    const doc = docs.reader.active;
    const copied = doc && dataCopy(kind, doc, content);
    if (!copied) return;
    if ("text" in copied) copyToClipboard(copied.text, copied.done);
    else report(copied.problem);
  } });
}
const savingReadable = (): boolean => { const target = docs.saveTarget(); return !!target && !!readableCopy(target); };
registerCommand({ id: "document.saveReadable", title: "Save readable view as Markdown…", enabled: () => !changingMode && !nativeSaveBusy && savingReadable(),
  run: () => {
    const target = docs.saveTarget();
    const copy = target && !changingMode && !nativeSaveBusy ? readableCopy(target) : null;
    if (!copy) return;
    void Promise.resolve(downloadMarkdown(copy.name, copy.text)).then(
      () => report(`Saved the readable view of ${target!.name} as ${copy.name}. The open document is unchanged.`),
      error => { if (!(error instanceof SaveCanceled)) report(`Could not save the readable view: ${errorText(error)}`); },
    );
  } });
registerCommand({ id: "document.reload", title: "Reload from disk", enabled: () => !!bound() && !changingMode && !nativeSaveBusy, run: reloadFromDisk });

const moreMenu: MenuEntry[] = [
  { command: "document.new", id: "reader-new" },
  { command: "document.newFromTemplate" },
  { command: "document.open", id: "reader-open" },
  "separator",
  { command: "document.save", disabled: () => !somethingToSave() },
  { command: "document.saveAs", id: "reader-save-as" },
  { command: "document.saveCopy", id: "reader-save-copy" },
  { command: "document.saveReadable", id: "reader-save-readable", hidden: () => !savingReadable() },
  ...DATA_COPY.map(([kind]): MenuEntry => ({ command: `data.copy.${kind}`, id: `reader-copy-${kind}`, hidden: () => !hasData() })),
  { command: "workspace.enter", id: "reader-workspace" },
  { command: "export.pdf" },
  "separator",
  { command: "view.theme.light", role: "menuitemradio", checked: themeChecked("light") },
  { command: "view.theme.dark", role: "menuitemradio", checked: themeChecked("dark") },
  { command: "view.theme.sepia", role: "menuitemradio", checked: themeChecked("sepia") },
  { command: "view.theme.system", role: "menuitemradio", checked: themeChecked("system") },
  "separator",
  { command: "view.textSmaller" },
  { command: "view.textLarger" },
  { command: "view.pinOnTop", role: "menuitemcheckbox", checked: () => pinnedOnTop },
  "separator",
  { command: "palette.open" },
  { command: "document.close", id: "reader-close" },
];
mountMenu(element<HTMLButtonElement>("shell-more"), element("shell-more-menu"), moreMenu);
document.addEventListener("click", event => {
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || !anchor.closest(".doc, #reader-outline")) return;
  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("#")) return;
  event.preventDefault();
  if (isRelativeReference(href)) { void followRelativeLink(href); return; }
  openWebLink(href);
});

/** The one path for web links, from Markdown documents and from PDFs. */
function openWebLink(href: string): void {
  try {
    const url = new URL(href);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Only web links can open. Local resource links are disabled.");
    if (native.available) void native.external(url.href).catch(error => report(errorText(error)));
    else window.open(url.href, "_blank", "noopener,noreferrer");
  } catch (error) { report(errorText(error)); }
}

/** A reference with no scheme and no root: resolved natively against the document's folder. */
function isRelativeReference(reference: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:|^[\\/]/i.test(reference.trim());
}

// Back/forward through documents reached by links (Alt+Left / Alt+Right).
const backStack: string[] = [];
const forwardStack: string[] = [];
function visit(id: string, from: string | null): void {
  if (!from || from === id) return;
  backStack.push(from);
  forwardStack.length = 0;
  if (backStack.length > 100) backStack.shift();
}
function step(stack: string[], other: string[]): void {
  if (app || changingMode) return;
  const open = new Set(docs.reader.documents.map(doc => doc.id));
  while (stack.length) {
    const id = stack.pop()!;
    if (!open.has(id) || id === docs.reader.activeId) continue;
    if (docs.reader.activeId) other.push(docs.reader.activeId);
    ++generation;
    docs.reader.activeId = id;
    report("");
    void render();
    return;
  }
}

/** Open a relative Markdown link or `@path` import from the active document. */
async function followRelativeLink(href: string): Promise<void> {
  const source = docs.saveTarget();
  if (!native.available || !source?.binding) {
    report("Local links open in the Windows app for documents opened from a file.");
    return;
  }
  if (changingMode) return;
  const from = app ? null : docs.reader.activeId;
  const request = ++generation;
  report("");
  try {
    commitBatch(await native.openRelative(source.binding.token, href), request);
    if (!app && docs.reader.activeId) visit(docs.reader.activeId, from);
  } catch (error) { report(errorText(error)); }
}

// Local images: the sanitizer keeps a relative src inert as data-local-src; the
// host reads it (typed, 20 MB cap) relative to this document's own folder.
const imageUrls: string[] = [];
/** Loaded local images by source, until the next full render: block patches reuse them. */
const imageCache = new Map<string, string | null>();
let imageBytesHeld = 0;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
};
function releaseImages(): void {
  imageCache.clear();
  imageBytesHeld = 0;
  for (const url of imageUrls.splice(0)) URL.revokeObjectURL(url);
}
// Bound what one document can make the reader hold: distinct images and bytes.
const MAX_LOCAL_IMAGES = 100;
const MAX_LOCAL_IMAGE_BYTES = 200 * 1024 * 1024;
async function loadLocalImages(root: HTMLElement, token: string, current: number): Promise<void> {
  const loaded = imageCache;
  for (const image of root.querySelectorAll<HTMLImageElement>("img[data-local-src]")) {
    if (image.src.startsWith("blob:")) continue; // kept by a block patch, already loaded
    const src = image.dataset.localSrc!;
    const type = IMAGE_TYPES[src.split(/[?#]/, 1)[0]!.split(".").pop()?.toLowerCase() ?? ""];
    if (!type) continue;
    if (!loaded.has(src)) {
      if (loaded.size >= MAX_LOCAL_IMAGES || imageBytesHeld >= MAX_LOCAL_IMAGE_BYTES) {
        image.alt ||= `${src} was not loaded: this document shows too many local images`;
        continue;
      }
      try {
        const bytes = await native.readAsset(token, src);
        if (current !== renderGeneration) return; // A newer render owns the DOM now.
        imageBytesHeld += bytes.byteLength;
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        imageUrls.push(url);
        loaded.set(src, url);
      } catch { loaded.set(src, null); }
    }
    const url = loaded.get(src);
    if (url) image.src = url;
    else image.alt ||= `${src} could not be loaded`;
  }
}

function hasUnsavedWork(): boolean {
  return docs.hasUnsavedWork();
}
window.addEventListener("beforeunload", event => {
  if (!changingMode && !nativeSaveBusy && !app?.exportState.busy && !hasUnsavedWork()) return;
  event.preventDefault(); event.returnValue = "";
});
if (native.available) {
  setLibraryOpener(openFromLibrary);
  registerCommand({ id: "library.pinDocument", title: "Pin this document to the library",
    enabled: () => !!docs.saveTarget()?.binding,
    run: async () => {
      const target = docs.saveTarget();
      if (!target?.binding) return;
      report(await native.library.pinDocument(target.binding.token)
        ? `Pinned ${target.name}.` : "Unpin a file first: at most 64 can be pinned.");
      window.dispatchEvent(new Event("mdviewer:library-changed"));
    } });
  registerCommand({ id: "library.addProject", title: "Pin a project folder…", enabled: () => !changingMode && !nativeSaveBusy,
    run: async () => {
      try { if (await native.library.addProject()) { report("Project pinned to the library."); window.dispatchEvent(new Event("mdviewer:library-changed")); } }
      catch (error) { report(errorText(error)); }
    } });
  registerCommand({ id: "session.toggleRestore", title: "Reopen last session on launch (on/off)",
    run: async () => {
      const current = await native.session.setting(null);
      const next = await native.session.setting(!current.restore);
      if (!next.persisted) { report("The preference could not be saved; it applies until MDviewer closes."); return; }
      report(next.restore ? "MDviewer will reopen your open files next time." : "MDviewer will start empty next time.");
    } });
  registerCommand({ id: "library.clear", title: "Clear library (recent files, pins and projects)",
    run: async () => {
      if (!window.confirm("Clear the library? Recent files, pinned files and pinned projects are forgotten. No file is deleted.")) return;
      try { await native.library.clear(); report("Library cleared."); window.dispatchEvent(new Event("mdviewer:library-changed")); }
      catch (error) { report(errorText(error)); }
    } });
  docs.onRelease = token => { void native.releaseDocument(token).catch(() => undefined); };
  setDownloadDestination(async (blob, filename) => {
    if (nativeSaveBusy) throw new Error("A save dialog is already open.");
    nativeSaveBusy = true;
    syncDocuments();
    try {
      const result = await native.save(blob, filename);
      if (result.canceled) throw new SaveCanceled();
    } finally {
      nativeSaveBusy = false;
      syncDocuments();
    }
  });
  const drain = drainSerially(async () => {
    const startedAt = generation;
    try {
      const batch = await native.takePending();
      // Coalesced notifications may produce an empty second drain. Only a new
      // batch owns selection or notices; an empty queue must not invalidate an
      // in-flight picker. A real batch remains passive after a newer user action.
      if (!batch.documents.length && !batch.errors.length) return;
      const request = startedAt === generation ? ++generation : startedAt;
      report("");
      commitBatch(batch, request);
    }
    catch (error) { report(`Could not open launched files: ${errorText(error)}`); }
  });
  void (async () => {
    await native.onPending(() => { void drain(); });
    await native.onFilesChanged(tokens => { for (const token of tokens) void followChange(token); });
    await native.onClose(() => {
      if (changingMode || nativeSaveBusy || app?.exportState.busy) {
        report("Please wait for the current operation to finish before closing MDviewer.");
        return false;
      }
      return !hasUnsavedWork() || window.confirm("Close MDviewer and discard unsaved edits? Use Save (Ctrl+S) to keep them.");
    }, flushSession);
    await drain();
    // Reopen the last session's files after launch files, without taking focus
    // from them (paths only; the preference is on by default).
    try {
      const startedAt = generation;
      const restored = await native.session.restore();
      if (restored.documents.length || restored.errors.length) {
        // Like a forwarded batch: a newer user action (an Open click) keeps ownership.
        const owns = startedAt === generation && !docs.reader.activeId && !app;
        commitBatch({ ...restored, errors: restored.errors.length
          ? [{ name: "Last session", message: `${restored.errors.length} file(s) could not be reopened.` }] : [] },
        owns ? ++generation : -1);
      }
      sessionReady = true;
      recordSession();
    } catch { /* A missing or unreadable library never blocks startup; nothing is recorded. */ }
  })().catch(error => report(`Desktop integration failed: ${errorText(error)}`));
}
syncDocuments();
