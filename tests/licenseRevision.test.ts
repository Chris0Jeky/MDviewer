import { describe, it, expect } from "vitest";
import { resolveBuildRevision, sourceNotice } from "../scripts/lib/revision.mjs";

/** A `runGit` that must never be reached; reaching it is the failure. */
function unreachableGit(): (args: string[]) => string {
  return (args) => {
    throw new Error(`git must not run here, but was asked for: git ${args.join(" ")}`);
  };
}

/** A `runGit` backed by canned output, recording the argv it was asked for. */
function fakeGit(responses: Record<string, string>, calls: string[][] = []) {
  return (args: string[]): string => {
    calls.push(args);
    const key = args.join(" ");
    const value = responses[key];
    if (value === undefined) throw new Error(`unexpected git invocation: git ${key}`);
    return value;
  };
}

describe("resolveBuildRevision", () => {
  it("prefers a Cloudflare Pages deployment SHA and never touches git", () => {
    const calls: string[][] = [];
    const revision = resolveBuildRevision({
      env: { CF_PAGES_COMMIT_SHA: "cf00ffee" },
      hasGitMetadata: () => {
        throw new Error("the filesystem must not be consulted for a deployment SHA");
      },
      runGit: fakeGit({}, calls),
    });
    expect(revision).toBe("cf00ffee");
    expect(calls).toEqual([]);
  });

  it("falls back to GITHUB_SHA", () => {
    const revision = resolveBuildRevision({
      env: { GITHUB_SHA: "gh12345" },
      hasGitMetadata: () => true,
      runGit: fakeGit({}),
    });
    expect(revision).toBe("gh12345");
  });

  it("uses HEAD when the working tree is clean", () => {
    const revision = resolveBuildRevision({
      env: {},
      hasGitMetadata: () => true,
      runGit: fakeGit({
        "status --porcelain": "\n",
        "rev-parse HEAD": "abc123\n",
      }),
    });
    expect(revision).toBe("abc123");
  });

  it("still refuses to label a dirty local build with HEAD", () => {
    expect(() =>
      resolveBuildRevision({
        env: {},
        hasGitMetadata: () => true,
        runGit: fakeGit({ "status --porcelain": " M src/main.ts\n" }),
      }),
    ).toThrow(/dirty local build/i);
  });

  // The regression this file exists for: a GitHub ZIP or `git archive` has no `.git`, so
  // the documented `npm run build` used to die after Vite had already written dist/.
  it("reports no revision instead of throwing when there is no git metadata", () => {
    expect(
      resolveBuildRevision({
        env: {},
        hasGitMetadata: () => false,
        runGit: unreachableGit(),
      }),
    ).toBeNull();
  });

  // The counterpart, and the reason the archive case is decided from the filesystem
  // instead of from a failing git call: in a real repository a git failure proves nothing
  // about the tree, so it must not be downgraded to "anonymous archive" — that would ship
  // a dirty build mislabelled with an archive notice.
  it.each([
    ["dubious ownership", "fatal: detected dubious ownership in repository at '/src'"],
    ["no git binary on PATH", "spawnSync git ENOENT"],
    ["porcelain output past maxBuffer", "spawnSync /usr/bin/git ENOBUFS"],
  ])("rethrows when git fails for a non-metadata reason (%s)", (_name, message) => {
    expect(() =>
      resolveBuildRevision({
        env: {},
        hasGitMetadata: () => true,
        runGit: () => {
          throw new Error(message);
        },
      }),
    ).toThrow(message);
  });
});

describe("sourceNotice", () => {
  it("links the exact tree for a known revision", () => {
    const text = sourceNotice("abc123");
    expect(text).toContain("https://github.com/Chris0Jeky/MDviewer/tree/abc123");
    expect(text).toContain("GPL-3.0-only");
  });

  it("names the archive explicitly when the revision is unknown", () => {
    const text = sourceNotice(null);
    expect(text).not.toContain("/tree/");
    expect(text).toContain("https://github.com/Chris0Jeky/MDviewer");
    expect(text).toMatch(/source archive with no Git metadata/i);
    expect(text).toContain("GPL-3.0-only");
  });
});
