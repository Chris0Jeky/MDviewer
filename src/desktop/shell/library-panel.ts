import { native, type LibraryEntry, type ProjectFile } from "../native";
import { openLibraryEntry } from "../library";

/**
 * The Library panel body (S3/S4 panel): Pinned, Recent and Projects from the native
 * library. A project expands to its Agent files first, then other Markdown files changed
 * since you last looked. Paths are display text only; opening goes through opaque ids.
 *
 * Two different marks, never colour alone: a tab's filled dot means unsaved changes; here a
 * hollow diamond means the file changed on disk since you last viewed it.
 */
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const CHANGED = "Changed on disk since you last viewed it";

function fileButton(label: string, detail: string, open: () => void, changed = false): HTMLElement {
  const item = node("li", "shell-library-item");
  const button = node("button", "shell-library-open");
  button.type = "button";
  button.title = detail ? `${label} — ${detail}` : label;
  button.append(node("span", "shell-library-name", label));
  if (detail) button.append(node("span", "shell-library-detail", detail));
  if (changed) {
    const mark = node("span", "shell-changed");
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", CHANGED);
    mark.title = CHANGED;
    button.append(mark);
  }
  button.addEventListener("click", open);
  item.append(button);
  return item;
}

function section(title: string, empty: string): { root: HTMLElement; list: HTMLUListElement; heading: HTMLElement } {
  const root = node("section", "shell-library-section");
  const heading = node("h2", "shell-library-heading", title);
  const list = node("ul", "shell-library-list");
  root.append(heading, list);
  list.dataset.empty = empty;
  return { root, list, heading };
}

function folderOf(entry: LibraryEntry): string {
  return entry.dir.split(/[\\/]/).filter(Boolean).slice(-2).join("\\");
}

export function mountLibrary(host: HTMLElement): () => void {
  if (!native.available) {
    host.append(node("p", "shell-library-note", "Pinned files, recent files and projects are available in the Windows app."));
    return () => undefined;
  }
  const status = node("p", "shell-library-note");
  status.setAttribute("role", "status");
  host.append(status);
  const pinned = section("Pinned", "Pin a document from the palette (Ctrl+K).");
  const recent = section("Recent", "Files you open appear here.");
  const projects = section("Projects", "Pin a folder to see its Markdown and agent files.");
  const addProject = node("button", "shell-library-action", "Pin a project folder…");
  addProject.type = "button";
  addProject.addEventListener("click", async () => {
    try { if (await native.library.addProject()) await refresh(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  });
  projects.heading.after(addProject);
  host.append(pinned.root, recent.root, projects.root);

  const open = (id: string) => () => { void openLibraryEntry(id).then(() => native.library.markSeen(id)).then(refresh, () => undefined); };

  async function expand(project: LibraryEntry, item: HTMLElement, toggle: HTMLButtonElement): Promise<void> {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    item.querySelector(".shell-library-files")?.remove();
    if (expanded) return;
    const files = node("div", "shell-library-files");
    item.append(files);
    try {
      const scan = await native.library.scan(project.id);
      const groups: Array<[string, ProjectFile[]]> = [
        ["Agent files", scan.files.filter(file => file.agent)],
        ["Changed since you looked", scan.files.filter(file => !file.agent && file.unseen).slice(0, 50)],
      ];
      for (const [title, list] of groups) {
        if (!list.length) continue;
        files.append(node("h3", "shell-library-subheading", title));
        const ul = node("ul", "shell-library-list");
        for (const file of list) ul.append(fileButton(file.name, file.relative.replace(/[\\/][^\\/]*$/, ""), open(file.id), file.unseen));
        files.append(ul);
      }
      if (!files.querySelector("li")) files.append(node("p", "shell-library-note", "No agent files or recently changed Markdown here."));
      if (scan.truncated) files.append(node("p", "shell-library-note", "This folder is large; only the first files were scanned."));
    } catch (error) {
      files.append(node("p", "shell-library-note", error instanceof Error ? error.message : String(error)));
    }
  }

  async function refresh(): Promise<void> {
    let view;
    try { view = await native.library.list(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error); return; }
    status.textContent = "";
    pinned.list.replaceChildren(...view.pinned.map(entry => {
      const item = fileButton(entry.name, folderOf(entry), open(entry.id));
      const unpin = node("button", "shell-library-mini", "Unpin");
      unpin.type = "button";
      unpin.setAttribute("aria-label", `Unpin ${entry.name}`);
      unpin.addEventListener("click", () => { void native.library.unpin(entry.id).then(refresh); });
      item.append(unpin);
      return item;
    }));
    recent.list.replaceChildren(...view.recent.slice(0, 15).map(entry => fileButton(entry.name, folderOf(entry), open(entry.id))));
    projects.list.replaceChildren(...view.projects.map(project => {
      const item = node("li", "shell-library-project");
      const toggle = node("button", "shell-library-toggle", project.name);
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "false");
      toggle.title = project.path;
      toggle.addEventListener("click", () => { void expand(project, item, toggle); });
      item.append(toggle);
      return item;
    }));
  }

  void refresh();
  const onFocus = (): void => { void refresh(); };
  window.addEventListener("focus", onFocus);
  return () => window.removeEventListener("focus", onFocus);
}
