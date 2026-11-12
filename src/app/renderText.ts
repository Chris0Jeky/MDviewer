import { dataKindOf, prepare, toReadable, type DataKind, type Readable } from "../data";

/**
 * The one place where a document's text becomes its render text (READABLE_DATA.md, "The seam").
 * Markdown renders as written. A data document (JSON, JSON Lines, plain text) renders its
 * readable view; the document keeps its raw text, which Edit shows and Save writes. The reader,
 * the Edit preview and the PDF workspace all call this, so the three views cannot drift.
 */
export interface DataView {
  kind: DataKind;
  /** The format's name for the status line. */
  label: string;
  readable: Readable;
}
export interface RenderText {
  text: string;
  data: DataView | null;
}

/** Every format `src/data/` reads (D1, D4). */
const OPENABLE: ReadonlySet<DataKind> = new Set(["json", "jsonl", "text", "yaml", "toml", "csv"]);
const LABELS: Record<DataKind, string> = {
  json: "JSON", jsonl: "JSON Lines", yaml: "YAML", toml: "TOML", csv: "CSV", text: "Plain text",
};
/** The data kind a file opens as, or null for Markdown (and for formats not yet supported). */
export function dataDocumentKind(fileName: string): DataKind | null {
  const kind = dataKindOf(fileName);
  return kind && OPENABLE.has(kind) ? kind : null;
}

/**
 * Load what a document's kind needs before its view is derived (D4: the YAML parser loads on
 * demand). Every render path awaits this first, so a YAML file never reaches `toReadable`
 * unprepared; a failed load rejects into the caller's error state. Markdown resolves at once.
 */
const prepared = new Set<DataKind>();
export async function prepareRenderText(name: string): Promise<void> {
  const kind = dataDocumentKind(name);
  if (!kind || prepared.has(kind)) return;
  await prepare(kind);
  prepared.add(kind);
}

/** The status line's name for a data document's format, or null for Markdown. */
export function dataLabelOf(fileName: string): string | null {
  const kind = dataDocumentKind(fileName);
  return kind ? LABELS[kind] : null;
}

// Budgets the spec starts from; "Show more" doubles them, "Show all" lifts them.
const BUDGET = { maxValues: 20_000, maxRecords: 500, maxLines: 20_000 };

let last: { name: string; text: string; scale: number; result: RenderText } | null = null;
/** Budget scale per document name, in memory only: "Show more" doubles it, "Show all" lifts it. */
const scales = new Map<string, number>();
export function showMoreOf(name: string): void { scales.set(name, (scales.get(name) ?? 1) * 2); }
export function showAllOf(name: string): void { scales.set(name, Infinity); }

/**
 * The view's budgets follow the document's scale (so the reader and the PDF workspace show the
 * same cut). The last result is kept: the reader and the workspace ask for the same document.
 */
export function renderTextOf(name: string, text: string): RenderText {
  const scale = scales.get(name) ?? 1;
  if (last && last.name === name && last.text === text && last.scale === scale) return last.result;
  const kind = dataDocumentKind(name);
  const budget = (value: number): number => (scale === Infinity ? Number.MAX_SAFE_INTEGER : Math.round(value * scale));
  const result: RenderText = kind
    ? (() => {
      const readable = toReadable(text, kind, {
        fileName: name, maxValues: budget(BUDGET.maxValues), maxRecords: budget(BUDGET.maxRecords), maxLines: budget(BUDGET.maxLines),
      });
      return { text: readable.markdown, data: { kind, label: LABELS[kind], readable } };
    })()
    : { text, data: null };
  last = { name, text, scale, result };
  return result;
}
