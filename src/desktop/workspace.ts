// This entire module is imported only after an explicit New or Edit & PDF action.
import "../styles/app.css";
import "../styles/editor.css";
import "../styles/preview.css";
import "../styles/workspace.css";
import "../styles/print.css";
import { App } from "../app/App";
import type { RestoreAdmission } from "../ui/DocumentRecovery";
import { mountDocumentShortcuts } from "../ui/DocumentShortcuts";

export interface OwnedSaveCommands { save: () => void; saveAs: () => void }

export function startWorkspace(root: HTMLElement, openFilePicker: () => void, canRestoreDocument: RestoreAdmission,
  createDocument: () => void, ownedSave?: OwnedSaveCommands): { app: App; detachShortcuts: () => void } {
  // The desktop host keeps one bounded input adapter alive across both modes.
  const app = App.init(root, {
    inputHandlers: false, openFilePicker, canRestoreDocument, createDocument,
    layoutInitiallyOpen: false,
  });
  if (ownedSave) addOwnedSaveButtons(root, ownedSave);
  const detachShortcuts = mountDocumentShortcuts(root);
  return { app, detachShortcuts };
}

/**
 * Native Save and Save As sit beside the shared "Save Markdown" button, which
 * stays the explicit copy. They route by data-desktop-command, never by the
 * shared data-document-command identities.
 */
function addOwnedSaveButtons(root: HTMLElement, commands: OwnedSaveCommands): void {
  const copy = root.querySelector<HTMLButtonElement>('.workspace-session > button[data-document-command="save"]');
  if (!copy) throw new Error("MDviewer: the workspace Save Markdown control failed to mount.");
  copy.title = "Save a copy of the current source. The open document keeps its file.";
  const make = (label: string, command: string, hint: string, run: () => void): HTMLButtonElement => {
    const button = root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = copy.className;
    button.textContent = label;
    button.dataset.desktopCommand = command;
    button.title = hint;
    button.setAttribute("aria-keyshortcuts", command === "save" ? "Control+S" : "Control+Shift+S");
    button.addEventListener("click", run);
    return button;
  };
  copy.before(
    make("Save", "save", "Save to this document's file (Ctrl+S)", commands.save),
    make("Save As", "save-as", "Save to a new file and keep editing it there (Ctrl+Shift+S)", commands.saveAs),
  );
}
