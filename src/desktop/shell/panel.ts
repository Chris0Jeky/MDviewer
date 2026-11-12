import { listPanels } from "../panels";

/**
 * The collapsible left panel's tab host (S3), loaded the first time the panel opens. It
 * shows every registered panel (Library, Outline) as APG tabs and mounts a panel's body only
 * when its tab is first shown.
 */
export function mountPanelHost(aside: HTMLElement, initial: string | null): { show(id: string): void } {
  const tablist = document.createElement("div");
  tablist.className = "shell-panel-tabs";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Panel");
  const bodies = new Map<string, HTMLElement>();
  const mounted = new Set<string>();
  const panels = listPanels();
  aside.replaceChildren(tablist);

  for (const panel of panels) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.id = `shell-panel-tab-${panel.id}`;
    tab.dataset.panel = panel.id;
    tab.textContent = panel.title;
    tab.setAttribute("aria-controls", `shell-panel-body-${panel.id}`);
    tablist.append(tab);
    const body = document.createElement("div");
    body.id = `shell-panel-body-${panel.id}`;
    body.className = "shell-panel-body";
    body.setAttribute("role", "tabpanel");
    body.setAttribute("aria-labelledby", tab.id);
    body.hidden = true;
    aside.append(body);
    bodies.set(panel.id, body);
  }

  function show(id: string): void {
    const target = panels.find(panel => panel.id === id) ?? panels[0];
    if (!target) return;
    for (const tab of tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      const on = tab.dataset.panel === target.id;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    for (const [panelId, body] of bodies) body.hidden = panelId !== target.id;
    if (!mounted.has(target.id)) {
      mounted.add(target.id);
      target.mount(bodies.get(target.id)!);
    }
  }

  tablist.addEventListener("click", event => {
    const tab = (event.target as Element | null)?.closest<HTMLElement>('[role="tab"]');
    if (tab) show(tab.dataset.panel!);
  });
  tablist.addEventListener("keydown", event => {
    const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (at + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    show(tabs[next]!.dataset.panel!);
    tabs[next]!.focus();
  });
  show(initial ?? panels[0]?.id ?? "");
  return { show };
}
