import { native, type LibraryEntry, type ProjectFile } from "../native";
import { openLibraryEntry } from "../library";

/**
 * The Library panel body (S4 panel): Pinned, Recent, Projects and Activity from the native
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
  const fail = (error: unknown): void => { status.textContent = error instanceof Error ? error.message : String(error); };
  const pinned = section("Pinned", "Pin a document from the palette (Ctrl+K).");
  const recent = section("Recent", "Files you open appear here.");
  const projects = section("Projects", "Pin a folder to see its Markdown and agent files.");
  const activity = section("Activity", "Nothing has changed in your projects since you last looked.");
  const addProject = node("button", "shell-library-action", "Pin a project folder…");
  addProject.type = "button";
  addProject.addEventListener("click", async () => {
    try { if (await native.library.addProject()) await refresh(); }
    catch (error) { fail(error); }
  });
  projects.heading.after(addProject);
  // Activity scans every project, so it runs only while shown.
  const showActivity = node("button", "shell-library-toggle shell-library-subtoggle", "Changed since you looked");
  showActivity.type = "button";
  showActivity.setAttribute("aria-expanded", "false");
  showActivity.addEventListener("click", () => {
    showActivity.setAttribute("aria-expanded", String(showActivity.getAttribute("aria-expanded") !== "true"));
    void loadActivity();
  });
  activity.heading.after(showActivity);
  activity.list.hidden = true;
  host.append(pinned.root, recent.root, projects.root, activity.root);

  const open = (id: string) => () => { void openLibraryEntry(id).then(refresh, () => undefined); };
  /** A small text button beside a row; the library re-reads after it acts. */
  function mini(label: string, name: string, run: () => Promise<unknown>): HTMLButtonElement {
    const button = node("button", "shell-library-mini", label);
    button.type = "button";
    button.setAttribute("aria-label", `${label} ${name}`);
    button.addEventListener("click", () => { void run().then(refresh, fail); });
    return button;
  }

  async function loadActivity(): Promise<void> {
    const shown = showActivity.getAttribute("aria-expanded") === "true";
    activity.list.hidden = !shown;
    if (!shown) { activity.list.replaceChildren(); return; }
    const view = await native.library.list().catch(() => null);
    const changed: Array<{ file: ProjectFile; project: LibraryEntry }> = [];
    let truncated = false;
    for (const project of view?.projects ?? []) {
      try {
        const scan = await native.library.scan(project.id);
        truncated ||= scan.truncated;
        for (const file of scan.files) if (file.unseen) changed.push({ file, project });
      } catch { /* A missing folder shows in Projects; Activity lists what it can read. */ }
    }
    changed.sort((a, b) => b.file.modified - a.file.modified);
    activity.list.replaceChildren(...changed.slice(0, 20).map(({ file, project }) =>
      fileButton(file.name, `${project.name}\\${file.relative.replace(/[\\/]?[^\\/]*$/, "")}`.replace(/\\$/, ""), open(file.id), true)));
    if (truncated) activity.list.append(node("li", "shell-library-note", "A project is large; only its first files were scanned."));
  }

  async function expand(project: LibraryEntry, item: HTMLElement, toggle: HTMLButtonElement, keep = false): Promise<void> {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    if (!keep) toggle.setAttribute("aria-expanded", String(!expanded));
    item.querySelector(".shell-library-files")?.remove();
    if (expanded && !keep) return;
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
        for (const file of list) ul.append(fileButton(file.name, file.relative.replace(/[\\/]?[^\\/]*$/, ""), open(file.id), file.unseen));
        files.append(ul);
      }
      const unseen = scan.files.filter(file => file.unseen);
      if (unseen.length) {
        const seen = node("button", "shell-library-action", "Mark all as seen");
        seen.type = "button";
        seen.addEventListener("click", () => {
          void Promise.all(unseen.map(file => native.library.markSeen(file.id)))
            .then(() => expand(project, item, toggle, true))
            .then(() => (showActivity.getAttribute("aria-expanded") === "true" ? loadActivity() : undefined), fail);
        });
        files.append(seen);
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
    catch (error) { fail(error); return; }
    status.textContent = "";
    const pinnedIds = new Set(view.pinned.map(entry => entry.id));
    pinned.list.replaceChildren(...view.pinned.map(entry => {
      const item = fileButton(entry.name, folderOf(entry), open(entry.id));
      item.append(mini("Unpin", entry.name, () => native.library.unpin(entry.id)));
      return item;
    }));
    recent.list.replaceChildren(...view.recent.slice(0, 15).map(entry => {
      const item = fileButton(entry.name, folderOf(entry), open(entry.id));
      if (!pinnedIds.has(entry.id)) {
        item.append(mini("Pin", entry.name, async () => {
          if (!await native.library.pinEntry(entry.id)) throw new Error("Unpin a file first: at most 64 can be pinned.");
        }));
      }
      item.append(mini("Remove", `${entry.name} from Recent`, () => native.library.forget(entry.id)));
      return item;
    }));
    projects.list.replaceChildren(...view.projects.map(project => {
      const item = node("li", "shell-library-project");
      const row = node("div", "shell-library-item");
      const toggle = node("button", "shell-library-toggle", project.name);
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "false");
      toggle.title = project.path;
      toggle.addEventListener("click", () => { void expand(project, item, toggle); });
      row.append(toggle, mini("Remove", `project ${project.name}`, () => native.library.unpin(project.id)));
      item.append(row);
      return item;
    }));
    if (showActivity.getAttribute("aria-expanded") === "true") await loadActivity();
  }

  void refresh();
  // Refresh when the window regains focus (files may have changed) unless the user is in the list,
  // and whenever a pin, project or clear happens elsewhere.
  const onFocus = (): void => { if (!host.contains(document.activeElement)) void refresh(); };
  const onChanged = (): void => { void refresh(); };
  window.addEventListener("focus", onFocus);
  window.addEventListener("mdviewer:library-changed", onChanged);
  return () => { window.removeEventListener("focus", onFocus); window.removeEventListener("mdviewer:library-changed", onChanged); };
}
