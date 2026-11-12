import { getDownloadDestination } from "./destination";
import { dataDocumentKind } from "../app/renderText";

/** Explicitly export exact source bytes; no automatic document persistence. */
export function markdownFilename(name: string): string {
  const base = Array.from(name.split(/[\\/]/).pop() ?? "").filter((char) => char.charCodeAt(0) >= 32).join("").replace(/[<>:"|?*]/g, "_").trim();
  // A data document saves its raw text under its own extension (READABLE_DATA.md, Boundaries).
  return /\.(md|markdown)$/i.test(base) || dataDocumentKind(base) ? base : `${base || "Untitled"}.md`;
}

export function downloadMarkdown(name: string, text: string): void | Promise<void> {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const destination = getDownloadDestination();
  if (destination) return destination(blob, markdownFilename(name));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = markdownFilename(name);
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    // Allow the browser to begin consuming the Blob before revoking it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
