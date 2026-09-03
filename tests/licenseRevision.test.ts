import { describe, it, expect } from "vitest";
import { resolveBuildRevision, sourceNotice } from "../scripts/lib/revision.mjs";

/** A `runGit` that fails the way a source archive (no `.git`, or no `git` binary) fails. */
function noGit(): (args: string[]) => string {
  return () => {
    throw new Error("fatal: not a git repository (or any of the parent directories): .git");
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
      runGit: fakeGit({}, calls),
    });
    expect(revision).toBe("cf00ffee");
    expect(calls).toEqual([]);
  });

  it("falls back to GITHUB_SHA", () => {
    const revision = resolveBuildRevision({
      env: { GITHUB_SHA: "gh12345" },
      runGit: fakeGit({}),
    });
    expect(revision).toBe("gh12345");
  });

  it("uses HEAD when the working tree is clean", () => {
    const revision = resolveBuildRevision({
      env: {},
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
        runGit: fakeGit({ "status --porcelain": " M src/main.ts\n" }),
      }),
    ).toThrow(/dirty local build/i);
  });

  // The regression this file exists for: a GitHub ZIP or `git archive` has no `.git`, so
  // the documented `npm run build` used to die after Vite had already written dist/.
  it("reports no revision instead of throwing when there is no git metadata", () => {
    expect(resolveBuildRevision({ env: {}, runGit: noGit() })).toBeNull();
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
