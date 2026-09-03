/**
 * Resolve the source revision a production build should name in `dist/SOURCE.txt`.
 *
 * Three cases, in priority order:
 *
 *  1. A trusted deployment SHA in the environment (`CF_PAGES_COMMIT_SHA` on Cloudflare
 *     Pages, `GITHUB_SHA` in Actions). Used verbatim; no Git call is made.
 *  2. A Git working tree. The tree must be clean, otherwise labelling the build with
 *     `HEAD` would name source that is not what was built.
 *  3. No Git metadata at all — the source came from a GitHub ZIP or `git archive`, so
 *     there is no `.git` directory (and `git` may not even be installed). This is a
 *     supported way to build a GPL-licensed project from source, so it must produce a
 *     build, not an exception. The caller gets `null` and labels the distribution as an
 *     unidentified source archive.
 *
 * `runGit` is injected so this is testable without a filesystem or a real Git.
 */

/**
 * @param {object} params
 * @param {Record<string, string | undefined>} params.env
 * @param {(args: string[]) => string} params.runGit  Runs `git <args>`; throws if Git is
 *   unavailable or the directory is not a repository.
 * @returns {string | null} The revision, or `null` when there is no Git metadata.
 */
export function resolveBuildRevision({ env, runGit }) {
  const deploymentRevision = env.CF_PAGES_COMMIT_SHA ?? env.GITHUB_SHA;
  if (deploymentRevision) return deploymentRevision;

  let dirtyPaths;
  try {
    dirtyPaths = runGit(["status", "--porcelain"]).trim();
  } catch {
    // No `.git`, or no `git` binary. Distinguishable from a dirty tree: that case
    // returns output, this one cannot answer the question at all.
    return null;
  }

  if (dirtyPaths) {
    throw new Error(
      "Refusing to label a dirty local build with HEAD. Commit the source or supply a trusted deployment SHA.",
    );
  }

  return runGit(["rev-parse", "HEAD"]).trim();
}

/**
 * The `dist/SOURCE.txt` body for a resolved revision (or the lack of one).
 *
 * @param {string | null} revision
 * @returns {string}
 */
export function sourceNotice(revision) {
  const locator =
    revision === null
      ? [
          "https://github.com/Chris0Jeky/MDviewer",
          "",
          "This build was produced from a source archive with no Git metadata, so it",
          "cannot name its exact revision. The corresponding source is the archive it",
          "was built from.",
        ]
      : [`https://github.com/Chris0Jeky/MDviewer/tree/${revision}`];

  return [
    "Corresponding source for this MDviewer build:",
    ...locator,
    "",
    "The owner-authored application is licensed under GPL-3.0-only.",
    "See LICENSE.txt in this distribution.",
    "",
  ].join("\n");
}
