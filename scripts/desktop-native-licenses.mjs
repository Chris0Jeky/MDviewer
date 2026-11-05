import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const target = "x86_64-pc-windows-msvc";
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const digest = (data) => createHash("sha256").update(data).digest("hex");
const noticeName = /^(licen[cs]es?|copying|notices?)([-_.]|$)/i;

// `packages` also contains other targets. Only `resolve` is filtered by Cargo.
// Keep normal and build dependencies, including proc macros, conservatively.
export function resolvedPackages(metadata) {
  if (!metadata.resolve) throw new Error("Cargo did not return a resolved graph.");
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const workspace = new Set(metadata.workspace_members);
  const stack = metadata.resolve.root
    ? [metadata.resolve.root]
    : [...metadata.workspace_default_members];
  const visited = new Set();
  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id);
    if (!node) throw new Error("Cargo returned an incomplete dependency graph.");
    for (const dependency of node.deps) {
      if (dependency.dep_kinds.some(({ kind }) => kind !== "dev")) {
        stack.push(dependency.pkg);
      }
    }
  }
  return metadata.packages
    .filter(({ id }) => visited.has(id) && !workspace.has(id))
    .sort((a, b) => compare(`${a.name}@${a.version}`, `${b.name}@${b.version}`));
}

function within(root, path) {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

// Include nested licenses/ and vendor notices, not only root-level LICENSE files.
export function noticeFiles(packageRoot, declaredFile = null) {
  const root = realpathSync(packageRoot);
  const files = new Map();
  function add(path) {
    const actual = realpathSync(path);
    if (!within(root, actual)) throw new Error("A license file escapes its crate.");
    if (!lstatSync(actual).isFile()) throw new Error("A license path is not a file.");
    const body = readFileSync(actual);
    if (body.includes(0)) throw new Error("A license file contains binary data.");
    files.set(relative(root, path).split(sep).join("/"), body.toString("utf8"));
  }
  function visit(directory, inNoticeDirectory = false) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if ([".git", "target", "node_modules"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      const isNotice = noticeName.test(entry.name);
      if (entry.isDirectory()) visit(path, inNoticeDirectory || isNotice);
      else if ((entry.isFile() || entry.isSymbolicLink()) && (inNoticeDirectory || isNotice)) {
        add(path);
      }
    }
  }
  visit(root);
  if (declaredFile) add(resolve(root, declaredFile));
  return [...files.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([name, text]) => ({ name, text }));
}

export function fallbackNotices(pkg, packageRoot, fallbackRoot, provenance) {
  const entries = provenance.filter((item) => item.package === `${pkg.name}-${pkg.version}`);
  if (entries.length === 0) return [];
  const vcs = JSON.parse(readFileSync(join(packageRoot, ".cargo_vcs_info.json"), "utf8"));
  return entries.map((entry) => {
    if (vcs.git?.sha1 !== entry.revision) {
      throw new Error(`License provenance revision mismatch: ${pkg.name}@${pkg.version}`);
    }
    if (entry.verify_package_file) {
      const included = realpathSync(join(packageRoot, entry.verify_package_file));
      if (!within(realpathSync(packageRoot), included)
          || digest(readFileSync(included)) !== entry.verify_package_sha256) {
        throw new Error(`Bundled native library checksum mismatch: ${pkg.name}@${pkg.version}`);
      }
    }
    const path = realpathSync(join(fallbackRoot, entry.file));
    if (!within(realpathSync(fallbackRoot), path)) throw new Error("Invalid license fallback path.");
    const body = readFileSync(path);
    if (digest(body) !== entry.sha256) throw new Error(`License checksum mismatch: ${entry.file}`);
    return {
      name: entry.file,
      text: [
        `Upstream license source: ${entry.url}`,
        `Package source revision: ${entry.revision}`,
        entry.archive_member ? `Archive member: ${entry.archive_member}` : "",
        entry.declaration_url ? `License declaration: ${entry.declaration_url}` : "",
        entry.reason ?? "The published crate omits this upstream license file.",
        `SHA-256: ${entry.sha256}`,
        "",
        body.toString("utf8"),
      ].filter((line) => line !== "").join("\n"),
    };
  });
}

export function generateNotices(metadata, { lockBytes, fallbackRoot, provenance }) {
  const packages = resolvedPackages(metadata);
  const sections = packages.map((pkg) => {
    const packageRoot = dirname(pkg.manifest_path);
    const texts = [
      ...noticeFiles(packageRoot, pkg.license_file),
      ...fallbackNotices(pkg, packageRoot, fallbackRoot, provenance),
    ];
    if (texts.length === 0) {
      throw new Error(`No license text found for ${pkg.name}@${pkg.version}; add a revision-pinned fallback.`);
    }
    const registry = pkg.source?.startsWith("registry+") || pkg.source?.startsWith("sparse+");
    const source = registry
      ? `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`
      : pkg.repository ?? pkg.homepage;
    if (!source) throw new Error(`No source URL found for ${pkg.name}@${pkg.version}.`);
    return [
      `## ${pkg.name}@${pkg.version}`,
      `Declared license: ${pkg.license ?? "See the license text below"}`,
      `Source: ${source}`,
      pkg.repository ? `Repository: ${pkg.repository}` : "",
      ...texts.map(({ name, text }) => `--- ${name} ---\n${text.replace(/\r\n/g, "\n").trim()}`),
    ].filter(Boolean).join("\n\n");
  });
  return {
    packageCount: packages.length,
    text: [
      "MDviewer Desktop — native third-party notices",
      `Target: ${target}`,
      `Cargo.lock SHA-256: ${digest(lockBytes)}`,
      `Dependency packages: ${packages.length}`,
      "",
      "Generated from cargo metadata --locked --filter-platform and the corresponding crate sources.",
      "Includes normal and build dependencies conservatively; dev-only and other-target edges are excluded.",
      "License files, COPYING and NOTICE texts are included recursively, including vendored license directories.",
      "Missing crate license files use checked-in upstream texts, verified by source revision and SHA-256.",
      "Source archive links identify the exact, unmodified dependency versions used to build this application.",
      "The separately installed Microsoft WebView2 Runtime is provided and updated by Microsoft.",
      "",
      ...sections,
      "",
    ].join("\n\n"),
  };
}

function main() {
  const args = process.argv.slice(2);
  let manifest = join(repoRoot, "src-tauri", "Cargo.toml");
  let output = join(repoRoot, "dist-desktop", "NATIVE_THIRD_PARTY_NOTICES.txt");
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1];
    if (!value) throw new Error("Expected --manifest-path PATH or --out PATH.");
    if (args[index] === "--manifest-path") manifest = resolve(value);
    else if (args[index] === "--out") output = resolve(value);
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  const lockPath = join(dirname(manifest), "Cargo.lock");
  if (!existsSync(lockPath)) throw new Error("A checked-in native Cargo.lock is required.");
  const lockBytes = readFileSync(lockPath);
  const metadata = JSON.parse(execFileSync("cargo", [
    "metadata", "--locked", "--format-version=1", "--filter-platform", target,
    "--manifest-path", manifest,
  ], {
    cwd: dirname(manifest), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    timeout: 180_000, stdio: ["ignore", "pipe", "pipe"],
  }));
  const fallbackRoot = join(repoRoot, "desktop", "licenses");
  const provenance = JSON.parse(readFileSync(join(fallbackRoot, "provenance.json"), "utf8"));
  const result = generateNotices(metadata, { lockBytes, fallbackRoot, provenance });
  const toolchain = readFileSync(join(dirname(manifest), "rust-toolchain.toml"), "utf8");
  const pinnedRust = toolchain.match(/^\s*channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m)?.[1];
  if (!pinnedRust) throw new Error("An exact Rust version must be pinned in rust-toolchain.toml.");
  const rustc = process.env.RUSTC ?? "rustc";
  const rustOptions = {
    cwd: dirname(manifest), encoding: "utf8", timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  };
  const rustVersion = execFileSync(rustc, ["--version"], rustOptions).trim();
  if (!rustVersion.startsWith(`rustc ${pinnedRust} `)) {
    throw new Error(`The notice generator requires the pinned Rust ${pinnedRust} toolchain.`);
  }
  const sysroot = execFileSync(rustc, ["--print", "sysroot"], rustOptions).trim();
  const stdlibPath = join(sysroot, "share", "doc", "rust", "COPYRIGHT-library.html");
  if (!existsSync(stdlibPath)) {
    throw new Error("The pinned Rust toolchain's COPYRIGHT-library.html is unavailable.");
  }
  const stdlibBytes = readFileSync(stdlibPath);
  if (stdlibBytes.length === 0) throw new Error("The Rust standard-library notice file is empty.");
  const noticeText = `${result.text}\n## Rust standard library\n\n${rustVersion}\n`
    + `Source: https://github.com/rust-lang/rust/tree/${pinnedRust}/library\n`
    + "Full shipped standard-library notices: RUST_STDLIB_NOTICES.html\n"
    + `Notice SHA-256: ${digest(stdlibBytes)}\n`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, noticeText, "utf8");
  writeFileSync(join(dirname(output), "RUST_STDLIB_NOTICES.html"), stdlibBytes);
  process.stdout.write(`Native notices: ${result.packageCount} packages; ${Buffer.byteLength(noticeText)} bytes; Rust ${pinnedRust} standard-library notices included.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    process.stderr.write(`Native notice generation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
