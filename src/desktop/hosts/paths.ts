/**
 * The folder rules of the browser host (web parity W4), one pure module. It mirrors the native
 * policy in `src-tauri/src/assets.rs` (relative references, Markdown-only link targets, image
 * types and sizes) and `src-tauri/src/library.rs` (the bounded project scan, agent files and
 * templates), with one rule the native host does not need: a reference never leaves the folder
 * the user granted. Paths here are segment lists relative to that folder's root.
 */
import { DOCUMENT_EXTENSIONS } from "./codec";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_TEMPLATE_BYTES = 1_000_000;
export const SCAN_DEPTH = 8;
export const SCAN_FILES = 5_000;
const SKIPPED = ["node_modules", ".git", "target", "dist", "build", ".venv"];
const AGENT_FOLDERS = [".claude", ".codex", ".agent-harness"];
const SECRETS = ["auth.json", ".credentials.json", "credentials.json"];
const MARKDOWN = ["md", "markdown"];

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/**
 * Resolve a reference written in the document at `from` (its segments, file name last) to segments
 * under the granted root, as `assets::resolve` does: a leading `@` (imports), `/` or `\` separators,
 * percent-encoding, `./` and `../`; `#fragment` and `?query` dropped. Refuses URLs and anything with
 * a colon, absolute or rooted forms, control characters, and any path that climbs above the root.
 */
export function resolveReference(from: readonly string[], reference: string): string[] | null {
  let text = reference.trim();
  if (text.startsWith("@")) text = text.slice(1);
  text = text.split(/[#?]/, 1)[0]!;
  if (!text || text.includes(":") || /^[/\\]/.test(text)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(text); } catch { return null; }
  // eslint-disable-next-line no-control-regex
  if (decoded.includes(":") || /^[/\\]/.test(decoded) || /[\u0000-\u001f\u007f]/.test(decoded)) return null;
  const resolved = from.slice(0, -1);
  for (const part of decoded.split(/[/\\]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!resolved.length) return null; // never above the granted folder
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.length ? resolved : null;
}

/** `[[name]]` → `name.md` (`with_markdown_extension`). */
export function withMarkdownExtension(segments: readonly string[]): string[] {
  const last = segments.at(-1) ?? "";
  return extensionOf(last) ? [...segments] : [...segments.slice(0, -1), `${last}.md`];
}

/** A link opens another Markdown document only (`is_markdown_target`). */
export const isMarkdownName = (name: string): boolean => MARKDOWN.includes(extensionOf(name));

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
};
/** The image types the reader shows from a local file (`image_type`); null otherwise. */
export const imageType = (name: string): string | null => IMAGE_TYPES[extensionOf(name)] ?? null;

/** A folder the scan never enters: build output, dependencies, and the checkouts under `.claude/worktrees`. */
export function isSkippedFolder(segments: readonly string[]): boolean {
  const name = segments.at(-1)?.toLowerCase() ?? "";
  return SKIPPED.includes(name) || (name === "worktrees" && segments.at(-2)?.toLowerCase() === ".claude");
}

/** A data file the Library lists (`is_agent_data`): in an agent folder, or the root `.mcp.json`; never a credential store. */
export function isAgentData(segments: readonly string[]): boolean {
  const name = segments.at(-1) ?? "";
  const data = DOCUMENT_EXTENSIONS.includes(extensionOf(name) as (typeof DOCUMENT_EXTENSIONS)[number]) && !MARKDOWN.includes(extensionOf(name));
  const inAgentFolder = segments.slice(0, -1).some(part => AGENT_FOLDERS.includes(part.toLowerCase()));
  const secret = SECRETS.includes(name.toLowerCase());
  return data && !secret && (inAgentFolder || (segments.length === 1 && name.toLowerCase() === ".mcp.json"));
}

/** What an agentic-development reader cares about in a project (`is_agent_file`). */
export function isAgentFile(segments: readonly string[]): boolean {
  const name = segments.at(-1)?.toLowerCase() ?? "";
  const parent = segments.at(-2)?.toLowerCase() ?? "";
  const grandparent = segments.at(-3)?.toLowerCase() ?? "";
  return ["claude.md", "agents.md", "skill.md", "memory.md", "human_todo.md", "action_items.md", "orchestrator.md"].includes(name)
    || (parent === "agents" && grandparent === ".claude") || parent === "memory";
}

/** The scan lists Markdown files and agent data files (`scan`). */
export const isScanned = (segments: readonly string[]): boolean => isMarkdownName(segments.at(-1) ?? "") || isAgentData(segments);

/** A template is a Markdown file directly inside the project's `templates/` folder (`template_project`). */
export const isTemplate = (segments: readonly string[]): boolean =>
  segments.length === 2 && segments[0]!.toLowerCase() === "templates" && isMarkdownName(segments[1]!);
