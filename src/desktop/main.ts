import "../styles/document.css";
import "../styles/shiki.css";
import "./reader.css";
import { loadSettings, saveSettings } from "../app/settings";
import { SIZE_HARD_BYTES, SIZE_SOFT_BYTES, isMarkdownFile } from "../app/input";
import { SAMPLE_MARKDOWN } from "../app/sampleDoc";
import type { App } from "../app/App";
import type { Doc } from "../app/state";
import { native, type OpenBatch, type ReadResult, type SaveResult } from "./native";
import { decodeMarkdown, drainSerially, nextUntitledName } from "./session";
import { DesktopDocuments, type SaveTarget } from "./documents";
import { installShortcuts, registerCommand } from "./commands";
import { renderReaderDocument } from "./render";
import { SaveCanceled, setDownloadDestination } from "../export/destination";
import { downloadMarkdown } from "../export/markdown";
import { documentLabels, mountDocumentNavigation } from "../ui/DocumentNavigation";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing reader element: ${id}`);
  return node as T;
}

const shell = element("reader-shell");
const content = element("reader-document");
const empty = element("reader-empty");
const outline = element("reader-outline");
const select = element<HTMLSelectElement>("reader-documents");
const notice = element("reader-notice");
const workspaceNotice = element("workspace-notice");
const appRoot = element("app");
const scroll = element("reader-scroll");
const status = element("reader-status");
const fileInput = element<HTMLInputElement>("reader-file-input");
const workspace = element("desktop-workspace");
const workspaceButton = element<HTMLButtonElement>("reader-workspace");
const newButtons = [element<HTMLButtonElement>("reader-new"), element<HTMLButtonElement>("reader-new-empty")];
const closeButton = element<HTMLButtonElement>("reader-close");
const returnButton = element<HTMLButtonElement>("reader-return");
const settings = loadSettings();
// The single owner of open documents across reading and the PDF workspace.
const docs = new DesktopDocuments();
let app: App | null = null;
let detachWorkspace: (() => void) | null = null;
let changingMode = false;
let generation = 0;
let renderGeneration = 0;
let noticeGeneration = 0;
let renderChain: Promise<void> = Promise.resolve();
let textSize = 17;
let nativeSaveBusy = false;
const queuedBatches: Array<{ batch: OpenBatch; request: number }> = [];
let renderedReaderId: string | null = null;
const readerNavigation = mountDocumentNavigation(shell, select,
  element<HTMLButtonElement>("reader-previous"), element<HTMLButtonElement>("reader-next"),
  shell.querySelector<HTMLElement>(".reader-footer")!);

const theme = element<HTMLSelectElement>("reader-theme");
theme.value = settings.screenTheme;
document.documentElement.dataset.appTheme = settings.screenTheme;

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

function syncDocuments(): void {
  const { docs: open, active } = docs.list();
  const labels = documentLabels(open);
  select.replaceChildren(...open.map(doc => {
    const option = new Option(`${doc.dirty ? "• " : ""}${labels.get(doc.id)!}`, doc.id);
    option.selected = doc.id === active?.id;
    return option;
  }));
  if (!open.length) select.append(new Option("No document open", ""));
  select.disabled = !open.length || changingMode;
  readerNavigation.sync();
  closeButton.disabled = !active;
  workspaceButton.disabled = !active || changingMode || nativeSaveBusy;
  const workspaceBusy = changingMode || nativeSaveBusy || !!app?.exportState.busy;
  returnButton.disabled = workspaceBusy;
  for (const button of newButtons) button.disabled = workspaceBusy;
  const workspaceNew = appRoot.querySelector<HTMLButtonElement>('.workspace-actions > button[data-document-command="new"]');
  if (workspaceNew) workspaceNew.disabled = workspaceBusy;
  for (const button of appRoot.querySelectorAll<HTMLButtonElement>("button[data-desktop-command]")) {
    button.disabled = workspaceBusy || !active;
  }
  document.title = active ? `${active.name} — MDviewer` : "MDviewer";
  const target = docs.saveTarget();
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

function render(importErrors: readonly string[] = []): Promise<void> {
  rememberReaderPosition();
  renderedReaderId = null;
  const current = ++renderGeneration;
  const currentNotice = noticeGeneration;
  const doc = docs.reader.active;
  syncDocuments();
  outline.replaceChildren();
  outline.hidden = true;
  content.hidden = !doc;
  empty.hidden = !!doc;
  if (!doc) {
    content.replaceChildren();
    status.textContent = "Local files · No uploads";
    return Promise.resolve();
  }
  content.setAttribute("aria-busy", "true");
  content.replaceChildren(); // A failed new document must not display the previous file's contents.
  status.textContent = `Opening ${doc.name}…`;
  // Mermaid's singleton is not re-entrant; serialize and skip obsolete renders.
  renderChain = renderChain.catch(() => undefined).then(async () => {
    if (current !== renderGeneration) return;
    try {
      const result = await renderReaderDocument(doc.text, settings);
      if (current !== renderGeneration) return;
      content.replaceChildren(...result.document.childNodes);
      content.setAttribute("data-code-theme", settings.codeTheme);
      content.setAttribute("aria-busy", "false");
      for (const heading of content.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id]")) {
        const link = document.createElement("a");
        link.href = `#${encodeURIComponent(heading.id)}`;
        link.textContent = heading.textContent;
        link.dataset.level = heading.tagName;
        outline.append(link);
      }
      outline.hidden = outline.childElementCount < 2;
      // The outline changes text wrapping and the maximum scroll offset. Reveal
      // it first so saved offsets clamp against the final reader geometry.
      const position = docs.reader.positions.get(doc.id)?.reader;
      const previousBehavior = scroll.style.scrollBehavior;
      scroll.style.scrollBehavior = "auto";
      scroll.scrollTop = position?.scrollTop ?? 0;
      scroll.scrollLeft = position?.scrollLeft ?? 0;
      scroll.style.scrollBehavior = previousBehavior;
      renderedReaderId = doc.id;
      status.textContent = `${doc.name} · ${new TextEncoder().encode(doc.text).length.toLocaleString()} bytes · Reading view`;
      // A new open/action may have reported a newer failure while this render ran.
      if (result.warnings.length && currentNotice === noticeGeneration) {
        report([...importErrors, ...result.warnings].join(" "));
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

function commitBatch(batch: OpenBatch, request: number): void {
  if (changingMode) { queuedBatches.push({ batch, request }); return; }
  const errors = batch.errors.map(error => `${error.name}: ${error.message}`);
  const previousActiveId = docs.reader.activeId;
  errors.push(...docs.addBatch(batch.documents, request === generation));
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
  report("");
  for (const file of files.slice(0, 32)) {
    try {
      if (!isMarkdownFile(file.name, file.type)) throw new Error("Only Markdown files are supported.");
      if (file.size > SIZE_HARD_BYTES || total + file.size > SIZE_HARD_BYTES) throw new Error("This batch exceeds the 25 MB limit.");
      if (file.size > SIZE_SOFT_BYTES && !window.confirm(`Open ${file.name}? Large documents can take longer to render.`)) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > SIZE_HARD_BYTES || total + bytes.length > SIZE_HARD_BYTES) throw new Error("This batch exceeds the 25 MB limit.");
      total += bytes.length;
      batch.documents.push({ name: file.name, text: decodeMarkdown(bytes), bytes: bytes.length });
    } catch (error) {
      batch.errors.push({ name: file.name, message: errorText(error) });
    }
  }
  if (files.length > 32) batch.errors.push({ name: "Extra files", message: "Open at most 32 files at once." });
  commitBatch(batch, request);
}

async function open(): Promise<void> {
  if (changingMode) return;
  if (!native.available) { fileInput.click(); return; }
  const request = ++generation;
  report("");
  try { commitBatch(await native.open(), request); }
  catch (error) { report(`Could not open files: ${errorText(error)}`); }
}

async function createDocument(): Promise<void> {
  if (changingMode || nativeSaveBusy || app?.exportState.busy) return;
  const doc = { name: nextUntitledName(app ? app.store.openDocs : docs.reader.documents), text: "" };
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
  await enterWorkspace(true);
}

async function enterWorkspace(revealEditor = false): Promise<void> {
  // A pending save must finish before its document changes owner (FILE_LIFECYCLE).
  if (app || changingMode || nativeSaveBusy || !docs.reader.active) return;
  rememberReaderPosition();
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
    const mounted = startWorkspace(appRoot, () => { void open(); }, canRestoreDocument, createDocument,
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
    theme.value = settings.screenTheme;
    document.documentElement.dataset.appTheme = settings.screenTheme;
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
  const doc = docs.reader.active;
  if (!doc || changingMode) return;
  if (nativeSaveBusy) { report("Wait for the save to finish before closing this document."); return; }
  if (doc.dirty && !window.confirm(`Discard unsaved edits to ${doc.name}?`)) return;
  ++generation;
  docs.closeReaderDocument(doc.id);
  report("");
  void render();
}

element("reader-open").addEventListener("click", () => { void open(); });
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
select.addEventListener("change", () => {
  if (changingMode || docs.reader.activeId === select.value) return;
  ++generation; docs.reader.activeId = select.value; report(""); void render();
});
closeButton.addEventListener("click", closeDocument);
workspaceButton.addEventListener("click", () => { void enterWorkspace(); });
returnButton.addEventListener("click", () => { void returnToReader(); });
function openSample(): void {
  ++generation;
  const errors = docs.reader.append([{ name: "Sample.md", text: SAMPLE_MARKDOWN }]);
  report(errors.join(" "));
  void render(errors);
}
element("reader-sample").addEventListener("click", openSample);
theme.addEventListener("change", () => {
  if (!["light", "dark", "sepia"].includes(theme.value)) return;
  settings.screenTheme = theme.value as typeof settings.screenTheme;
  document.documentElement.dataset.appTheme = settings.screenTheme;
  saveSettings({ ...loadSettings(), screenTheme: settings.screenTheme });
});
function resizeText(delta: number): void {
  textSize = Math.min(26, Math.max(13, textSize + delta));
  content.style.setProperty("--reader-text-size", `${textSize}px`);
}
for (const [id, delta] of [["reader-smaller", -1], ["reader-larger", 1]] as const) {
  element(id).addEventListener("click", () => resizeText(delta));
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
      const applied = docs.completeSave(target, captured, result);
      syncDocuments();
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
registerCommand({ id: "document.new", title: "New document", keys: ["Mod+N"], enabled: reading, run: createDocument });
registerCommand({ id: "document.open", title: "Open files…", keys: ["Mod+O"], enabled: reading, run: open });
registerCommand({ id: "document.close", title: "Close document", keys: ["Mod+W"], enabled: reading, run: closeDocument });
registerCommand({ id: "workspace.enter", title: "Edit & PDF", enabled: () => !app && !changingMode && !!docs.reader.active, run: () => enterWorkspace() });
registerCommand({ id: "workspace.return", title: "Return to reading", enabled: () => !!app && !changingMode, run: returnToReader });
registerCommand({ id: "document.sample", title: "Open sample document", enabled: () => !app && !changingMode, run: openSample });
registerCommand({ id: "view.textSmaller", title: "Smaller text", enabled: () => !app, run: () => resizeText(-1) });
registerCommand({ id: "view.textLarger", title: "Larger text", enabled: () => !app, run: () => resizeText(1) });
installShortcuts(window, command => !app && !command.id.startsWith("document.save"));
// Save works in every mode and must claim Ctrl+S before the workspace's own
// Save Markdown (copy) shortcut, so it listens in the capture phase.
const saving = (): boolean => native.available && !changingMode && !nativeSaveBusy && !app?.exportState.busy;
registerCommand({ id: "document.save", title: "Save", keys: ["Mod+S"], enabled: saving, run: () => saveDocument(false) });
registerCommand({ id: "document.saveAs", title: "Save As…", keys: ["Mod+Shift+S"], enabled: saving, run: () => saveDocument(true) });
registerCommand({ id: "document.saveCopy", title: "Save a copy…", enabled: () => !changingMode && !nativeSaveBusy, run: saveCopy });
installShortcuts(window, command => native.available && command.id.startsWith("document.save"), { capture: true });
document.addEventListener("click", event => {
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || !anchor.closest(".doc, #reader-outline")) return;
  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("#")) return;
  event.preventDefault();
  try {
    const url = new URL(href);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Only web links can open. Local resource links are disabled.");
    if (native.available) void native.external(url.href).catch(error => report(errorText(error)));
    else window.open(url.href, "_blank", "noopener,noreferrer");
  } catch (error) { report(errorText(error)); }
});

function hasUnsavedWork(): boolean {
  return docs.hasUnsavedWork();
}
window.addEventListener("beforeunload", event => {
  if (!changingMode && !nativeSaveBusy && !app?.exportState.busy && !hasUnsavedWork()) return;
  event.preventDefault(); event.returnValue = "";
});
if (native.available) {
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
    });
    await drain();
  })().catch(error => report(`Desktop integration failed: ${errorText(error)}`));
}
syncDocuments();
