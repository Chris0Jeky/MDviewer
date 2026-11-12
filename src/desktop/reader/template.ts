/**
 * Templates (A4; docs/design/ACTIONABLE_MARKDOWN.md §7). A Markdown file in a pinned project's
 * `templates/` folder starts a new document. `{{name}}` placeholders become a short form that asks
 * for each distinct name once; `{{date}}`, `{{time}}` and `{{title}}` are filled in without asking.
 * Pure: no DOM, no clock of its own.
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g;
const AUTOMATIC = new Set(["date", "time", "title"]);

/** The names the form asks for, distinct, in order of first use (automatic ones excluded). */
export function templateFields(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!AUTOMATIC.has(name.toLowerCase()) && !names.includes(name)) names.push(name);
  }
  return names;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** The template's title: its file name without the extension. */
export function templateTitle(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, "") || "Untitled";
}

/**
 * Fill every placeholder. Values are inserted as written; an unknown name (none was given)
 * stays as it is, so nothing is lost silently.
 */
export function fillTemplate(text: string, values: Readonly<Record<string, string>>, now: Date, title: string): string {
  const automatic: Record<string, string> = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    title,
  };
  // Own properties only: `{{constructor}}` is a field like any other, not Object's constructor.
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const key = name.toLowerCase();
    if (Object.hasOwn(automatic, key)) return automatic[key]!;
    return Object.hasOwn(values, name) ? values[name]! : whole;
  });
}
