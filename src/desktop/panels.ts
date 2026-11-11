/**
 * Registry for collapsible side panels (Library, Outline, ...). The shell owns
 * where and when a panel shows; a panel only mounts into the host it is given
 * and returns its teardown.
 */
export interface Panel {
  id: string;
  title: string;
  mount: (host: HTMLElement) => () => void;
}

const panels = new Map<string, Panel>();

/** Register a panel; returns its unregister function. Ids are unique. */
export function registerPanel(panel: Panel): () => void {
  if (panels.has(panel.id)) throw new Error(`Panel already registered: ${panel.id}`);
  panels.set(panel.id, panel);
  return () => { if (panels.get(panel.id) === panel) panels.delete(panel.id); };
}

export function listPanels(): Panel[] {
  return [...panels.values()];
}
