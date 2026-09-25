/**
 * Vite entry point.
 *
 * Imports the five stylesheets in their pinned cascade order, boots the App against the
 * #app host, and wires the bundled sample document so a first-time user can preview the
 * page-break-safe output without supplying a file.
 *
 * CSS order is load-bearing (IMPLEMENTATION_SPEC §"CSS ARCHITECTURE"):
 *   app.css      → grid shell / toolbar / chrome / data-app-theme tokens
 *   editor.css   → screen-only split workspace: source pane, divider, view modes
 *   preview.css  → screen-only .pagedjs_page sheets, drag overlay, spinner, empty state
 *   document.css → rendered-document typography / callouts / toc / footnotes
 *   print.css    → static @page base + no-slice break rules (also ?raw-imported by cssBuilder)
 *   shiki.css    → screen-dark + print-light code colors + line-number counters
 *   pwa.css      → screen-only service-worker update prompt (owned by this file)
 *
 * It also registers the service worker. That lives here rather than in App because it is a
 * document-level concern with no coupling to the render pipeline, and because the update
 * prompt must be able to appear whether or not a document is currently loaded.
 */

import "./styles/app.css";
import "./styles/editor.css";
import "./styles/preview.css";
import "./styles/document.css";
import "./styles/print.css";
import "./styles/shiki.css";
import "./styles/pwa.css";

import { registerSW } from "virtual:pwa-register";
import { App } from "./app/App";
import { mountUpdatePrompt, type UpdatePromptController } from "./ui/UpdatePrompt";
import { IDS } from "./app/dom";

const root = document.getElementById(IDS.app);
if (!root) {
  throw new Error(`Missing #${IDS.app} host element — check index.html.`);
}

const app = App.init(root);

// Stable programmatic hook onto the running App (typed in src/types/window.d.ts). The e2e
// suite drives settings/exports through this instead of coupling to toolbar DOM; it also
// aids manual debugging. It only forwards to existing public methods — no doc content flows
// through it, so the local-first contract is preserved.
window.__mdviewer = {
  updateSettings: (patch) => app.updateSettings(patch),
  exportPrint: () => app.exportPrint(),
  exportPdf: () => app.exportPdf(),
  loadSample: () => app.loadSample(),
};

// The empty-state card already routes its own "Try a sample" button through App. We also
// expose the loader on a header-level affordance if one is present in the chrome.
const sampleTrigger = document.querySelector<HTMLElement>("[data-action='load-sample']");
sampleTrigger?.addEventListener("click", (e) => {
  e.preventDefault();
  app.loadSample();
});

/* -----------------------------------------------------------------------------
 * Service worker: offline support without ever touching the network at runtime.
 *
 * The worker precaches the built bundle — including every chunk that is only
 * dynamically imported (Paged.js, Mermaid, jsPDF/html2canvas-pro, the curated Shiki
 * grammars) and the KaTeX web fonts — so exporting a PDF or rendering math works on a
 * plane, not just the shell. See the `workbox` block in vite.config.ts. There is no
 * runtime caching rule: MDviewer's local-first contract means the only requests that
 * exist are same-origin requests for its own assets.
 *
 * `registerType: "prompt"` means a newly deployed bundle waits. It must: swapping code
 * mid-session would abandon whatever Markdown the user has typed and could tear a
 * render/paginate cycle in half. The prompt below is the only way an update is applied.
 * -------------------------------------------------------------------------- */

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
  // In vite-plugin-pwa 1.3, the reloadPage argument is ignored. This hook is
  // required to suppress its default reload; the native fallback and this signal
  // converge on the same idempotent handoff instead of requesting two navigations.
  onNeedReload() {
    updatePrompt?.notifyReady();
  },
  onRegisterError(error) {
    console.warn("MDviewer: service worker registration failed; offline support is unavailable.", error);
  },
});
