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
  // A removed row takes its button with it: focus lands on the section heading instead.
  for (const part of [pinned, recent, projects, activity]) part.heading.tabIndex = -1;
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
  /** Projects the reader expanded stay expanded when the library re-reads. */
  const expandedProjects = new Set<string>();

  const open = (id: string) => () => { void openLibraryEntry(id).then(refresh, () => undefined); };
  /** A small text button beside a row; the library re-reads after it acts and says what happened. */
  function mini(label: string, name: string, heading: HTMLElement, run: () => Promise<string>): HTMLButtonElement {
    const button = node("button", "shell-library-mini", label);
    button.type = "button";
    button.setAttribute("aria-label", `${label} ${name}`);
    button.addEventListener("click", () => {
      const settle = (): void => { if (!host.contains(document.activeElement)) heading.focus(); };
      void run().then(
        done => refresh().then(listed => { if (listed) status.textContent = done; settle(); }),
        error => refresh().then(() => { fail(error); settle(); }),
      );
    });
    return button;
  }

  let activityRun = 0;
  async function loadActivity(): Promise<void> {
    const run = ++activityRun;
    const shown = showActivity.getAttribute("aria-expanded") === "true";
    activity.list.hidden = !shown;
    if (!shown) { activity.list.replaceChildren(); return; }
    if (!activity.list.childElementCount) activity.list.append(node("li", "shell-library-note", "Looking for changes…"));
    let view;
    try { view = await native.library.list(); }
    catch (error) {
      if (run === activityRun) activity.list.replaceChildren(node("li", "shell-library-note", `Activity is unavailable: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const changed: Array<{ file: ProjectFile; project: LibraryEntry }> = [];
    let truncated = false;
    let unreadable = 0;
    for (const project of view.projects) {
      try {
        const scan = await native.library.scan(project.id);
        truncated ||= scan.truncated;
        for (const file of scan.files) if (file.unseen) changed.push({ file, project });
      } catch { unreadable++; }
      if (run !== activityRun) return; // A newer load owns the list.
    }
    changed.sort((a, b) => b.file.modified - a.file.modified);
    activity.list.replaceChildren(...changed.slice(0, 20).map(({ file, project }) =>
      fileButton(file.name, `${project.name}\\${file.relative.replace(/[\\/]?[^\\/]*$/, "")}`.replace(/\\$/, ""), open(file.id), true)));
    if (unreadable) activity.list.append(node("li", "shell-library-note", `${unreadable} ${unreadable === 1 ? "project" : "projects"} could not be read.`));
    if (truncated) activity.list.append(node("li", "shell-library-note", "A project is large; only its first files were scanned."));
  }

  async function expand(project: LibraryEntry, item: HTMLElement, toggle: HTMLButtonElement, keep = false): Promise<void> {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    if (!keep) toggle.setAttribute("aria-expanded", String(!expanded));
    item.querySelector(".shell-library-files")?.remove();
    if (expanded && !keep) { expandedProjects.delete(project.id); return; }
    expandedProjects.add(project.id);
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
      // Only what is listed here: each mark is one store write, and unlisted files were never shown.
      const unseen = groups.flatMap(([, list]) => list).filter(file => file.unseen);
      if (unseen.length) {
        const seen = node("button", "shell-library-action", "Mark all as seen");
        seen.type = "button";
        seen.addEventListener("click", () => {
          void Promise.all(unseen.map(file => native.library.markSeen(file.id)))
            .then(() => expand(project, item, toggle, true))
            .then(() => {
              status.textContent = `Marked ${unseen.length} ${unseen.length === 1 ? "file" : "files"} in ${project.name} as seen.`;
              if (!host.contains(document.activeElement)) toggle.focus();
              return showActivity.getAttribute("aria-expanded") === "true" ? loadActivity() : undefined;
            }, fail);
        });
        files.append(seen);
      }
      if (!files.querySelector("li")) files.append(node("p", "shell-library-note", "No agent files or recently changed Markdown here."));
      if (scan.truncated) files.append(node("p", "shell-library-note", "This folder is large; only the first files were scanned."));
    } catch (error) {
      files.append(node("p", "shell-library-note", error instanceof Error ? error.message : String(error)));
    }
  }

  /** Re-read the library; false when it could not be listed (the error is shown instead). */
  async function refresh(): Promise<boolean> {
    let view;
    try { view = await native.library.list(); }
    catch (error) { fail(error); return false; }
    status.textContent = "";
    const pinnedIds = new Set(view.pinned.map(entry => entry.id));
    pinned.list.replaceChildren(...view.pinned.map(entry => {
      const item = fileButton(entry.name, folderOf(entry), open(entry.id));
      item.append(mini("Unpin", entry.name, pinned.heading, async () => { await native.library.unpin(entry.id); return `Unpinned ${entry.name}.`; }));
      return item;
    }));
    recent.list.replaceChildren(...view.recent.slice(0, 15).map(entry => {
      const item = fileButton(entry.name, folderOf(entry), open(entry.id));
      if (!pinnedIds.has(entry.id)) {
        item.append(mini("Pin", entry.name, recent.heading, async () => {
          if (!await native.library.pinEntry(entry.id)) {
            throw new Error(`Could not pin ${entry.name}: at most 64 files can be pinned, or it is no longer in the library.`);
          }
          return `Pinned ${entry.name}.`;
        }));
      }
      item.append(mini("Remove", `${entry.name} from Recent`, recent.heading, async () => {
        await native.library.forget(entry.id);
        return `Removed ${entry.name} from Recent.`;
      }));
      return item;
    }));
    const known = new Set(view.projects.map(project => project.id));
    for (const id of expandedProjects) if (!known.has(id)) expandedProjects.delete(id);
    projects.list.replaceChildren(...view.projects.map(project => {
      const item = node("li", "shell-library-project");
      const row = node("div", "shell-library-item");
      const toggle = node("button", "shell-library-toggle", project.name);
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "false");
      toggle.title = project.path;
      toggle.addEventListener("click", () => { void expand(project, item, toggle); });
      row.append(toggle, mini("Remove", `project ${project.name}`, projects.heading, async () => {
        await native.library.unpin(project.id);
        return `Removed the project ${project.name}. No file was deleted.`;
      }));
      item.append(row);
      if (expandedProjects.has(project.id)) {
        toggle.setAttribute("aria-expanded", "true");
        void expand(project, item, toggle, true);
      }
      return item;
    }));
    // Not awaited: an action is announced without waiting for every project to be scanned.
    if (showActivity.getAttribute("aria-expanded") === "true") void loadActivity();
    return true;
  }

  // The panel stays mounted while hidden (Outline tab, closed sidebar): re-read and scan only while
  // the Library is on screen, and catch up once when it shows again.
  let stale = false;
  const visible = (): boolean => host.getClientRects().length > 0;
  const refreshIfShown = (): void => { if (visible()) { stale = false; void refresh(); } else stale = true; };
  const shown = new IntersectionObserver(entries => { if (stale && entries.some(entry => entry.isIntersecting)) refreshIfShown(); });
  shown.observe(host);
  void refresh();
  // Refresh when the window regains focus (files may have changed) unless the user is in the list,
  // and whenever a pin, project or clear happens elsewhere.
  const onFocus = (): void => { if (!host.contains(document.activeElement)) refreshIfShown(); };
  window.addEventListener("focus", onFocus);
  window.addEventListener("mdviewer:library-changed", refreshIfShown);
  return () => {
    shown.disconnect();
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("mdviewer:library-changed", refreshIfShown);
  };
}
