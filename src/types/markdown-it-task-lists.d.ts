// markdown-it-task-lists ships no @types on npm. Minimal ambient declaration so the
// plugin can be imported with full typing. The runtime is v2.1.1; the option surface
// below matches that release. Do not "upgrade" to a published @types — none exists.
declare module "markdown-it-task-lists" {
  import type { PluginWithOptions } from "markdown-it";
  const taskLists: PluginWithOptions<{
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }>;
  export default taskLists;
}
