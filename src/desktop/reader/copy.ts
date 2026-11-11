import { rangeOf, sectionRange, selectionRange, sliceSource, type ReaderSource } from "./sourcemap";

/**
 * Reader copy toolkit: a Copy button on every code block, Copy link and Copy section on
 * top-level headings, and Ctrl+Shift+C for the Markdown source of a selection. Plain Ctrl+C
 * stays the browser default. Heading buttons carry no text so the outline and tests that read
 * heading text are unaffected; their names come from aria-label.
 */

const sources = new WeakMap<HTMLElement, ReaderSource>();
let toast: HTMLElement | null = null;
let toastTimer = 0;

function announce(message: string): void {
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "reader-toast";
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.classList.remove("is-visible"), 1600);
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    announce(done);
  } catch (error) {
    announce(`Could not copy: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const ICONS = {
  copy: "M5 5V3.5A1.5 1.5 0 0 1 6.5 2h6A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H11M3.5 5h6A1.5 1.5 0 0 1 11 6.5v6A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5z",
  link: "M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1",
};

function iconButton(className: string, label: string, icon: keyof typeof ICONS, run: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.title = label;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[icon]);
  svg.append(path);
  button.append(svg);
  button.addEventListener("click", event => { event.preventDefault(); run(); });
  return button;
}

function lineCount(text: string): string {
  const lines = text ? text.split("\n").length : 0;
  return `${lines} ${lines === 1 ? "line" : "lines"}`;
}

/** Add the copy affordances to a freshly rendered reader document. */
export function decorateCopy(root: HTMLElement, source: ReaderSource, fileName: string): void {
  sources.set(root, source);
  for (const pre of root.querySelectorAll<HTMLElement>("pre[data-src]")) {
    const start = rangeOf(pre)?.[0];
    const body = start === undefined ? undefined : source.fences.get(start);
    if (body === undefined) continue; // indented code and raw HTML <pre> have no fence body
    const wrapper = document.createElement("div");
    wrapper.className = "reader-code";
    pre.replaceWith(wrapper);
    wrapper.append(pre, iconButton("reader-copy", "Copy code", "copy", () => { void copy(body, `Copied ${lineCount(body)} of code`); }));
  }
  for (const heading of root.querySelectorAll<HTMLElement>(":scope > :is(h1,h2,h3,h4,h5,h6)[id][data-src]")) {
    const tools = document.createElement("span");
    tools.className = "reader-heading-tools";
    tools.append(
      iconButton("reader-heading-tool", "Copy link to section", "link", () => {
        void copy(`${fileName}#${heading.id}`, "Copied link to section");
      }),
      iconButton("reader-heading-tool", "Copy section as Markdown", "copy", () => {
        const range = sectionRange(heading, source.lines.length);
        if (range) { const text = sliceSource(source, ...range); void copy(text, `Copied section (${lineCount(text)})`); }
      }),
    );
    heading.append(tools);
  }
}

/** The document root keeps its source when its children move into the live article. */
export function bindReaderSource(root: HTMLElement, from: HTMLElement): void {
  const source = sources.get(from);
  if (source) sources.set(root, source); else sources.delete(root);
}

/** Ctrl/Cmd+Shift+C copies the Markdown source of every block the selection touches. */
export function mountSelectionCopy(root: HTMLElement): void {
  window.addEventListener("keydown", event => {
    if (event.key.toLowerCase() !== "c" || !event.shiftKey || event.altKey || event.ctrlKey === event.metaKey) return;
    const source = sources.get(root);
    const range = source && !root.hidden && selectionRange(root, window.getSelection());
    if (!source || !range) return;
    event.preventDefault();
    const text = sliceSource(source, ...range);
    void copy(text, `Copied ${lineCount(text)} of Markdown`);
  });
}
