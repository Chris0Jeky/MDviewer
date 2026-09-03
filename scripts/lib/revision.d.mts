// Hand-written declarations for revision.mjs. The build scripts are plain Node ESM (they
// run under `node` directly, with no compile step), so the types live beside them rather
// than in the source they describe.

export declare function resolveBuildRevision(params: {
  env: Record<string, string | undefined>;
  /** Runs `git <args>`; throws if Git is unavailable or this is not a repository. */
  runGit: (args: string[]) => string;
}): string | null;

export declare function sourceNotice(revision: string | null): string;
