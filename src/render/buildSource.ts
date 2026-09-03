/**
 * Build the pagination source fragment from rendered HTML.
 *
 * This is step 3 of the load-bearing render order: it takes the synchronous markdown-it
 * HTML and prepares it for Paged.js by (a) wrapping it in the `.doc` root that carries the
 * document typography tokens, (b) normalising / synthesizing the table-of-contents `nav.toc`
 * so Paged.js can fill in `target-counter` page numbers, and (c) converting markdown-it's
 * end-of-document footnote section into inline `float:footnote` spans so each note sits at
 * the bottom of the page where it is referenced.
 *
 * It must NOT trigger layout — Mermaid (step 4) and font/image settling (step 5) still run
 * before pagination. `awaitFontsAndImages` is the step-5 helper and lives here too.
 */

import type { Settings } from "../app/settings";
import { DOC_FONT_STACKS } from "../app/settings";
import { ATTRS, CLASSES } from "../app/dom";

/** Outermost blocks whose identity must survive Paged.js cloning/splitting. */
export const ATOMIC_BLOCK_SELECTOR = [
  "pre",
  ".shiki",
  "figure.code-figure",
  "figure.mermaid-figure",
  "figure",
  "img",
  "svg",
  "table",
  "tr",
  "td",
  "th",
  ".callout",
  ".callout-note",
  ".callout-tip",
  ".callout-warning",
  ".callout-danger",
  ".katex-display",
  "blockquote",
  "li",
].join(",");

/**
 * Give each source atomic block a stable identity before pagination. Paged.js
 * copies data attributes into page fragments, letting E2E detect one logical
 * short block incorrectly cloned across multiple pages.
 */
export function stampAtomicBlocks(root: ParentNode): number {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(ATOMIC_BLOCK_SELECTOR));
  let count = 0;
  for (const element of candidates) {
    let ancestor = element.parentElement;
    let nested = false;
    while (ancestor) {
      if (ancestor.matches(ATOMIC_BLOCK_SELECTOR)) {
        nested = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (nested) continue;
    element.dataset.mdvAtomicId = `atomic-${++count}`;
  }
  return count;
}

/**
 * Parse `html` into a `.doc` root inside a DocumentFragment and apply the TOC + footnote
 * transforms. The returned fragment is the pristine, layout-free source Paged.js paginates.
 */
export function buildPaginationSource(html: string, settings: Settings): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const doc = document.createElement("div");
  doc.className = CLASSES.doc;

  // Typography tokens consumed by document.css and the paged stylesheet. We set both the
  // canonical `data-doc-font` hook (which document.css keys on) and an inline
  // `--doc-font-family` custom property so the typography is correct regardless of which
  // cascade path wins (and so the fragment is self-describing for the export canvas path).
  doc.setAttribute("data-doc-font", settings.docFont);
  doc.style.setProperty("--doc-font-family", DOC_FONT_STACKS[settings.docFont]);
  doc.style.setProperty("--doc-font-size", `${settings.fontSizePt}pt`);
  doc.setAttribute(ATTRS.codeTheme, settings.codeTheme);

  doc.innerHTML = html;
  fragment.appendChild(doc);

  // Order matters: synthesize/normalise the TOC against the freshly-parsed heading ids
  // first, then relocate footnotes (which removes the end-of-doc section).
  injectToc(doc, settings);
  transformFootnotesToInline(doc);

  return fragment;
}

/**
 * Convert markdown-it-footnote's end-of-document `<section class="footnotes">` into inline
 * `<span class="footnote">` float spans placed right after each `[n]` call site. Paged.js's
 * `float: footnote` (from the paged stylesheet) then drops each span to the bottom of its
 * page. Best-effort: if the expected structure is missing we leave the document untouched so
 * a malformed render never loses content.
 */
export function transformFootnotesToInline(root: ParentNode): void {
  const section = root.querySelector(`section.${CLASSES.footnotes}`);
  if (!section) return;

  // markdown-it-footnote emits: <li id="fn1" class="footnote-item"><p>…<a class="footnote-backref">↩</a></p></li>
  const items = section.querySelectorAll("li.footnote-item, li[id^='fn']");
  if (items.length === 0) return;

  // Map footnote ref id -> its content HTML (backref link stripped — meaningless inline).
  const contentById = new Map<string, string>();
  items.forEach((li) => {
    const id = li.getAttribute("id");
    if (!id) return;
    const clone = li.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`a.${CLASSES.footnoteBackref}, a.footnote-backref`).forEach((a) => a.remove());
    // Prefer inner paragraph content; fall back to the li's own content.
    const inner = clone.querySelector("p");
    const content = (inner ?? clone).innerHTML.trim();
    contentById.set(id, content);
  });
  if (contentById.size === 0) return;

  // Each call site is <sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>.
  const refs = Array.from(root.querySelectorAll<HTMLElement>("sup.footnote-ref, a.footnote-ref"));
  // One float span per NOTE, not per call site. A footnote cited twice renders two call
  // markers ([1] and [1:1]) that both point at #fn1; giving each one its own
  // `float: footnote` span would make Paged.js treat them as two distinct notes — it
  // would print the same text twice at the page foot and advance its own marker counter,
  // so every later note's foot marker would disagree with the [n] the reader sees at the
  // call site. Floating only the first reference keeps Paged.js's numbering aligned with
  // markdown-it's; a repeat citation on a later page still reads as "see note n".
  const floated = new Set<string>();
  let moved = 0;
  for (const ref of refs) {
    const anchor = ref.matches("a") ? ref : ref.querySelector("a");
    const href = anchor?.getAttribute("href") ?? "";
    const targetId = href.startsWith("#") ? href.slice(1) : "";
    const content = contentById.get(targetId);
    if (!content) continue;
    if (floated.has(targetId)) continue;
    floated.add(targetId);

    const span = document.createElement("span");
    span.className = CLASSES.footnote;
    span.innerHTML = content;
    // Insert the float span immediately after the reference marker (the whole `sup` or the
    // bare anchor) so Paged.js anchors it to the correct page; the visible [n] marker stays
    // inline at the call site.
    ref.insertAdjacentElement("afterend", span);
    moved++;
  }

  // Only remove the end-of-doc list once at least one note was relocated, so unexpected
  // structures (zero matches) keep their original, still-readable footnote section.
  if (moved > 0) section.remove();
}

/**
 * Ensure a `nav.toc` with `a.toc-link` anchors exists when `settings.showToc`, and remove
 * any TOC when it is off.
 *
 * markdown-it-toc-done-right emits a `<nav class="toc">` (or a bare `.toc` list) wherever the
 * source had `[[toc]]`. When present we normalise it in place — the author chose where it
 * goes: wrap in `nav.toc` if needed, tag each intra-document link with `a.toc-link` so the
 * paged `target-counter` leader rule applies, and wrap each title in `span.toc-text`.
 * When the source had no `[[toc]]` marker, we synthesize a TOC from the rendered h1–h3 ids
 * (the very ids markdown-it-anchor produced) and insert it immediately AFTER the first `h1`
 * (top of the document when there is no h1).
 */
export function injectToc(root: ParentNode, settings: Settings): void {
  const existing = findTocElement(root);

  if (!settings.showToc) {
    if (existing) (existing.closest("nav.toc") ?? existing).remove();
    return;
  }

  if (existing) {
    normalizeToc(existing);
    return;
  }

  // No [[toc]] in source → synthesize from headings.
  const nav = buildTocFromHeadings(root);
  if (!nav) return;

  // Deterministic placement rule: a SYNTHESIZED TOC goes immediately AFTER the document's
  // first <h1> (the title), so the reader sees title → contents → body. Only when there is
  // no h1 at all does it go to the top of the document. An author-placed `[[toc]]` marker
  // always wins — that path returns above via normalizeToc.
  const title = root.querySelector("h1");
  if (title) {
    title.after(nav);
    return;
  }
  const firstChild = (root as Element).firstElementChild;
  if (firstChild) firstChild.before(nav);
  else (root as Element).append(nav);
}

/** Locate the toc-done-right output: a `nav.toc`, or a bare list carrying the `.toc` class. */
function findTocElement(root: ParentNode): Element | null {
  return root.querySelector(`nav.${CLASSES.toc}, .${CLASSES.toc}`);
}

/**
 * Normalise an existing TOC: ensure it is wrapped in `nav.toc`, and stamp every in-document
 * anchor with the `toc-link` class so the paged leader/target-counter rule targets it.
 */
function normalizeToc(tocEl: Element): void {
  let nav: Element;
  if (tocEl.matches(`nav.${CLASSES.toc}`)) {
    nav = tocEl;
  } else if (tocEl.closest(`nav.${CLASSES.toc}`)) {
    nav = tocEl.closest(`nav.${CLASSES.toc}`)!;
  } else {
    // Bare `.toc` list (no nav wrapper) — wrap it.
    const wrapper = document.createElement("nav");
    wrapper.className = CLASSES.toc;
    tocEl.replaceWith(wrapper);
    wrapper.appendChild(tocEl);
    nav = wrapper;
  }
  // The nav itself must carry the toc class even if only the inner list did.
  nav.classList.add(CLASSES.toc);

  nav.querySelectorAll<HTMLAnchorElement>("a[href^='#']").forEach((a) => {
    a.classList.add(CLASSES.tocLink);
    wrapTocTitle(a);
  });
}

/**
 * Put the entry title in its own `span.toc-text` so the dot-leader row has three real flex
 * items (title | leader | page number). Without it the leader-less fallback has nothing to
 * grow and the dots run past the page number. Idempotent.
 */
function wrapTocTitle(link: HTMLAnchorElement): void {
  if (link.querySelector(`:scope > .${CLASSES.tocText}`)) return;
  const span = document.createElement("span");
  span.className = CLASSES.tocText;
  // Move the link's own content (text and any inline markup) into the span. Nested
  // sub-lists are siblings of the link, so nothing structural is captured here.
  span.append(...Array.from(link.childNodes));
  link.appendChild(span);
}

/**
 * Synthesize `nav.toc > ol > li > a.toc-link[href="#id"] > span.toc-text` from the h1–h3 ids.
 * Returns null when there are no usable headings. Headings are nested by level so the TOC
 * mirrors document structure; the header-anchor permalink (if any) is ignored — we link to
 * the heading id directly.
 */
function buildTocFromHeadings(root: ParentNode): Element | null {
  const headings = Array.from(
    root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]"),
  ).filter((h) => !h.closest(`nav.${CLASSES.toc}`));
  if (headings.length === 0) return null;

  const nav = document.createElement("nav");
  nav.className = CLASSES.toc;

  const rootList = document.createElement("ol");
  nav.appendChild(rootList);

  // Stack of (level, list) to nest sub-headings under their parents.
  const stack: Array<{ level: number; list: HTMLOListElement }> = [{ level: 0, list: rootList }];

  for (const heading of headings) {
    const id = heading.getAttribute("id");
    if (!id) continue;
    const level = Number(heading.tagName.slice(1)); // 1 | 2 | 3

    // Pop deeper/equal levels so we attach under the right parent.
    while (stack.length > 1 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!;

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = CLASSES.tocLink;
    a.setAttribute("href", `#${id}`);
    const text = document.createElement("span");
    text.className = CLASSES.tocText;
    text.textContent = headingText(heading);
    a.appendChild(text);
    li.appendChild(a);
    parent.list.appendChild(li);

    // Open a nested list for any deeper headings that follow.
    const subList = document.createElement("ol");
    li.appendChild(subList);
    stack.push({ level, list: subList });
  }

  // Drop empty nested lists left behind by leaf headings.
  nav.querySelectorAll("ol:empty").forEach((ol) => ol.remove());

  return nav;
}

const HEADER_ANCHOR_SELECTOR = `a.${CLASSES.headerAnchor}, a.header-anchor`;

/**
 * Heading text without the injected permalink anchor.
 *
 * markdown-it-anchor has two permalink families and they need opposite treatment:
 *
 *  - GLYPH styles (`headerLink` is not one of them — think `linkInsideHeader`/`ariaHidden`
 *    "¶" or "#") append a small standalone anchor NEXT TO the text. Those must be deleted.
 *  - WRAPPER styles — `permalink.headerLink()`, which is what `createMarkdown` configures —
 *    wrap the ENTIRE heading text in `a.header-anchor`. Deleting the anchor there deletes
 *    the heading text, which is exactly how every synthesized TOC entry came out blank.
 *
 * So: strip anchors first; if anything is left, that was a glyph permalink and the stripped
 * text is correct. If nothing is left, the anchor was a wrapper — unwrap it (replace it with
 * its own children) and read the text back out.
 */
function headingText(heading: HTMLElement): string {
  const stripped = heading.cloneNode(true) as HTMLElement;
  stripped.querySelectorAll(HEADER_ANCHOR_SELECTOR).forEach((a) => a.remove());
  const withoutAnchors = (stripped.textContent ?? "").trim();
  if (withoutAnchors) return withoutAnchors;

  const unwrapped = heading.cloneNode(true) as HTMLElement;
  unwrapped.querySelectorAll(HEADER_ANCHOR_SELECTOR).forEach((a) => {
    a.replaceWith(...Array.from(a.childNodes));
  });
  return (unwrapped.textContent ?? "").trim();
}

/**
 * Step 5 of the render order: wait until web fonts are loaded and every image has decoded so
 * laid-out heights are final before Paged.js measures. Both are best-effort — a font that
 * never loads or an undecodable image must not hang the pipeline, so each await is guarded
 * and image failures resolve rather than reject.
 */
export async function awaitFontsAndImages(root: ParentNode): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];

  // Web fonts (KaTeX, document, code) settle height. `document.fonts` is absent in some test
  // environments (jsdom) — guard it.
  if (typeof document !== "undefined" && "fonts" in document && document.fonts) {
    tasks.push(Promise.resolve(document.fonts.ready).catch(() => undefined));
  }

  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  for (const img of images) {
    if (img.complete && img.naturalWidth > 0) continue;
    if (typeof img.decode === "function") {
      tasks.push(img.decode().catch(() => undefined));
    } else {
      tasks.push(
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
      );
    }
  }

  await Promise.all(tasks);
}
