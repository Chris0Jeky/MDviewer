// markdown-it-task-lists ships no @types on npm. Minimal ambient declaration so the
// plugin can be imported with full typing. The runtime is v2.1.1; the option surface
// below matches that release. Do not "upgrade" to a published @types — none exists.
declare module "markdown-it-task-lists" {
  import type { MarkdownIt } from "markdown-it";
  // markdown-it 15 ships its own typings and no longer exports `PluginWithOptions`, so the
  // plugin signature is spelled out here instead.
  const taskLists: (
    md: MarkdownIt,
    options?: {
      enabled?: boolean;
      label?: boolean;
      labelAfter?: boolean;
    },
  ) => void;
  export default taskLists;
}
