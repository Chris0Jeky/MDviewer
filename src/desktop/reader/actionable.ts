import type { Token } from "markdown-it";
import type { ActionableDocument } from "../../render/actionable";

type TokenConstructor = new (type: string, tag: string, nesting: -1 | 0 | 1) => Token;

/**
 * Reader-only field rendering (static in A1): on each `key:: value` line the key becomes a
 * label and the value stays rendered Markdown; a paragraph's field lines break onto lines of
 * their own. Works on the parsed tokens before rendering, so the source map is untouched.
 */
export function markFields(tokens: Token[], actionable: ActionableDocument, TokenCtor: TokenConstructor): void {
  const fields = new Map(actionable.controls.filter(control => control.kind === "field")
    .map(control => [control.line - 1, control.key]));
  if (!fields.size) return;
  for (const token of tokens) {
    if (token.type !== "inline" || !token.map || !token.children) continue;
    let line = token.map[0];
    let atLineStart = true;
    let open = false;
    const children: Token[] = [];
    const html = (content: string): Token => Object.assign(new TokenCtor("html_inline", "", 0), { content });
    for (const child of token.children) {
      const key = atLineStart ? fields.get(line) : undefined;
      if (key !== undefined && child.type === "text" && child.content.startsWith(`${key}::`)) {
        // The value is wrapped so the reader can edit it in place (A3).
        children.push(html(`<span class="am-field" data-am-line="${line + 1}"><span class="am-field-key">${key}</span><span class="am-field-value">`));
        open = true;
        child.content = child.content.slice(key.length + 2).replace(/^[ \t]/, "");
      }
      atLineStart = false;
      if (child.type === "softbreak" || child.type === "hardbreak") {
        if (open) { children.push(html("</span></span>")); open = false; }
        // A field line keeps its own line, before and after.
        if (child.type === "softbreak" && (fields.has(line) || fields.has(line + 1))) {
          const hard = new TokenCtor("hardbreak", "br", 0);
          children.push(hard);
        } else children.push(child);
        line += 1;
        atLineStart = true;
        continue;
      }
      children.push(child);
    }
    if (open) children.push(html("</span></span>"));
    token.children = children;
  }
}

/** The static chip row for front matter keys with `.options` (A1: not interactive yet). */
export function chipRow(actionable: ActionableDocument): HTMLElement | null {
  const chips = actionable.controls.filter(control => control.kind === "chip");
  if (!chips.length) return null;
  const row = document.createElement("div");
  row.className = "am-chips";
  for (const chip of chips) {
    const element = document.createElement("span");
    element.className = chip.options.includes(chip.value) ? "am-chip" : "am-chip am-off";
    element.dataset.src = `${chip.line}-${chip.line}`;
    const key = document.createElement("span");
    key.className = "am-chip-key";
    key.textContent = chip.key;
    const value = document.createElement("span");
    value.className = "am-chip-value";
    value.textContent = chip.value || "—";
    element.append(key, value);
    if (!chip.options.includes(chip.value)) element.title = `Not one of: ${chip.options.join(", ")}`;
    row.append(element);
  }
  return row;
}
