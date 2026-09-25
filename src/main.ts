/**
 * Vite entry point. The stylesheet order is pinned: app, editor, preview,
 * document, workspace, print, shiki, pwa. Workspace chrome must never change
 * document typography or the generated Paged.js stylesheet.
 *
 * Service-worker activation and the explicitly accepted document reload are
 * separate. The entry point connects plugin/native readiness to one controller.
 */
import "./styles/app.css";
import "./styles/editor.css";
import "./styles/preview.css";
import "./styles/document.css";
import "./styles/workspace.css";
import "./styles/print.css";
import "./styles/shiki.css";
import "./styles/pwa.css";

import { registerSW } from "virtual:pwa-register";
import { App } from "./app/App";
import { mountUpdatePrompt, type UpdatePromptController } from "./ui/UpdatePrompt";
import { mountDocumentShortcuts } from "./ui/DocumentShortcuts";
import { IDS } from "./app/dom";

const root = document.getElementById(IDS.app);
if (!root) throw new Error(`Missing #${IDS.app} host element — check index.html.`);
const app = App.init(root);
const detachDocumentShortcuts = mountDocumentShortcuts(root);
import.meta.hot?.dispose(detachDocumentShortcuts);

// Forward only existing public methods; no document content is persisted here.
window.__mdviewer = {
  updateSettings: (patch) => app.updateSettings(patch),
  exportPrint: () => app.exportPrint(),
  exportPdf: () => app.exportPdf(),
  loadSample: () => app.loadSample(),
};

const sampleTrigger = document.querySelector<HTMLElement>("[data-action='load-sample']");
sampleTrigger?.addEventListener("click", (event) => {
  event.preventDefault();
  app.loadSample();
});

// Prompt-mode precaching remains owned by vite.config.ts. Do not introduce
// runtime caching, document uploads, or an automatic mid-session reload.
let updatePrompt: UpdatePromptController | null = null;
const updateSW = registerSW({
  onNeedRefresh() {
    if (updatePrompt) return;
    updatePrompt = mountUpdatePrompt({
      applyUpdate: () => updateSW(),
      requestReload: () => app.reloadForUpdate(),
      activationTarget: navigator.serviceWorker,
      onDismiss: () => { updatePrompt = null; },
    });
  },
  // vite-plugin-pwa 1.3 ignores the reloadPage argument. This hook suppresses
  // its default location.reload. Native and plugin signals deduplicate inside
  // UpdatePrompt, including the first-registration update case.
  onNeedReload() {
    updatePrompt?.notifyReady();
  },
  onRegisterError(error) {
    console.warn("MDviewer: service worker registration failed; offline support is unavailable.", error);
  },
});
