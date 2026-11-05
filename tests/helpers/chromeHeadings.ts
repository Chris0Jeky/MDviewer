/** Literal title/ID pairs: these names remain valid authored headings. */
export const chromeHeadings = [
  { title: "Workspace", id: "workspace" },
  { title: "Editor pane", id: "editor-pane" },
  { title: "Editor match cue", id: "editor-match-cue" },
  { title: "Split handle", id: "split-handle" },
  { title: "Canvas", id: "canvas" },
  { title: "App", id: "app" },
  { title: "Status live", id: "status-live" },
  { title: "Toolbar", id: "toolbar" },
  { title: "Paged output", id: "paged-output" },
  { title: "Drag overlay", id: "drag-overlay" },
  { title: "Empty state", id: "empty-state" },
  { title: "Page chip", id: "page-chip" },
  { title: "Zoom control", id: "zoom-control" },
  { title: "Warning banner", id: "warning-banner" },
  { title: "Error card", id: "error-card" },
  { title: "Reader shell", id: "reader-shell" },
  { title: "Desktop workspace", id: "desktop-workspace" },
] as const;

export const chromeHeadingMarkdown = "# Chrome heading collisions\n\n" + chromeHeadings
  .map(({ title }) => `## ${title}\n\nOrdinary document text.`).join("\n\n");
