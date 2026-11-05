/** Pure UTF-16 source transformations. No parser, DOM, persistence, or rendering. */
export type MarkdownCommand =
  | "bold" | "italic" | "inline-code" | "code-block" | "link"
  | "heading-1" | "heading-2" | "heading-3"
  | "unordered-list" | "ordered-list" | "task-list";

export interface MarkdownSelection {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

export interface MarkdownEdit {
  start: number;
  end: number;
  text: string;
  selection: MarkdownSelection;
}

function edit(start: number, end: number, text: string, from: number, to: number,
  direction: MarkdownSelection["direction"]): MarkdownEdit {
  return { start, end, text, selection: { start: start + from, end: start + to, direction } };
}

function splitsSurrogate(source: string, offset: number): boolean {
  const before = source.charCodeAt(offset - 1);
  const after = source.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function markerRun(source: string, offset: number, step: -1 | 1, marker: string): number {
  let count = 0;
  while (source[offset] === marker) { count++; offset += step; }
  return count;
}

function escaped(source: string, offset: number): boolean {
  let slashes = 0;
  while (source[--offset] === "\\") slashes++;
  return slashes % 2 === 1;
}

function acceptsEmphasis(count: number, width: number): boolean {
  return count <= 3 && (width === 1 ? count % 2 === 1 : count >= 2);
}

function boundaryCharacter(source: string, offset: number): string {
  const point = source.codePointAt(offset) ?? 32;
  // Match the renderer's replacement of an unpaired surrogate at a boundary.
  return String.fromCodePoint(point >= 0xd800 && point <= 0xdfff ? 0xfffd : point);
}

/** CommonMark delimiter flanking, using complete code points and Markdown whitespace. */
function delimiterFlanking(source: string, start: number, end: number, symbol: string): { open: boolean; close: boolean } {
  const before = boundaryCharacter(source, start - (splitsSurrogate(source, start - 1) ? 2 : 1));
  const after = boundaryCharacter(source, end);
  const beforeSpace = /[\p{Zs}\t-\r]/u.test(before);
  const afterSpace = /[\p{Zs}\t-\r]/u.test(after);
  const beforePunctuation = /[\p{P}\p{S}]/u.test(before);
  const afterPunctuation = /[\p{P}\p{S}]/u.test(after);
  const left = !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation);
  const right = !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation);
  return {
    open: left && (symbol !== "_" || !right || beforePunctuation),
    close: right && (symbol !== "_" || !left || afterPunctuation),
  };
}

function activeClosingRun(source: string, end: number, symbol: string): number {
  const count = markerRun(source, end - 1, -1, symbol);
  return count && escaped(source, end - count) ? count - 1 : count;
}

/** Any possible closer makes an exterior-only toggle unsafe without a full parser. */
function hasEmphasisCloser(source: string, start: number, end: number, width: number, symbol?: string): boolean {
  const nested = !symbol && singleEmphasis(source, start, end, width === 1 ? 2 : 1);
  for (const match of source.slice(start, end).matchAll(/\*+|_+/g)) {
    if (symbol && match[0][0] !== symbol) continue;
    const from = start + match.index;
    const escapedFirst = escaped(source, from);
    const count = match[0].length - (escapedFirst ? 1 : 0);
    if (!count) continue;
    // Escaping only the first marker changes the remainder's flanking; even an
    // opposite-width remainder can consume part of a newly added outer closer.
    if (escapedFirst || count > 3 || acceptsEmphasis(count, width)) return true;
    if (nested && (from === start || from + count === end)) continue;
    const flanking = delimiterFlanking(source, from, from + count, match[0][0]!);
    // A one-sided opposite-width run can also consume an outer delimiter;
    // only both-flanking literals or the recognized nested boundaries are safe.
    if (flanking.open !== flanking.close) return true;
  }
  return false;
}

/** Recognize one simple span, including the shared *** run for nested bold/italic. */
function singleEmphasis(source: string, start: number, end: number, width: number): boolean {
  const symbol = source[start];
  if ((symbol !== "*" && symbol !== "_") || source[end - 1] !== symbol) return false;
  const opening = markerRun(source, start, 1, symbol);
  const closing = markerRun(source, end - 1, -1, symbol);
  const extraBefore = markerRun(source, start - 1, -1, symbol);
  const extraAfter = markerRun(source, end, 1, symbol);
  if (opening !== closing || extraBefore !== extraAfter || opening + extraBefore > 3 ||
    !acceptsEmphasis(opening, width) || !acceptsEmphasis(opening + extraBefore, width) ||
    start + opening >= end - closing ||
    escaped(source, start - extraBefore) || escaped(source, end - closing) ||
    !delimiterFlanking(source, start - extraBefore, start + opening, symbol).open ||
    !delimiterFlanking(source, end - closing, end + extraAfter, symbol).close) return false;
  const content = source.slice(start + opening, end - closing);
  return content.trim() === content &&
    !hasEmphasisCloser(source, start + opening, end - closing, width, symbol);
}

function canWrapEmphasis(source: string, start: number, end: number, width: number): boolean {
  // An active marker at either selected edge must be one complete opposite style.
  // Otherwise new markers can leave literal edge characters outside the style.
  for (const symbol of ["*", "_"]) {
    if ((markerRun(source, start, 1, symbol) || activeClosingRun(source, end, symbol)) &&
      !singleEmphasis(source, start, end, width === 1 ? 2 : 1)) return false;
  }
  const before = markerRun(source, start - 1, -1, "*");
  const after = markerRun(source, end, 1, "*");
  const opening = markerRun(source, start, 1, "*");
  const closing = activeClosingRun(source, end, "*");
  // Include adjacent runs when the new * markers merge with existing markup.
  const total = before + width + opening;
  return total <= 3 && total === after + width + closing && start + opening < end - closing &&
    delimiterFlanking(source, start - before, start + opening, "*").open &&
    delimiterFlanking(source, end - closing, end + after, "*").close;
}

function emphasis(source: string, selection: MarkdownSelection, marker: string): MarkdownEdit | null {
  const { start, end, direction } = selection;
  const body = source.slice(start, end);
  const width = marker.length;
  if (body.includes("\n")) {
    let offset = start;
    const parts = body.split("\n").map((line) => {
      const part = /^(\s*)(.*?)(\s*)$/.exec(line);
      const from = offset + (part?.[1]?.length ?? 0);
      const to = from + (part?.[2]?.length ?? 0);
      offset += line.length + 1;
      return { part, from, to, wrapped: singleEmphasis(source, from, to, width) };
    });
    if (parts.some(({ part, from, to, wrapped }) => part?.[2] && !wrapped &&
      (escaped(source, from) || escaped(source, to) || hasEmphasisCloser(source, from, to, width) ||
        !canWrapEmphasis(source, from, to, width)))) return null;
    const active = parts.filter(({ part }) => !!part?.[2]);
    const remove = active.length > 0 && active.every(({ wrapped }) => wrapped);
    const text = parts.map(({ part, wrapped }) => {
      if (!part?.[2]) return part?.[0] ?? "";
      const content = remove ? part[2].slice(width, -width) : wrapped ? part[2] : `${marker}${part[2]}${marker}`;
      return `${part[1]}${content}${part[3]}`;
    }).join("\n");
    return edit(start, end, text, 0, text.length, direction);
  }
  // Selecting the contents or the complete markup both toggle the same command.
  for (const symbol of ["*", "_"]) {
    const before = markerRun(source, start - 1, -1, symbol);
    const after = markerRun(source, end, 1, symbol);
    if (!before && !after) continue;
    if (before >= width && after >= width && singleEmphasis(source, start - width, end + width, width)) {
      return edit(start - width, end + width, body, 0, body.length, direction);
    }
    // Adding italic inside a single bold span (or vice versa) remains useful.
    // Escaped, unmatched, and multiple-span boundaries are left untouched.
    if (!singleEmphasis(source, start - before, end + after, width === 1 ? 2 : 1)) return null;
  }
  if (singleEmphasis(source, start, end, width)) {
    const unwrapped = body.slice(width, -width);
    return edit(start, end, unwrapped, 0, unwrapped.length, direction);
  }
  if (!body && escaped(source, start)) return null;
  if (!body) return edit(start, end, `${marker}text${marker}`, width, width + 4, "forward");
  const parts = /^(\s*)(.*?)(\s*)$/.exec(body);
  if (!parts?.[2]) return edit(start, end, body, 0, body.length, direction);
  const leading = parts[1] ?? "";
  const trailing = parts[3] ?? "";
  const from = start + leading.length;
  const to = end - trailing.length;
  const remove = singleEmphasis(source, from, to, width);
  // A trailing odd backslash would escape the new closer, including before whitespace.
  if (!remove && (escaped(source, from) || escaped(source, to) || hasEmphasisCloser(source, from, to, width) ||
    !canWrapEmphasis(source, from, to, width))) return null;
  const content = remove ? parts[2].slice(width, -width) : parts[2];
  const prefix = leading + (remove ? "" : marker);
  const text = `${prefix}${content}${remove ? "" : marker}${trailing}`;
  return edit(start, end, text, prefix.length, prefix.length + content.length, direction);
}

function singleCodeSpan(source: string, start: number, end: number): { start: number; end: number } | null {
  if (source[start] !== "`" || source[end - 1] !== "`" || source[start - 1] === "`" ||
    source[end] === "`" || escaped(source, start)) return null;
  const width = markerRun(source, start, 1, "`");
  if (width !== markerRun(source, end - 1, -1, "`") || start + width >= end - width) return null;
  let from = start + width;
  let to = end - width;
  const content = source.slice(from, to);
  // Backslashes do not escape a closing backtick run inside a code span.
  for (const match of content.matchAll(/`+/g)) if (match[0].length === width) return null;
  if (content.startsWith(" ") && content.endsWith(" ") && content.trim()) { from++; to--; }
  return { start: from, end: to };
}

function inlineCode(source: string, selection: MarkdownSelection): MarkdownEdit | null {
  const { start, end, direction } = selection;
  const body = source.slice(start, end);
  if (body.includes("\n")) return null;
  const before = markerRun(source, start - 1, -1, "`");
  const after = markerRun(source, end, 1, "`");
  if (before || after) {
    if (before > 0 && before === after && singleCodeSpan(source, start - before, end + after)) {
      return edit(start - before, end + after, body, 0, body.length, direction);
    }
    return null;
  }
  const paddedBefore = markerRun(source, start - 2, -1, "`");
  const paddedAfter = markerRun(source, end + 1, 1, "`");
  if (source[start - 1] === " " && source[end] === " " && paddedBefore > 0 && paddedBefore === paddedAfter) {
    const span = singleCodeSpan(source, start - paddedBefore - 1, end + paddedAfter + 1);
    if (span?.start === start && span.end === end) {
      return edit(start - paddedBefore - 1, end + paddedAfter + 1, body, 0, body.length, direction);
    }
    return null;
  }
  const full = singleCodeSpan(source, start, end);
  if (full) {
    const content = source.slice(full.start, full.end);
    return edit(start, end, content, 0, content.length, direction);
  }
  if (escaped(source, start)) return null;
  const content = body || "code";
  const longest = longestBackticks(content);
  const marker = "`".repeat(longest + 1);
  const pad = content.startsWith("`") || content.endsWith("`") ||
    (content.startsWith(" ") && content.endsWith(" ") && !!content.trim()) ? " " : "";
  const prefix = marker + pad;
  return edit(start, end, `${prefix}${content}${pad}${marker}`, prefix.length,
    prefix.length + content.length, body ? direction : "forward");
}

function lineRange(source: string, selection: MarkdownSelection): { start: number; end: number } {
  const start = selection.start === 0 ? 0 : source.lastIndexOf("\n", selection.start - 1) + 1;
  const last = selection.end > selection.start && source[selection.end - 1] === "\n"
    ? selection.end - 1 : selection.end;
  const nextBreak = source.indexOf("\n", last);
  return { start, end: nextBreak < 0 ? source.length : nextBreak };
}

function longestBackticks(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

function codeBlock(source: string, selection: MarkdownSelection): MarkdownEdit {
  let { start, end } = lineRange(source, selection);
  let body = source.slice(start, end);
  const unwrap = (text: string): string | undefined => {
    const lines = text.split("\n");
    const opening = /^(`{3,}|~{3,})[^\r\n]*\r?$/.exec(lines[0] ?? "");
    const closing = /^(`{3,}|~{3,})[ \t]*\r?$/.exec(lines.at(-1) ?? "");
    if (lines.length < 2 || !opening?.[1] || !closing?.[1] ||
      opening[1][0] !== closing[1][0] || closing[1].length < opening[1].length) return undefined;
    // A selection spanning multiple complete blocks is not one surrounding block.
    for (const line of lines.slice(1, -1)) {
      const middle = /^(`{3,}|~{3,})[ \t]*\r?$/.exec(line)?.[1];
      if (middle && middle[0] === opening[1][0] && middle.length >= opening[1].length) return undefined;
    }
    return lines.slice(1, -1).join("\n");
  };
  let unwrapped = unwrap(body);
  // A just-inserted block selects its body, so the next activation removes its fences.
  if (unwrapped === undefined && start > 0 && end < source.length) {
    const outerStart = start < 2 ? 0 : source.lastIndexOf("\n", start - 2) + 1;
    const nextBreak = source.indexOf("\n", end + 1);
    const outerEnd = nextBreak < 0 ? source.length : nextBreak;
    unwrapped = unwrap(source.slice(outerStart, outerEnd));
    if (unwrapped !== undefined) { start = outerStart; end = outerEnd; }
  }
  if (unwrapped !== undefined) return edit(start, end, unwrapped, 0, unwrapped.length, selection.direction);
  body = source.slice(start, end);
  const longest = Math.max(2, longestBackticks(body));
  const fence = "`".repeat(longest + 1);
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const prefix = fence + newline;
  return edit(start, end, `${prefix}${body}${newline}${fence}`, prefix.length,
    prefix.length + body.length, selection.direction);
}

/** A non-nested label and an unquoted destination; balance parentheses before deleting anything. */
function singleLink(source: string, start: number): { labelStart: number; labelEnd: number; end: number } | null {
  if (source[start] !== "[" || escaped(source, start) ||
    (source[start - 1] === "!" && !escaped(source, start - 1))) return null;
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\n" || character === "\r" || character === "[") return null;
    if (character === "\\") {
      if (!source[index + 1] || /[\r\n]/.test(source[index + 1]!)) return null;
      index += 2;
      continue;
    }
    if (character === "]") break;
    index++;
  }
  const labelEnd = index;
  if (source[index] !== "]" || source[index + 1] !== "(") return null;
  index += 2;
  let depth = 1;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (/[\s<>]/.test(character)) return null;
    if (character === "\\") {
      if (!source[index + 1] || /\s/.test(source[index + 1]!)) return null;
      index += 2;
      continue;
    }
    if (character === "(") depth++;
    if (character === ")" && --depth === 0) return { labelStart: start + 1, labelEnd, end: index + 1 };
    index++;
  }
  return null;
}

function link(source: string, selection: MarkdownSelection): MarkdownEdit | null {
  const { start, end, direction } = selection;
  const body = source.slice(start, end);
  if (body.includes("\n")) return null;
  const complete = singleLink(source, start);
  if (complete?.end === end) {
    const label = source.slice(complete.labelStart, complete.labelEnd);
    return edit(start, end, label, 0, label.length, direction);
  }
  const surrounding = singleLink(source, start - 1);
  if (surrounding?.labelStart === start && surrounding.labelEnd === end) {
    return edit(start - 1, surrounding.end, body, 0, body.length, direction);
  }
  if (body.includes("[") || body.includes("]") || source[start - 1] === "[" || source[end] === "]" ||
    escaped(source, start) || escaped(source, end) ||
    (source[start - 1] === "!" && !escaped(source, start - 1))) return null;
  const label = body || "text";
  const text = `[${label}](url)`;
  return body ? edit(start, end, text, label.length + 3, label.length + 6, "forward")
    : edit(start, end, text, 1, 5, "forward");
}

function lines(source: string, selection: MarkdownSelection, command: MarkdownCommand): MarkdownEdit {
  const { start, end } = lineRange(source, selection);
  const original = source.slice(start, end).split("\n");
  const heading = command.startsWith("heading-") ? "#".repeat(Number(command.at(-1))) + " " : null;
  const parsed = original.map((line) => {
    const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
    const body = line.slice(indent.length);
    const prefix = heading ? /^(#{1,6})[ \t]+/.exec(body)?.[0] ?? ""
      : /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.exec(body)?.[0] ?? "";
    const content = body.slice(prefix.length);
    const matches = heading ? prefix.trim() === heading.trim()
      : command === "task-list" ? /\[[ xX]\]/.test(prefix)
        : command === "ordered-list" ? /^\d+[.)]/.test(prefix) && !/\[[ xX]\]/.test(prefix)
          : /^[-+*]/.test(prefix) && !/\[[ xX]\]/.test(prefix);
    return { indent, prefix, content, matches, blank: !body.trim() };
  });
  const active = parsed.filter((line) => !line.blank);
  const remove = active.length > 0 && active.every((line) => line.matches);
  let number = 0;
  let caret = selection.start - start;
  const text = parsed.map((line, index) => {
    if (line.blank && parsed.length > 1) return original[index] ?? "";
    number++;
    const prefix = remove ? "" : heading ?? (command === "ordered-list" ? `${number}. `
      : command === "task-list" ? `- [${/\[[xX]\]/.test(line.prefix) ? "x" : " "}] ` : "- ");
    if (selection.start === selection.end) {
      caret = line.indent.length + prefix.length + Math.max(0, caret - line.indent.length - line.prefix.length);
    }
    return line.indent + prefix + line.content;
  }).join("\n");
  const collapsed = selection.start === selection.end;
  return edit(start, end, text, collapsed ? Math.min(caret, text.length) : 0,
    collapsed ? Math.min(caret, text.length) : text.length, selection.direction);
}

/** Refuse invalid offsets, unsupported multiline commands, and ambiguous inline toggle boundaries. */
export function markdownCommand(source: string, selection: MarkdownSelection, command: MarkdownCommand): MarkdownEdit | null {
  const { start, end } = selection;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start ||
    end > source.length || splitsSurrogate(source, start) || splitsSurrogate(source, end)) return null;
  switch (command) {
    case "bold": return emphasis(source, selection, "**");
    case "italic": return emphasis(source, selection, "*");
    case "inline-code": return inlineCode(source, selection);
    case "code-block": return codeBlock(source, selection);
    case "link": return link(source, selection);
    default: return lines(source, selection, command);
  }
}
