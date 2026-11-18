import { cellText } from "./escape";
import type { Lens } from "./lens";
import type { Readable } from "./types";

/**
 * An HTML file as a readable document (READABLE_DATA.md, D7). The body is shown as HTML through the
 * reader's own pipeline, so the one sanitizer (src/render/sanitize.ts) decides what survives: no
 * scripts, styles, frames, forms or remote resources; relative images load as local ones do for
 * Markdown. This function only frames it: a title, an overview line that names what will not run,
 * and the body as one Markdown HTML block. Edit shows the raw text, which Save writes unchanged.
 *
 * The file is read with DOMParser: one linear parse (no regular expression scans, so a hostile file
 * cannot make this quadratic), into an inert document where nothing runs or loads.
 */

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/** Counted, then removed here; the sanitizer would remove them anyway. */
const DROPPED = "script, style, template, noscript";
const REMOTE = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i;

export function htmlView(text: string, size: string, lens: Lens): Readable {
  const page = new DOMParser().parseFromString(text, "text/html");
  const count = (selector: string, root: ParentNode = page): number => root.querySelectorAll(selector).length;
  const scripts = count("script");
  const styles = count("style") + count('link[rel~="stylesheet" i]');
  const frames = count("iframe, frame, object, embed", page.body);
  const forms = count("form", page.body);
  const remote = [...page.body.querySelectorAll("img[src], video[src], audio[src], source[src]")]
    .filter(node => REMOTE.test(node.getAttribute("src") ?? "")).length;
  const links = count("a[href]", page.body);
  const images = count("img", page.body);
  const title = page.title.replace(/\s+/g, " ").trim();

  const facts = [`HTML · ${size}`];
  if (title) facts.push(`title “${cellText(title)}”`);
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
  for (const node of page.body.querySelectorAll(DROPPED)) node.remove();
  // One Markdown HTML block: it ends at the first blank line, so blank lines become empty comments
  // (invisible, also inside <pre>). The serialized body has every comment and element closed.
  const content = page.body.innerHTML.split(/\r\n|\r|\n/).map(line => (line.trim() ? line : "<!---->"));
  lens.line(["<div class=\"readable-html\">", ...content, "</div>"].join("\n"));
  return { markdown: lens.finish(), problems: [], truncated: false, map: lens.map };
}
