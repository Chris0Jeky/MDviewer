import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildRevision, sourceNotice } from "./lib/revision.mjs";

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
// project, and such a tree has no `.git` (and may have no `git` binary at all). The
// resolver reports that as `null` rather than letting the spawn throw, so the documented
// `npm run build` still produces a distribution — labelled honestly as an archive build.
const revision = resolveBuildRevision({
  env: process.env,
  // stderr is piped, not inherited: "not a git repository" is an expected, handled
  // outcome here, so it must not print an alarming line during a successful build.
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
