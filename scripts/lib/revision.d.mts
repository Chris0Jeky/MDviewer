// Hand-written declarations for revision.mjs. The build scripts are plain Node ESM (they
// run under `node` directly, with no compile step), so the types live beside them rather
// than in the source they describe.

export declare function resolveBuildRevision(params: {
  env: Record<string, string | undefined>;
  /** Whether this tree is a Git repository at all, decided without running Git. */
  hasGitMetadata: () => boolean;
  /** Runs `git <args>`; throws if Git is unavailable or refuses to answer. */
  runGit: (args: string[]) => string;
}): string | null;

export declare function gitMetadataProbe(
  gitPath: string,
  statPath: (path: string) => unknown,
): () => boolean;

export declare function sourceNotice(revision: string | null): string;
