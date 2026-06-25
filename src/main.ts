/**
 * Vite entry point.
 *
 * Imports the five stylesheets in their pinned cascade order, boots the App against the
 * #app host, and wires the bundled sample document so a first-time user can preview the
 * page-break-safe output without supplying a file.
 *
 * CSS order is load-bearing (IMPLEMENTATION_SPEC §"CSS ARCHITECTURE"):
 *   app.css      → grid shell / toolbar / chrome / data-app-theme tokens
 *   preview.css  → screen-only .pagedjs_page sheets, drag overlay, spinner, empty state
 *   document.css → rendered-document typography / callouts / toc / footnotes
 *   print.css    → static @page base + no-slice break rules (also ?raw-imported by cssBuilder)
 *   shiki.css    → screen-dark + print-light code colors + line-number counters
 */

import "./styles/app.css";
import "./styles/preview.css";
import "./styles/document.css";
import "./styles/print.css";
import "./styles/shiki.css";

import { App } from "./app/App";
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
