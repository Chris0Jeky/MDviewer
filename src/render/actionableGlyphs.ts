import type { MarkdownIt, Token } from "markdown-it";
import { MARK_LABELS, type Mark } from "./actionable";

/**
 * Static glyphs for the actionable marks and choices that GitHub task lists do not cover
 * (docs/design/ACTIONABLE_MARKDOWN.md): `[/]`, `[-]`, `[!]`, `[?]`, `( )` and `(x)` at the start
 * of a list item. `[ ]` and `[x]` stay with markdown-it-task-lists, so ordinary task lists
 * render exactly as before. Both the reader and the paginated output use this; neither
 * makes the glyphs interactive.
 */
const PREFIX = /^(?:\[([/!?-])\]|\(([ x])\))[ \t]/;
const CHOICE_LABELS = { " ": "Not selected", x: "Selected" } as const;

function addClass(token: Token, name: string): void {
  const current = token.attrGet("class");
  token.attrSet("class", current ? `${current} ${name}` : name);
}

export function actionableGlyphs(md: MarkdownIt): void {
  md.core.ruler.after("github-task-lists", "actionable-glyphs", state => {
    const tokens = state.tokens;
    for (let index = 2; index < tokens.length; index++) {
      const inline = tokens[index]!;
      if (inline.type !== "inline" || tokens[index - 1]!.type !== "paragraph_open" || tokens[index - 2]!.type !== "list_item_open") continue;
      const first = inline.children?.[0];
      const match = first?.type === "text" ? PREFIX.exec(first.content) : null;
      if (!match || !first) continue;
      const glyph = new state.Token("html_inline", "", 0);
      if (match[1]) {
        const mark = match[1] as Mark;
        glyph.content = `<span class="am-box" data-mark="${mark}" role="img" aria-label="${MARK_LABELS[mark]}"></span>`;
        if (mark === "-") addClass(tokens[index - 2]!, "am-dropped");
      } else {
        const state = match[2] as " " | "x";
        glyph.content = `<span class="am-radio${state === "x" ? " am-checked" : ""}" role="img" aria-label="${CHOICE_LABELS[state]}"></span>`;
      }
      first.content = first.content.slice(match[0].length);
      inline.content = inline.content.slice(match[0].length);
      inline.children!.unshift(glyph);
      addClass(tokens[index - 2]!, "task-list-item");
      addClass(tokens[index - 2]!, "am-item");
      // The enclosing list drops its bullets, as GitHub does for task lists.
      for (let parent = index - 3; parent >= 0; parent--) {
        const token = tokens[parent]!;
        if ((token.type === "bullet_list_open" || token.type === "ordered_list_open") && token.level === tokens[index - 2]!.level - 1) {
          if (!String(token.attrGet("class") ?? "").includes("contains-task-list")) addClass(token, "contains-task-list");
          break;
        }
      }
    }
  });
}
