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

import type { DocFont, Settings } from "../app/settings";
import { ATTRS, CLASSES } from "../app/dom";

/**
 * Font-family stacks per DocFont group. These mirror `src/styles/document.css` exactly; we
 * set both the canonical `data-doc-font` hook (which document.css keys on) and an inline
 * `--doc-font-family` custom property so the typography is correct regardless of which
 * cascade path wins (and so the fragment is self-describing for the export canvas path).
 */
const DOC_FONT_STACKS: Record<DocFont, string> = {
  serif: `"Source Serif 4", "Source Serif Pro", "Charter", "Georgia", "Times New Roman", serif`,
  sans: `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
  slab: `"Roboto Slab", "Rockwell", "Source Serif 4", "Georgia", "Times New Roman", serif`,
};

/**
 * Parse `html` into a `.doc` root inside a DocumentFragment and apply the TOC + footnote
 * transforms. The returned fragment is the pristine, layout-free source Paged.js paginates.
 */
export function buildPaginationSource(html: string, settings: Settings): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const doc = document.createElement("div");
  doc.className = CLASSES.doc;

  // Typography tokens consumed by document.css and the paged stylesheet.
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
  let moved = 0;
  for (const ref of refs) {
    const anchor = ref.matches("a") ? ref : ref.querySelector("a");
    const href = anchor?.getAttribute("href") ?? "";
    const targetId = href.startsWith("#") ? href.slice(1) : "";
    const content = contentById.get(targetId);
    if (!content) continue;

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
 * source had `[[toc]]`. When present we normalise it: wrap in `nav.toc` if needed and tag each
 * intra-document link with `a.toc-link` so the paged `target-counter` leader rule applies.
 * When the source had no `[[toc]]` marker, we synthesize a TOC from the rendered h1–h3 ids
 * (the very ids markdown-it-anchor produced) and prepend it.
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
  });
}

/**
 * Synthesize `nav.toc > ol > li > a.toc-link[href="#id"]` from the rendered h1–h3 ids.
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
    a.textContent = headingText(heading);
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

/** Heading text without the injected permalink anchor (e.g. markdown-it-anchor's "¶"). */
function headingText(heading: HTMLElement): string {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`a.${CLASSES.headerAnchor}, a.header-anchor`).forEach((a) => a.remove());
  return (clone.textContent ?? "").trim();
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
