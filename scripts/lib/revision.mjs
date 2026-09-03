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
 * The absence of Git metadata is the ONLY thing that may downgrade a build to case 3, and
 * it is decided before Git is invoked. A failing `git` command is never evidence of it:
 * `git status` can fail inside a perfectly real repository (no `git` on PATH, a
 * dubious-ownership refusal, output past the caller's `maxBuffer`), and each of those
 * failures leaves the dirty-tree question unanswered rather than answering it "clean".
 * Such an error propagates and fails the build loudly.
 *
 * `hasGitMetadata` and `runGit` are injected so this is testable without a filesystem or a
 * real Git.
 */

/**
 * @param {object} params
 * @param {Record<string, string | undefined>} params.env
 * @param {() => boolean} params.hasGitMetadata  Whether this tree is a Git repository at
 *   all (i.e. `.git` exists). Decided without running Git.
 * @param {(args: string[]) => string} params.runGit  Runs `git <args>`; throws if Git is
 *   unavailable or refuses to answer. Only called when `hasGitMetadata()` is true.
 * @returns {string | null} The revision, or `null` when there is no Git metadata.
 */
export function resolveBuildRevision({ env, hasGitMetadata, runGit }) {
  const deploymentRevision = env.CF_PAGES_COMMIT_SHA ?? env.GITHUB_SHA;
  if (deploymentRevision) return deploymentRevision;

  if (!hasGitMetadata()) return null;

  // Deliberately uncaught: inside a real repository, a Git failure must fail the build
  // rather than silently mislabel a possibly dirty tree as an anonymous archive.
  const dirtyPaths = runGit(["status", "--porcelain"]).trim();

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
