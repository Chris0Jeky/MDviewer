/** Escape all ASCII punctuation, before plugins can interpret it as Markdown or HTML. */
export function escapeText(text: string): string {
  return Array.from(text, c => {
    if (c === "<") return "&lt;";
    if (c === "&") return "&amp;";
    if (/[!-/:-@[-`{-~]/.test(c)) return `\\${c}`;
    if (c === "\t") return "&#9;";
    return c;
  }).join("")
    // Spaces at a line's edge or in a run would be trimmed, collapsed or read as an indented
    // code block; keep them as entities. A single inner space stays a space, so the derived
    // Markdown stays readable when copied.
    .replace(/^ +| +$| {2,}/gm, run => "&#32;".repeat(run.length));
}

export function cellText(text: string): string {
  return escapeText(text).replace(/\r\n|\r|\n/g, "<br>");
}

export function fence(text: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), m => m[0].length));
  const marker = "`".repeat(longest + 1);
  return `${marker}\n${text}\n${marker}`;
}
