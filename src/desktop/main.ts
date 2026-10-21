import "../styles/document.css";
import "../styles/shiki.css";
import "./reader.css";
import { loadSettings, saveSettings } from "../app/settings";
import { SIZE_HARD_BYTES, SIZE_SOFT_BYTES, isMarkdownFile } from "../app/input";
import { SAMPLE_MARKDOWN } from "../app/sampleDoc";
import type { App } from "../app/App";
import { native, type OpenBatch } from "./native";
import { ReaderSession, decodeMarkdown, drainSerially } from "./session";
import { renderReaderDocument } from "./render";
import { SaveCanceled, setDownloadDestination } from "../export/destination";

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
const closeButton = element<HTMLButtonElement>("reader-close");
const returnButton = element<HTMLButtonElement>("reader-return");
const settings = loadSettings();
let session = new ReaderSession();
let app: App | null = null;
let detachWorkspace: (() => void) | null = null;
let changingMode = false;
let generation = 0;
let renderGeneration = 0;
let renderChain: Promise<void> = Promise.resolve();
let textSize = 17;
let nativeSaveBusy = false;
const queuedBatches: Array<{ batch: OpenBatch; request: number }> = [];
let workspaceOriginals = new Map<string, { name: string; text: string; dirty: boolean }>();

const theme = element<HTMLSelectElement>("reader-theme");
theme.value = settings.screenTheme;
document.documentElement.dataset.appTheme = settings.screenTheme;

function report(message: string): void {
  notice.textContent = message;
  notice.hidden = !message;
  workspaceNotice.textContent = message;
  workspaceNotice.hidden = !message;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function syncDocuments(): void {
  select.replaceChildren(...session.documents.map(doc => {
    const option = new Option(`${doc.dirty ? "• " : ""}${doc.name}`, doc.id);
    option.selected = doc.id === session.activeId;
    return option;
  }));
  if (!session.documents.length) select.append(new Option("No document open", ""));
  select.disabled = !session.documents.length;
  closeButton.disabled = !session.active;
  workspaceButton.disabled = !session.active || changingMode;
  document.title = session.active ? `${session.active.name} — MDviewer` : "MDviewer";
}

function render(): Promise<void> {
  const current = ++renderGeneration;
  const doc = session.active;
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
      scroll.scrollTop = 0;
      for (const heading of content.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id]")) {
        const link = document.createElement("a");
        link.href = `#${encodeURIComponent(heading.id)}`;
        link.textContent = heading.textContent;
        link.dataset.level = heading.tagName;
        outline.append(link);
      }
      outline.hidden = outline.childElementCount < 2;
      status.textContent = `${doc.name} · ${new TextEncoder().encode(doc.text).length.toLocaleString()} bytes · Reading view`;
      if (result.warnings.length) report(result.warnings.join(" "));
    } catch (error) {
      if (current !== renderGeneration) return;
      content.setAttribute("aria-busy", "false");
      report(`Could not render ${doc.name}: ${errorText(error)}`);
      status.textContent = "Rendering failed. You can still open Edit & PDF or another file.";
    }
  });
  return renderChain;
}

function commitBatch(batch: OpenBatch, request: number): void {
  if (changingMode) { queuedBatches.push({ batch, request }); return; }
  const errors = batch.errors.map(error => `${error.name}: ${error.message}`);
  if (app) {
    const bounded = new ReaderSession();
    // Seed the gate without dropping existing edits that have grown since opening.
    bounded.documents.push(...app.store.openDocs.map(doc => ({ ...doc, dirty: false })));
    const count = bounded.documents.length;
    errors.push(...bounded.append(batch.documents));
    const added = app.store.addBatch(bounded.documents.slice(count), request === generation || app.store.activeId === null);
    for (const doc of added) workspaceOriginals.set(doc.id, { ...doc, dirty: false });
  } else {
    errors.push(...session.append(batch.documents, request === generation));
    if (batch.documents.length) void render();
  }
  if (errors.length) report(errors.join(" "));
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

async function enterWorkspace(): Promise<void> {
  if (app || changingMode || !session.active) return;
  changingMode = true; ++generation; ++renderGeneration;
  syncDocuments();
  try {
    await renderChain;
    const { startWorkspace } = await import("./workspace");
    shell.hidden = true;
    workspace.hidden = false;
    document.body.classList.add("desktop-editing");
    // App's canonical IDs must not collide with authored IDs in the reading DOM.
    content.replaceChildren();
    const mounted = startWorkspace(appRoot, () => { void open(); });
    app = mounted.app;
    const selected = session.documents.findIndex(doc => doc.id === session.activeId);
    const added = app.store.addBatch(session.documents);
    workspaceOriginals = new Map(added.map((doc, index) => [doc.id, session.documents[index]!]));
    if (added[selected]) app.store.setActive(added[selected]!.id);
    const offText = app.store.on("text", () => { generation += 1; });
    let activeId = app.store.activeId;
    const offChange = app.store.on("change", () => {
      if (app && app.store.activeId !== activeId) { activeId = app.store.activeId; generation += 1; }
    });
    const offExport = app.onExportStateChange(state => { returnButton.disabled = state.busy || nativeSaveBusy; });
    detachWorkspace = () => { mounted.detachShortcuts(); offText(); offChange(); offExport(); };
    content.replaceChildren(); // Release the reader DOM while the PDF workspace owns the document.
    await app.flushRender();
    app.focusEditor();
  } catch (error) {
    report(`Could not open the editing workspace: ${errorText(error)}`);
    if (!app) {
      workspace.hidden = true; shell.hidden = false; document.body.classList.remove("desktop-editing");
      void render();
    }
  } finally { finishMode(); }
}

async function returnToReader(): Promise<void> {
  if (!app || changingMode || app.exportState.busy || nativeSaveBusy) return;
  changingMode = true; ++generation;
  returnButton.disabled = true;
  try {
    await app.flushRender();
    const next = new ReaderSession();
    const errors = next.append(app.store.openDocs.map(doc => ({
      name: doc.name, text: doc.text,
      dirty: workspaceOriginals.get(doc.id)?.text !== doc.text || !!workspaceOriginals.get(doc.id)?.dirty,
    })));
    if (errors.length) throw new Error(errors.join(" "));
    const index = app.store.openDocs.findIndex(doc => doc.id === app!.store.activeId);
    next.activeId = next.documents[index]?.id ?? next.activeId;
    for (const doc of [...app.store.openDocs]) app.store.remove(doc.id);
    await app.flushRender(); // Tear down Paged.js while its canvas still exists.
    detachWorkspace?.(); detachWorkspace = null;
    app.destroy(); app = null;
    appRoot.replaceChildren();
    workspace.hidden = true; shell.hidden = false;
    document.body.classList.remove("desktop-editing");
    Object.assign(settings, loadSettings());
    theme.value = settings.screenTheme;
    document.documentElement.dataset.appTheme = settings.screenTheme;
    session = next;
    report("");
    await render();
    content.focus();
  } catch (error) { report(`Could not return to reading: ${errorText(error)}`); }
  finally { returnButton.disabled = false; finishMode(); }
}

function finishMode(): void {
  changingMode = false;
  for (const { batch, request } of queuedBatches.splice(0)) commitBatch(batch, request);
  syncDocuments();
}

function closeDocument(): void {
  const doc = session.active;
  if (!doc || changingMode) return;
  if (doc.dirty && !window.confirm(`Discard unsaved edits to ${doc.name}?`)) return;
  ++generation;
  session.close(doc.id);
  report("");
  void render();
}

element("reader-open").addEventListener("click", () => { void open(); });
for (const input of [fileInput, element<HTMLInputElement>("file-input")]) {
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    void readFiles(files);
  });
}
appRoot.addEventListener("click", event => {
  const button = (event.target as Element | null)?.closest("button.doc-close");
  const doc = app?.store.active;
  if (!button || !doc) return;
  const original = workspaceOriginals.get(doc.id);
  const dirty = !original || original.dirty || original.text !== doc.text || original.name !== doc.name;
  if (dirty && !window.confirm(`Discard unsaved edits to ${doc.name}?`)) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
select.addEventListener("change", () => { ++generation; session.activeId = select.value; report(""); void render(); });
closeButton.addEventListener("click", closeDocument);
workspaceButton.addEventListener("click", () => { void enterWorkspace(); });
returnButton.addEventListener("click", () => { void returnToReader(); });
element("reader-sample").addEventListener("click", () => {
  ++generation;
  report(session.append([{ name: "Sample.md", text: SAMPLE_MARKDOWN }]).join(" "));
  void render();
});
theme.addEventListener("change", () => {
  if (!["light", "dark", "sepia"].includes(theme.value)) return;
  settings.screenTheme = theme.value as typeof settings.screenTheme;
  document.documentElement.dataset.appTheme = settings.screenTheme;
  saveSettings({ ...loadSettings(), screenTheme: settings.screenTheme });
});
for (const [id, delta] of [["reader-smaller", -1], ["reader-larger", 1]] as const) {
  element(id).addEventListener("click", () => {
    textSize = Math.min(26, Math.max(13, textSize + delta));
    content.style.setProperty("--reader-text-size", `${textSize}px`);
  });
}
window.addEventListener("dragover", event => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
window.addEventListener("drop", event => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  void readFiles(Array.from(event.dataTransfer.files));
});
window.addEventListener("keydown", event => {
  if (app || changingMode || event.altKey || !(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "o") { event.preventDefault(); void open(); }
  if (event.key.toLowerCase() === "w") { event.preventDefault(); closeDocument(); }
});
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
  if (!app) return session.documents.some(doc => doc.dirty);
  return app.store.openDocs.some(doc => {
    const original = workspaceOriginals.get(doc.id);
    return !original || original.dirty || original.text !== doc.text || original.name !== doc.name;
  });
}
window.addEventListener("beforeunload", event => {
  if (!changingMode && !nativeSaveBusy && !app?.exportState.busy && !hasUnsavedWork()) return;
  event.preventDefault(); event.returnValue = "";
});
if (native.available) {
  setDownloadDestination(async (blob, filename) => {
    if (nativeSaveBusy) throw new Error("A save dialog is already open.");
    nativeSaveBusy = true;
    returnButton.disabled = true;
    try {
      const result = await native.save(blob, filename);
      if (result.canceled) throw new SaveCanceled();
    } finally {
      nativeSaveBusy = false;
      returnButton.disabled = changingMode || !!app?.exportState.busy;
    }
  });
  const drain = drainSerially(async () => {
    const request = ++generation;
    try { commitBatch(await native.takePending(), request); }
    catch (error) { report(`Could not open launched files: ${errorText(error)}`); }
  });
  void (async () => {
    await native.onPending(() => { void drain(); });
    await native.onClose(() => {
      if (changingMode || nativeSaveBusy || app?.exportState.busy) {
        report("Please wait for the current operation to finish before closing MDviewer.");
        return false;
      }
      return !hasUnsavedWork() || window.confirm("Close MDviewer and discard unsaved edits? Use Save Markdown to keep them.");
    });
    await drain();
  })().catch(error => report(`Desktop integration failed: ${errorText(error)}`));
}
syncDocuments();
