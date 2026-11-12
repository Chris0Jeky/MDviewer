export type DataKind = "json" | "jsonl" | "yaml" | "toml" | "csv" | "text";

export interface ReadableOptions {
  fileName?: string;
  timeZone?: string;
  maxValues?: number;
  maxRecords?: number;
  /** Plain text: lines shown before the view is cut (default 20,000). */
  maxLines?: number;
}

export interface Problem { message: string; line: number; column: number }

export interface Readable {
  markdown: string;
  problems: Problem[];
  truncated: boolean;
  map: ReadonlyMap<number, string>;
}
