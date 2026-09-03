import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gitMetadataProbe, resolveBuildRevision, sourceNotice } from "./lib/revision.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
const outDir = join(repoRoot, "dist");

if (!existsSync(outDir)) {
  throw new Error("dist/ does not exist; run this script after the Vite build");
}

copyFileSync(join(repoRoot, "LICENSE"), join(outDir, "LICENSE.txt"));
copyFileSync(
  join(repoRoot, "THIRD_PARTY_NOTICES.md"),
  join(outDir, "THIRD_PARTY_NOTICES.md"),
);

// Building from a GitHub ZIP or `git archive` is a supported way to build a GPL-licensed
// project, and such a tree has no `.git` (and may have no `git` binary at all). That case
// is detected from the filesystem, before Git is ever spawned, so the documented
// `npm run build` still produces a distribution — labelled honestly as an archive build.
// Inside a real repository, a failing `git` command fails the build instead: it cannot
// prove the tree is clean, and a mislabelled dirty build is worse than a loud error.
const revision = resolveBuildRevision({
  env: process.env,
  // `.git` is a directory in a normal clone and a file in a worktree or submodule. The
  // probe distinguishes "not there" from "cannot be read"; only the former is an archive.
  hasGitMetadata: gitMetadataProbe(join(repoRoot, ".git"), (path) => statSync(path)),
  runGit: (args) =>
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
});

writeFileSync(join(outDir, "SOURCE.txt"), sourceNotice(revision));

const sections = [];
for (const [packagePath, metadata] of Object.entries(lock.packages ?? {}).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (!packagePath.startsWith("node_modules/")) continue;
  const packageDir = join(repoRoot, packagePath);
  if (!existsSync(packageDir)) continue;

  const packageJsonPath = join(packageDir, "package.json");
  const packageJson = existsSync(packageJsonPath)
    ? JSON.parse(readFileSync(packageJsonPath, "utf8"))
    : {};
  const name = packageJson.name ?? packagePath.replace(/^.*node_modules\//, "");
  const version = packageJson.version ?? metadata.version ?? "unknown";
  const declared = packageJson.license ?? metadata.license ?? "not declared";
  const noticeFiles = readdirSync(packageDir)
    .filter((file) => /^(licen[cs]e|copying|notice)([-_.]|$)/i.test(file))
    .sort();

  const texts = noticeFiles.map((file) => {
    const body = readFileSync(join(packageDir, file), "utf8").trim();
    return `--- ${file} ---\n${body}`;
  });
  sections.push(
    [`## ${name}@${version}`, `Declared licence: ${declared}`, ...texts, ""].join("\n\n"),
  );
}

writeFileSync(
  join(outDir, "THIRD_PARTY_LICENSES.txt"),
  [
    "Third-party licence texts for the installed MDviewer dependency tree.",
    "Generated deterministically from package-lock.json and node_modules during the build.",
    "",
    ...sections,
  ].join("\n"),
);
