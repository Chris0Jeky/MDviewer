/** UTF-16 offsets match the native textarea selection API. */
export interface SourceMatch { start: number; end: number }
export interface SearchResults { matches: SourceMatch[]; limited: boolean }
export const MAX_SEARCH_MATCHES = 10_000;
export const MAX_SEARCH_QUERY_CHARS = 2_000;

/** Count the future UTF-8 source without allocating the multiplied result. */
export function replacementByteLength(text: string, matches: readonly SourceMatch[], replacement: string): number {
  const encoder = new TextEncoder();
  const replacementBytes = encoder.encode(replacement).length;
  let bytes = 0;
  let last = -1;
  const append = (part: string, length = encoder.encode(part).length): void => {
    if (!part) return;
    bytes += length;
    const first = part.charCodeAt(0);
    // Two separately unpaired surrogates encode as 3+3 bytes. Joined, they are
    // one 4-byte code point, including across an empty replacement/deletion.
    if (last >= 0xd800 && last <= 0xdbff && first >= 0xdc00 && first <= 0xdfff) bytes -= 2;
    last = part.charCodeAt(part.length - 1);
  };
  let offset = 0;
  for (const match of matches) {
    append(text.slice(offset, match.start));
    append(replacement, replacementBytes);
    offset = match.end;
  }
  append(text.slice(offset));
  return bytes;
}

/**
 * Literal Unicode matching keeps offsets in the original string. Lowercasing a
 * copy would change offsets for characters such as İ. Escaping the query also
 * avoids user-supplied regular expressions and their unbounded backtracking.
 */
export function findMatches(text: string, query: string, matchCase = false): SearchResults {
  const matches: SourceMatch[] = [];
  if (!query) return { matches, limited: false };
  if (query.length > MAX_SEARCH_QUERY_CHARS) throw new RangeError("Search text is too long (maximum 2,000 characters).");
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(literal, matchCase ? "gu" : "giu");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (matches.length === MAX_SEARCH_MATCHES) return { matches, limited: true };
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return { matches, limited: false };
}

/** Select relative to the current native selection, wrapping at either end. */
export function nextMatch(matches: readonly SourceMatch[], selection: SourceMatch, direction: 1 | -1): number {
  if (!matches.length) return -1;
  const current = matches.findIndex((m) => m.start === selection.start && m.end === selection.end);
  if (current !== -1) return (current + direction + matches.length) % matches.length;
  if (direction === 1) {
    const next = matches.findIndex((m) => m.start >= selection.end);
    return next === -1 ? 0 : next;
  }
  for (let index = matches.length - 1; index >= 0; index--) {
    if (matches[index]!.end <= selection.start) return index;
  }
  return matches.length - 1;
}

/** Results are ordered, non-overlapping ranges from findMatches. */
export function replaceMatches(text: string, matches: readonly SourceMatch[], replacement: string): string {
  if (!matches.length) return text;
  const parts: string[] = [];
  let offset = 0;
  for (const match of matches) {
    parts.push(text.slice(offset, match.start), replacement);
    offset = match.end;
  }
  parts.push(text.slice(offset));
  return parts.join("");
}
