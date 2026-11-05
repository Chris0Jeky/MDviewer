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

function emphasis(source: string, selection: MarkdownSelection, marker: string): MarkdownEdit {
  const { start, end, direction } = selection;
  const body = source.slice(start, end);
  const width = marker.length;
  const accepts = (count: number) => width === 1 ? count % 2 === 1 : count >= 2;
  const wrapped = (value: string) => value.length >= width * 2 && ["*", "_"].some((symbol) =>
    accepts(markerRun(value, 0, 1, symbol)) && accepts(markerRun(value, value.length - 1, -1, symbol)));
  if (body.includes("\n")) {
    const parts = body.split("\n").map((line) => /^(\s*)(.*?)(\s*)$/.exec(line));
    const active = parts.filter((part) => !!part?.[2]);
    const remove = active.length > 0 && active.every((part) => wrapped(part?.[2] ?? ""));
    const text = parts.map((part) => {
      if (!part?.[2]) return part?.[0] ?? "";
      const content = remove ? part[2].slice(width, -width) : wrapped(part[2]) ? part[2] : `${marker}${part[2]}${marker}`;
      return `${part[1]}${content}${part[3]}`;
    }).join("\n");
    return edit(start, end, text, 0, text.length, direction);
  }
  // Selecting the contents or the complete markup both toggle the same command.
  for (const symbol of ["*", "_"]) {
    if (accepts(markerRun(source, start - 1, -1, symbol)) && accepts(markerRun(source, end, 1, symbol))) {
      return edit(start - width, end + width, body, 0, body.length, direction);
    }
  }
  if (wrapped(body)) {
    const unwrapped = body.slice(width, -width);
    return edit(start, end, unwrapped, 0, unwrapped.length, direction);
  }
  if (!body) return edit(start, end, `${marker}text${marker}`, width, width + 4, "forward");
  const parts = /^(\s*)(.*?)(\s*)$/.exec(body);
  if (!parts?.[2]) return edit(start, end, body, 0, body.length, direction);
  const leading = parts[1] ?? "";
  const trailing = parts[3] ?? "";
  const remove = wrapped(parts[2]);
  const content = remove ? parts[2].slice(width, -width) : parts[2];
  const prefix = leading + (remove ? "" : marker);
  const text = `${prefix}${content}${remove ? "" : marker}${trailing}`;
  return edit(start, end, text, prefix.length, prefix.length + content.length, direction);
}

function inlineCode(source: string, selection: MarkdownSelection): MarkdownEdit | null {
  const { start, end, direction } = selection;
  const body = source.slice(start, end);
  if (body.includes("\n")) return null;
  const before = markerRun(source, start - 1, -1, "`");
  const after = markerRun(source, end, 1, "`");
  if (before > 0 && before === after) return edit(start - before, end + after, body, 0, body.length, direction);
  const paddedBefore = markerRun(source, start - 2, -1, "`");
  const paddedAfter = markerRun(source, end + 1, 1, "`");
  if (source[start - 1] === " " && source[end] === " " && paddedBefore > 0 && paddedBefore === paddedAfter) {
    return edit(start - paddedBefore - 1, end + paddedAfter + 1, body, 0, body.length, direction);
  }
  const full = /^(`+)([\s\S]*?)\1$/.exec(body);
  if (full?.[1] && full[2] !== undefined && !full[2].startsWith("`") && !full[2].endsWith("`")) {
    let content = full[2];
    if (content.startsWith(" ") && content.endsWith(" ") && content.trim()) content = content.slice(1, -1);
    return edit(start, end, content, 0, content.length, direction);
  }
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

function link(source: string, selection: MarkdownSelection): MarkdownEdit | null {
  const { start, end, direction } = selection;
  const body = source.slice(start, end);
  if (body.includes("\n")) return null;
  const complete = /^\[([^\]\n]*)\]\([^)\n]*\)$/.exec(body);
  if (complete?.[1] !== undefined) return edit(start, end, complete[1], 0, complete[1].length, direction);
  const tail = /^\]\([^)\n]*\)/.exec(source.slice(end));
  if (source[start - 1] === "[" && source[start - 2] !== "!" && tail) {
    return edit(start - 1, end + tail[0].length, body, 0, body.length, direction);
  }
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

/** Invalid offsets (including a split surrogate pair) and multiline inline code/links are refused. */
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
