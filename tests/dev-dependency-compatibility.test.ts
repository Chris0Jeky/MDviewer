// @vitest-environment node
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readdir, rmSync, symlinkSync, writeFileSync,
  type Dirent, type PathLike,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const consumerRequire = (name: string) => createRequire(require.resolve(name));
const eslintRequire = consumerRequire("eslint");
const configRequire = consumerRequire("@eslint/config-array");
const estreeRequire = consumerRequire("@typescript-eslint/typescript-estree");
const workboxRequire = consumerRequire("workbox-build");
const globRequire = createRequire(workboxRequire.resolve("glob"));
const { ESLint } = require("eslint") as typeof import("eslint");
const { ConfigArray } = require("@eslint/config-array") as typeof import("@eslint/config-array");
const { getManifest } = require("workbox-build") as typeof import("workbox-build");
const { glob } = workboxRequire("glob") as typeof import("glob");

async function withFixture(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "mdviewer glob é [fixture]-"));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root: string, name: string, text = "var answer = 42;\n"): void {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

for (const [name, resolve] of [
  ["ESLint", eslintRequire],
  ["config-array", configRequire],
  ["typescript-estree", estreeRequire],
  ["Workbox's glob", globRequire],
] as const) {
  it(name + " bounds globstar preprocessing through its installed minimatch", () => {
    const { Minimatch } = resolve("minimatch") as typeof import("minimatch");
    // Small enough to stay safe on the vulnerable release: six independent
    // **/.. expansions produce 64 rows when the explicit budget is ignored.
    const pattern = Array.from({ length: 6 }, (_, index) =>
      "p" + index + "/**/../q" + index + "/").join("") + "a/b.js";
    const matcher = new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 8 });
    expect(matcher.globParts.length).toBeLessThanOrEqual(8);
    const ordinary = new Minimatch("assets/**/*.{js,css}", { optimizationLevel: 2 });
    expect(ordinary.match("assets/deep/app.js")).toBe(true);
    expect(ordinary.match("assets/app.css")).toBe(true);
    expect(ordinary.match("assets/app.wasm")).toBe(false);
  });
}

it("keeps ESLint file discovery and applied rules across braces, dots, Unicode and ignores", async () => {
  await withFixture(async root => {
    const included = [
      "src/root.js", "src/deep/item.ts", "src/.hidden.js", "src/é file.ts",
      "tests/a.spec.ts", "tests/sub/b.spec.ts",
    ];
    for (const name of [...included, "src/skip.js", "src/ignored/a.js", "generated/a.js"]) {
      write(root, name);
    }
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        { ignores: ["generated/**", "**/skip.js", "**/ignored/**"] },
        { files: ["src/**/*.{js,ts}"], rules: { "no-var": "error" } },
        { files: ["tests/**/*.ts"], rules: { "no-var": "error" } },
      ],
    });
    const results = await eslint.lintFiles(["src/**/*.{js,ts}", "tests/**/*.ts"]);
    expect(results.map(result => relative(root, result.filePath).split(sep).join("/")).sort())
      .toEqual([...included].sort());
    for (const result of results) {
      expect(result.messages.map(({ ruleId, severity }) => ({ ruleId, severity })))
        .toEqual([{ ruleId: "no-var", severity: 2 }]);
    }
    expect(await eslint.isPathIgnored(join(root, "generated/a.js"))).toBe(true);
  });
});

it("keeps config-array's negated ignore and nested/dotfile matching behavior", async () => {
  await withFixture(root => {
    const config = new ConfigArray([{
      name: "negative ignore control",
      files: ["src/**/*.ts"],
      ignores: ["**/*.gen.ts", "!**/keep.gen.ts"],
    }], { basePath: root });
    config.normalizeSync();
    for (const name of ["src/a.ts", "src/deep/a.ts", "src/.hidden.ts", "src/keep.gen.ts"]) {
      expect(config.getConfigStatus(join(root, name))).toBe("matched");
    }
    for (const name of ["src/a.gen.ts", "tests/a.ts"]) {
      expect(config.getConfigStatus(join(root, name))).toBe("unconfigured");
    }
  });
});

it("keeps Workbox's actual precache contents, exclusions, revisions and directory-link semantics", async () => {
  await withFixture(async root => {
    const output = join(root, "output");
    const included = [
      "index.html", "assets/app.js", "assets/app.css", "assets/font.woff2",
      "icons/icon.png", "icons/logo.svg",
    ];
    for (const name of [
      ...included, "assets/font.woff", "assets/app.js.map", "assets/.hidden.js", "ignored/skip.js",
    ]) write(output, name);
    const linked = join(root, "linked source");
    write(linked, "dependency.js");
    // Junctions work without elevated symlink privileges on Windows; Node treats
    // this as a directory symlink on POSIX. Both targets belong to this fixture.
    symlinkSync(linked, join(output, "linked"), "junction");
    const options = {
      globDirectory: output,
      globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      globIgnores: ["ignored/**"],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    };
    const followed = await getManifest({ ...options, globFollow: true });
    const unfollowed = await getManifest({ ...options, globFollow: false });
    expect(followed.warnings).toEqual([]);
    expect(unfollowed.warnings).toEqual([]);
    expect(followed.manifestEntries.map(entry => entry.url).sort())
      .toEqual([...included, "linked/dependency.js"].sort());
    expect(unfollowed.manifestEntries.map(entry => entry.url).sort()).toEqual([...included].sort());
    expect(followed.manifestEntries.find(entry => entry.url === "assets/app.js")?.revision)
      .toBe(createHash("md5").update("var answer = 42;\n").digest("hex"));
  });
});

it("stops Workbox's installed glob from starting more directory reads after cancellation", async () => {
  await withFixture(async root => {
    write(root, "a/deep/first.js");
    write(root, "b/deep/second.js");
    expect((await glob("**/*.js", { cwd: root })).sort())
      .toEqual(["a/deep/first.js", "b/deep/second.js"]);
    const controller = new AbortController();
    const reason = new Error("bounded traversal canceled");
    let reads = 0;
    let pendingReads = 0;
    let onDrained: (() => void) | undefined;
    const trackedReaddir = ((
      directory: PathLike,
      options: { withFileTypes: true },
      callback: (error: NodeJS.ErrnoException | null, entries: Dirent[]) => void,
    ) => {
      reads += 1;
      pendingReads += 1;
      readdir(directory, options, (error, entries) => {
        if (reads === 1) controller.abort(reason);
        try {
          callback(error, entries);
        } finally {
          pendingReads -= 1;
          if (pendingReads === 0) onDrained?.();
        }
      });
    }) as typeof readdir;
    await expect(glob("**/*.js", {
      cwd: root,
      signal: controller.signal,
      fs: { readdir: trackedReaddir },
    })).rejects.toBe(reason);
    if (pendingReads > 0) {
      await new Promise<void>(resolve => { onDrained = resolve; });
    }
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(reads).toBe(1);
  });
});
