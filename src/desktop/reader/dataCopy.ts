import { renderTextOf, type DataView } from "../../app/renderText";
import { copyValue, pathForms, subtreeJson, valueAt } from "../../data";
import { rangeOf } from "./sourcemap";

/**
 * Copy for data documents (READABLE_DATA.md, slice D5). The target is the value the reader's
 * selection sits on: its block's line (a table row is one line) maps through `Readable.map`, the
 * seam's own line-to-path table, to a path into the parsed data. The pure copy functions in
 * `src/data/copy.ts` do the rest. Nothing here parses or derives a second map.
 */
export type DataCopyKind = "value" | "jsonPath" | "jq" | "subtree";
export type DataCopy = { text: string; done: string } | { problem: string };

// The last selection inside the reader: opening the palette moves the selection into its input.
let anchor: Node | null = null;
export function trackDataTarget(root: HTMLElement): void {
  document.addEventListener("selectionchange", () => {
    const node = window.getSelection()?.anchorNode ?? null;
    if (node && root.contains(node)) anchor = node;
  });
}

/** The tracked selection, unless the reader has since replaced the DOM it sat in. */
const target = (root: Element): Node | null => (anchor && root.contains(anchor) ? anchor : null);

/** Plain text has no parsed values to point at; every other data kind does. */
export const hasValues = (view: DataView | null | undefined): view is DataView => !!view && view.kind !== "text";

/**
 * The value path of the readable-view block a node sits on: the first line of its stamped range
 * that the map knows. No node means the whole document. Undefined where the view shows no value.
 */
export function pathAt(view: DataView, node: Node | null): string | undefined {
  if (!node) return "$";
  const range = rangeOf(node instanceof Element ? node : node.parentElement);
  if (!range) return undefined;
  for (let line = range[0]; line <= range[1]; line++) {
    const path = view.readable.map.get(line);
    if (path?.startsWith("$")) return path;
  }
  return undefined;
}

const NONE = "There is no value to copy here. Select a value in the readable view first.";

export function dataCopy(kind: DataCopyKind, doc: { name: string; text: string }, root: Element): DataCopy {
  const view = renderTextOf(doc.name, doc.text).data;
  if (!hasValues(view)) return { problem: "Copying a value needs a JSON, JSON Lines, YAML, TOML or CSV document." };
  const path = pathAt(view, target(root));
  const value = path === undefined ? undefined : valueAt(doc.text, view.kind, path, doc.name);
  if (path === undefined || !value) return { problem: NONE };
  switch (kind) {
    case "value": return { text: copyValue(value), done: `Copied the value at ${path}.` };
    case "subtree": return { text: subtreeJson(value), done: `Copied ${path} as JSON.` };
    case "jsonPath": return { text: pathForms(path, view.kind).jsonPath, done: `Copied the JSONPath ${path}.` };
    case "jq": {
      const forms = pathForms(path, view.kind);
      return { text: forms.jq, done: `Copied the jq path ${forms.jq}.${forms.jqSlurp ? " It indexes the slurped records (jq -s)." : ""}` };
    }
  }
}

/** What follows a document's path in a copied reference: `#$.a[0]`, or "" when it names no value; null for Markdown. */
export function dataReference(doc: { name: string; text: string }, root: Element): string | null {
  const view = renderTextOf(doc.name, doc.text).data;
  if (!view) return null;
  const path = hasValues(view) ? pathAt(view, target(root)) : undefined;
  return path === undefined || path === "$" ? "" : `#${path}`;
}

/** The readable view as a Markdown copy: exactly the render text, under a `.md` name of its own. */
export function readableCopy(doc: { name: string; text: string }): { name: string; text: string } | null {
  const view = renderTextOf(doc.name, doc.text);
  if (!view.data) return null;
  const base = doc.name.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
  return { name: `${base || "Untitled"}.readable.md`, text: view.text };
}
