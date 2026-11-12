import { fillTemplate, templateFields, templateTitle } from "../reader/template";

/**
 * "New from template…" (A4): pick a template from a pinned project's `templates/` folder, answer
 * its short form (one field per distinct `{{name}}`), and get the filled text. The caller opens it
 * as an untitled note in Edit; it is saved through Save As. The reader is injected so the native
 * read stays swappable (and the module stays testable).
 */
export interface TemplateEntry { id: string; name: string; project: string }
export interface TemplateSource {
  /** `incomplete`: a project could not be read, or its scan was cut short, so some may be missing. */
  list(): Promise<{ entries: TemplateEntry[]; incomplete: boolean }>;
  read(id: string): Promise<{ name: string; text: string }>;
}

/** A template file sits directly inside `templates/`. */
export function isTemplatePath(relative: string): boolean {
  return /^templates[\\/][^\\/]+\.(md|markdown)$/i.test(relative);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Resolves with the filled text and the template's name, or null when canceled. */
export async function chooseTemplate(source: TemplateSource, now: () => Date = () => new Date()): Promise<{ title: string; text: string } | null> {
  const returnTo = document.activeElement as HTMLElement | null;
  const dialog = element("dialog", "shell-palette shell-template");
  dialog.setAttribute("aria-label", "New from template");
  const heading = element("h2", "shell-template-heading", "New from template");
  const body = element("div", "shell-template-body");
  const status = element("p", "shell-template-note");
  status.setAttribute("role", "status");
  dialog.append(heading, body, status);
  document.body.append(dialog);
  dialog.showModal();

  return new Promise(resolve => {
    let settled = false;
    const finish = (result: { title: string; text: string } | null): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      returnTo?.focus?.();
      resolve(result);
    };
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    dialog.addEventListener("close", () => finish(null));

    const form = (template: { name: string; text: string }): void => {
      const fields = templateFields(template.text);
      const title = templateTitle(template.name);
      const fill = (values: Record<string, string>): void => finish({ title, text: fillTemplate(template.text, values, now(), title) });
      if (!fields.length) { fill({}); return; }
      heading.textContent = title;
      const formElement = element("form", "shell-template-form");
      const inputs = fields.map(field => {
        const label = element("label", "shell-template-field");
        const text = element("span", "shell-template-label", field);
        const input = element("input", "shell-template-input");
        input.type = "text";
        input.name = field;
        input.autocomplete = "off";
        label.append(text, input);
        formElement.append(label);
        return input;
      });
      const actions = element("div", "shell-template-actions");
      const cancel = element("button", "shell-template-cancel", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", () => finish(null));
      const create = element("button", "shell-template-create", "Create");
      create.type = "submit";
      actions.append(cancel, create);
      formElement.append(actions);
      formElement.addEventListener("submit", event => {
        event.preventDefault();
        // A field left empty keeps its placeholder as written, so nothing is lost silently.
        fill(Object.fromEntries(inputs.filter(input => input.value !== "").map(input => [input.name, input.value])));
      });
      body.replaceChildren(formElement);
      inputs[0]!.focus();
    };

    void source.list().then(({ entries, incomplete }) => {
      if (settled) return;
      const partial = "Some projects could not be scanned in full, so templates may be missing.";
      if (!entries.length) {
        body.replaceChildren(element("p", "shell-template-note", incomplete ? partial
          : "No templates yet. Put Markdown files in a templates folder inside a pinned project."));
        const close = element("button", "shell-template-cancel", "Close");
        close.type = "button";
        close.addEventListener("click", () => finish(null));
        body.append(close);
        close.focus();
        return;
      }
      const list = element("ul", "shell-template-list");
      list.setAttribute("aria-label", "Templates");
      for (const entry of entries) {
        const item = element("li", "shell-template-item");
        const button = element("button", "shell-template-pick");
        button.type = "button";
        button.append(element("span", "shell-template-name", templateTitle(entry.name)), element("span", "shell-template-project", entry.project));
        button.addEventListener("click", () => {
          status.textContent = `Opening ${entry.name}…`;
          void source.read(entry.id).then(template => { status.textContent = ""; if (!settled) form(template); },
            error => { status.textContent = `Could not read ${entry.name}: ${error instanceof Error ? error.message : String(error)}`; });
        });
        item.append(button);
        list.append(item);
      }
      body.replaceChildren(list);
      if (incomplete) body.append(element("p", "shell-template-note", partial));
      list.querySelector("button")?.focus();
    }, error => {
      status.textContent = `Could not list templates: ${error instanceof Error ? error.message : String(error)}`;
    });
  });
}
