import { cellText } from "./escape";
import type { Lens } from "./lens";
import type { Readable } from "./types";

/**
 * An HTML file as a readable document (READABLE_DATA.md, D7). The body is shown as HTML through the
 * reader's own pipeline, so the one sanitizer (src/render/sanitize.ts) decides what survives: no
 * scripts, styles, frames, forms or remote resources; relative images load as local ones do for
 * Markdown. This function only frames it: a title, an overview line that names what will not run,
 * and the body as one Markdown HTML block. Edit shows the raw text, which Save writes unchanged.
 */

const BLOCKS = /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

function decodeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim()
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}

export function htmlView(text: string, size: string, lens: Lens): Readable {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text)?.[1];
  const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(text)?.[1]
    ?? text.replace(/<!doctype[^>]*>/i, "").replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, "").replace(/<\/?html\b[^>]*>/gi, "");
  const scripts = count(text, /<script\b/gi);
  const styles = count(text, /<style\b/gi) + count(text, /<link\b[^>]*rel\s*=\s*["']?stylesheet/gi);
  const frames = count(body, /<(?:iframe|frame|object|embed)\b/gi);
  const forms = count(body, /<form\b/gi);
  const remote = count(body, /<(?:img|video|audio|source)\b[^>]*\ssrc\s*=\s*["']?(?:https?:)?\/\//gi);
  const links = count(body, /<a\b[^>]*\shref\s*=/gi);
  const images = count(body, /<img\b/gi);

  const facts = [`HTML · ${size}`];
  if (title && decodeTitle(title)) facts.push(`title “${cellText(decodeTitle(title))}”`);
  if (links) facts.push(plural(links, "link"));
  if (images) facts.push(plural(images, "image"));
  lens.line(facts.join(" · ")); lens.line();
  const blocked = [
    scripts && plural(scripts, "script"), styles && plural(styles, "style sheet"), frames && plural(frames, "embedded frame"),
    forms && plural(forms, "form"), remote && plural(remote, "remote image or media file"),
  ].filter(Boolean);
  if (blocked.length) {
    lens.line(`Shown without its ${blocked.join(", ")}: MDviewer never runs a page's code or loads anything from the network. Edit shows the source.`);
    lens.line();
  }
  // One Markdown HTML block: it ends at the first blank line, so blank lines become empty comments
  // (invisible, also inside <pre>). Scripts and styles are dropped here; the sanitizer would anyway.
  const content = body.replace(BLOCKS, "").split(/\r\n|\r|\n/).map(line => (line.trim() ? line : "<!---->"));
  lens.line(["<div class=\"readable-html\">", ...content, "</div>"].join("\n"));
  return { markdown: lens.finish(), problems: [], truncated: false, map: lens.map };
}
