import katexCss from "katex/dist/katex.min.css?inline";
import readerCss from "../desktop/reader.css?inline";
import documentCss from "../styles/document.css?inline";
import shikiCss from "../styles/shiki.css?inline";
import { DEFAULT_SETTINGS } from "../app/settings";
import { renderReaderDocument } from "../desktop/render";
import { parseActionable, planChange, type Control, type ControlAction, type LinePatch } from "../render/actionable";

/**
 * `<mdviewer-reader>` (Actionable Markdown A5; docs/design/ACTIONABLE_MARKDOWN.md, "The same view
 * inside another tool"): the desktop reading view in a shadow root, for another page or tool.
 *
 * Give it Markdown with the `markdown` property (or attribute). A real click or key press on a
 * control dispatches `change` with `detail: { patches: LinePatch[] }` (the line patches of
 * src/render/actionable.ts). The element never writes anywhere and does not touch its own text:
 * the host applies the patches (`applyPatches`), saves, and sets `markdown` again, which re-renders.
 * Set `data-app-theme="dark"` or `"sepia"` on the element for another palette. No network, no storage.
 */
export interface MdviewerChangeDetail { patches: LinePatch[] }

// The reader's stylesheets were written for the page: in a shadow root `:root` is the host.
const STYLES = [katexCss, readerCss, documentCss, shikiCss].join("\n")
  .replace(/:root\[([^\]]+)\]/g, ":host($1)")
  .replace(/:root\b/g, ":host")
  + `\n:host { display: block; contain: paint; } /* document HTML (position: fixed) never paints over the host page */
.desktop-reader { position: relative; font: 14px/1.5 system-ui, "Segoe UI", sans-serif; color: var(--reader-fg); }
.desktop-reader * , .desktop-reader *::before, .desktop-reader *::after { box-sizing: border-box; }
.desktop-reader .reader-document { max-width: none; margin: 0; }
.embed-error { margin: 0; color: #b42318; }`;

// A shadow root ignores @font-face: the math fonts must be declared in the page. The bundle's own
// stylesheet (next to it, from the same origin) carries them; the rules themselves are in STYLES.
if (!document.querySelector("link[data-mdviewer-reader]")) {
  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href = import.meta.url.replace(/\.js(\?.*)?$/, ".css");
  fonts.dataset.mdviewerReader = "";
  document.head.append(fonts);
}

// Mermaid is a singleton and not re-entrant: every element's render waits in one queue.
let queue: Promise<void> = Promise.resolve();

export class MdviewerReader extends HTMLElement {
  static observedAttributes = ["markdown"];
  readonly #page = document.createElement("div");
  readonly #article = document.createElement("article");
  #text = "";
  #generation = 0;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    this.#page.className = "desktop-reader";
    this.#article.className = "doc reader-document";
    this.#article.setAttribute("aria-label", "Markdown document");
    this.#page.append(this.#article);
    shadow.append(style, this.#page);
    // A fragment link scrolls within this element: the page's own `#id` lookup cannot see inside.
    this.#article.addEventListener("click", event => {
      const link = (event.target as Element).closest?.("a[href^='#']");
      if (!link) return;
      event.preventDefault();
      let id = link.getAttribute("href")!.slice(1);
      try { id = decodeURIComponent(id); } catch { /* an id with a stray % is looked up as written */ }
      shadow.getElementById(id)?.scrollIntoView();
    });
  }

  get markdown(): string { return this.#text; }
  set markdown(value: string) { this.#text = String(value ?? ""); this.#render(); }
  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "markdown") this.markdown = value ?? "";
  }

  #render(): void {
    const generation = ++this.#generation;
    const text = this.#text;
    const root = this.shadowRoot!;
    // This render's controls act on the text it shows; the host's `expect` check rejects them if it moved on.
    const onAction = (control: Control, action: ControlAction): void => {
      const patches = planChange(text, parseActionable(text), control, action);
      if (patches.length) this.dispatchEvent(new CustomEvent<MdviewerChangeDetail>("change", { detail: { patches }, bubbles: true, composed: true }));
    };
    // A re-render after a change returns the keyboard to the control it came from.
    const key = (root.activeElement as HTMLElement | null)?.dataset?.amKey;
    queue = queue.catch(() => undefined).then(async () => {
      if (generation !== this.#generation) return;
      try {
        await renderReaderDocument(text, DEFAULT_SETTINGS, "", staged => {
          if (generation !== this.#generation) return null;
          this.#article.setAttribute("data-code-theme", DEFAULT_SETTINGS.codeTheme);
          this.#article.replaceChildren(...staged.childNodes);
          if (key) this.#article.querySelector<HTMLElement>(`[data-am-key="${key}"]`)?.focus({ preventScroll: true });
          return this.#article;
        }, { controls: { onAction, menuHost: this.#page }, copy: false });
      } catch (error) {
        if (generation !== this.#generation) return;
        const message = document.createElement("p");
        message.className = "embed-error";
        message.setAttribute("role", "alert");
        message.textContent = `Could not render this document: ${error instanceof Error ? error.message : String(error)}`;
        this.#article.replaceChildren(message);
      }
    });
  }
}

if (!customElements.get("mdviewer-reader")) customElements.define("mdviewer-reader", MdviewerReader);
