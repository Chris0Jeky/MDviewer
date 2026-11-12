/** The one-line status (S3): where the document lives, its size in words and tokens, and save state. */
export interface StatusInput {
  name: string;
  /** Display path of a bound document, else undefined (in memory). */
  path?: string;
  text: string;
  dirty: boolean;
  disk?: "synced" | "changed" | "missing";
}

export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
}

/** A rough model-token estimate: about four characters per token for English prose and code. */
export function tokenEstimate(text: string): string {
  const tokens = Math.round(text.length / 4);
  return tokens < 1000 ? `~${tokens}` : `~${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
}

export function saveState(input: StatusInput): string {
  if (input.disk === "missing") return "File moved or deleted";
  if (input.disk === "changed") return "Changed on disk";
  if (!input.path) return input.dirty ? "Not saved" : "In memory";
  return input.dirty ? "Unsaved changes" : "Saved";
}

export function statusParts(input: StatusInput): { where: string; size: string; state: string } {
  const words = wordCount(input.text);
  return {
    where: input.path ?? input.name,
    size: `${words.toLocaleString()} ${words === 1 ? "word" : "words"} · ${tokenEstimate(input.text)} tokens`,
    state: saveState(input),
  };
}
