/** Download exactly the current in-memory source; never write document bytes to storage. */
export function markdownFilename(name: string): string {
  const base = Array.from(name.split(/[\\/]/).pop() ?? "").filter((char) => char.charCodeAt(0) >= 32).join("").replace(/[<>:"|?*]/g, "_").trim();
  return /\.(md|markdown)$/i.test(base) ? base : `${base || "Untitled"}.md`;
}

export function downloadMarkdown(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
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
