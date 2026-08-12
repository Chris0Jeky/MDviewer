import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

const deploymentRevision = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA;
if (!deploymentRevision) {
  const dirtyPaths = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (dirtyPaths) {
    throw new Error(
      "Refusing to label a dirty local build with HEAD. Commit the source or supply a trusted deployment SHA.",
    );
  }
}
const revision =
  deploymentRevision ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();

writeFileSync(
  join(outDir, "SOURCE.txt"),
  [
    "Corresponding source for this MDviewer build:",
    `https://github.com/Chris0Jeky/MDviewer/tree/${revision}`,
    "",
    "The owner-authored application is licensed under GPL-3.0-only.",
    "See LICENSE.txt in this distribution.",
    "",
  ].join("\n"),
);

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
