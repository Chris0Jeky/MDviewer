import {
  MARK_LABELS, applyPatches, inversePatches, parseActionable, planChange, relocate, spanValue,
  type Control, type ControlAction, type LinePatch,
} from "../../render/actionable";
import type { PatchResult } from "../native";
import type { ReaderDocument } from "../session";

/**
 * Actionable Markdown write-back in the reader (A3; contract "Write-back"). A bound document
 * with no unsaved edits saves at once through the host's line-patch command and offers Undo;
 * anything else changes the open text and is saved with the document (always so in the web
 * build). After an outside change a gesture is re-derived once from the file's current text.
 */
export interface Notice {
  text: string;
  action?: { label: string; run(): void };
}

export interface WritebackDeps {
  active(): ReaderDocument | undefined;
  native: { available: boolean; patchDocument(token: string, patches: LinePatch[]): Promise<PatchResult> };
  /** The host saved: adopt its text and binding generation (a later Save would be stale otherwise). */
  adopt(doc: ReaderDocument, text: string, generation: number): boolean;
  /** Apply in memory: the document becomes dirty and is saved with the document. */
  setText(doc: ReaderDocument, text: string): void;
  rerender(): void;
  notice(notice: Notice | null): void;
  report(message: string): void;
}

function describe(control: Control, action: ControlAction): string {
  if (action.kind === "mark") return `Marked ${MARK_LABELS[action.to].toLowerCase()}`;
  if (action.kind === "choice") return control.kind === "choice" && control.state === "x" ? "Cleared the choice" : "Selected";
  if (action.kind === "field") return `Saved ${control.kind === "field" ? control.key : "the field"}`;
  return `Set ${control.kind === "chip" ? control.key : "the value"} to ${action.value}`;
}

function label(control: Control, line: string): string {
  if (control.kind === "field" || control.kind === "chip") return control.key;
  return line.slice(control.span[1] + 1).replace(/<!--.*?-->/g, "").trim().slice(0, 60) || "this item";
}

interface LastSave {
  docId: string;
  /** The binding the change was saved through: the same id can name another file later. */
  token: string;
  name: string;
  control: Control;
  line: string;
  before: string;
  after: string;
  action: ControlAction;
  undo: LinePatch[];
}

export function createWriteback(deps: WritebackDeps): {
  change(control: Control, action: ControlAction): Promise<void>;
  /** After an outside change was adopted: did another program put the span back? */
  checkOverwritten(doc: ReaderDocument): void;
  /** The Undo notice went away: an overwrite is no longer reported. */
  forget(): void;
  /** Resolves when no host write is in flight (Edit waits for it before showing the text). */
  settled(): Promise<void>;
} {
  let last: LastSave | null = null;
  let busy = false;
  let inFlight: Promise<void> = Promise.resolve();
  let release = (): void => {};
  function begin(): void { busy = true; inFlight = new Promise(resolve => { release = resolve; }); }
  function end(): void { busy = false; release(); }

  async function save(doc: ReaderDocument, patches: LinePatch[]): Promise<PatchResult | null> {
    try { return await deps.native.patchDocument(doc.binding!.token, patches); }
    catch (error) { deps.report(`Could not save the change: ${error instanceof Error ? error.message : String(error)}`); return null; }
  }

  /** Apply again and Undo act only on the file they came from, and never over unsaved edits. */
  function sameFile(doc: ReaderDocument | undefined, saved: LastSave): doc is ReaderDocument {
    return !!doc && doc.id === saved.docId && doc.binding?.token === saved.token;
  }

  async function change(control: Control, action: ControlAction, from?: LastSave): Promise<void> {
    const doc = deps.active();
    if (!doc || busy) return;
    if (from && (!sameFile(doc, from) || doc.dirty)) {
      deps.report(`Could not apply the change again: “${from.name}” is no longer the open, saved document. Nothing was written.`);
      return;
    }
    const lines = doc.text.split(/\r\n?|\n/);
    const line = lines[control.line - 1] ?? "";
    const name = label(control, line);
    let patches: LinePatch[];
    try { patches = planChange(doc.text, parseActionable(doc.text), control, action); }
    catch (error) { deps.report(error instanceof Error ? error.message : String(error)); return; }
    if (!patches.length) return;

    if (!deps.native.available || !doc.binding || doc.dirty) {
      deps.setText(doc, applyPatches(doc.text, patches));
      deps.rerender();
      return;
    }
    begin();
    try {
      let result = await save(doc, patches);
      if (result?.outcome === "unplaced") {
        // The file changed outside. Re-derive once from its current text: only the span the reader
        // saw may change, and only if it still holds the value the reader saw.
        const found = relocate(result.text, control, line);
        if (!found || spanValue(found.control) !== spanValue(control)) {
          deps.report(`Could not save “${name}”: it changed in another program. Nothing was written.`);
          return;
        }
        try { patches = planChange(result.text, found.document, found.control, action); }
        catch (error) { deps.report(error instanceof Error ? error.message : String(error)); return; }
        result = await save(doc, patches);
        if (result?.outcome === "unplaced") {
          deps.report(`Could not save “${name}”: it changed in another program. Nothing was written.`);
          return;
        }
      }
      if (!result) return;
      if (result.outcome === "failed") { deps.report(`Could not save “${name}” (${result.code}). Nothing was written.`); return; }
      if (deps.active()?.id === doc.id && deps.adopt(doc, result.text, result.generation)) deps.rerender();
      const patched = patches.find(patch => patch.line === control.line) ?? patches[0]!;
      last = { docId: doc.id, token: doc.binding!.token, name: doc.name, control, line: patched.replace, before: patched.expect, after: patched.replace, action, undo: inversePatches(patches) };
      const saved = last;
      deps.notice({ text: describe(control, action), action: { label: "Undo", run: () => { void undo(saved); } } });
    } finally { end(); }
  }

  async function undo(saved: LastSave): Promise<void> {
    const doc = deps.active();
    if (busy) return;
    if (!sameFile(doc, saved) || doc.dirty) {
      deps.report(`Could not undo: “${saved.name}” has unsaved edits or is no longer open. Nothing was written.`);
      return;
    }
    deps.notice(null);
    begin();
    try {
      const result = await save(doc, saved.undo);
      if (!result) return;
      if (result.outcome === "failed") { deps.report(`Could not undo (${result.code}). Nothing was written.`); return; }
      if (result.outcome !== "saved") { deps.report("Could not undo: the file changed in another program. Nothing was written."); return; }
      if (deps.adopt(doc, result.text, result.generation)) deps.rerender();
      if (last === saved) last = null;
    } finally { end(); }
  }

  function checkOverwritten(doc: ReaderDocument): void {
    const saved = last;
    // Only for the document on screen, so the notice and its action name the file the reader sees.
    if (!saved || !sameFile(doc, saved) || deps.active()?.id !== doc.id) return;
    const lines = doc.text.split(/\r\n?|\n/);
    if (lines.includes(saved.after)) return; // still there
    const found = relocate(doc.text, { ...saved.control, line: saved.control.line }, saved.before);
    if (!found || spanValue(found.control) !== spanValue(saved.control)) return;
    // Another program wrote the old value back while the Undo notice could still show.
    last = null;
    deps.notice({ text: "Another program overwrote this change.", action: { label: "Apply again", run: () => { void change(found.control, saved.action, saved); } } });
  }

  return { change, checkOverwritten, forget: () => { last = null; }, settled: () => inFlight };
}
