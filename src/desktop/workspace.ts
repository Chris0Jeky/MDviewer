// This entire module is imported only after an explicit Edit & PDF action.
import "../styles/app.css";
import "../styles/editor.css";
import "../styles/preview.css";
import "../styles/workspace.css";
import "../styles/print.css";
import { App } from "../app/App";
import type { RestoreAdmission } from "../ui/DocumentRecovery";
import { mountDocumentShortcuts } from "../ui/DocumentShortcuts";

export function startWorkspace(root: HTMLElement, openFilePicker: () => void, canRestoreDocument: RestoreAdmission): { app: App; detachShortcuts: () => void } {
  // The desktop host keeps one bounded input adapter alive across both modes.
  const app = App.init(root, { inputHandlers: false, openFilePicker, canRestoreDocument });
  const detachShortcuts = mountDocumentShortcuts(root);
  return { app, detachShortcuts };
}
