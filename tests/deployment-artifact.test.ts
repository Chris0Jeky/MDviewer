// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/deployment-artifact.mjs", import.meta.url));
const WORKFLOW = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SHA = "2097c21c8a07bfae5931cc9c545085571a06581b";
const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) {
  if (!resolve(path).startsWith(resolve(tmpdir()) + sep) || !basename(path).startsWith("mdviewer-deployment-")) throw new Error("Unsafe fixture cleanup path");
  rmSync(path, { recursive: true, force: true });
} });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mdviewer-deployment-")); scratch.push(root);
  const dist = join(root, "dist"), manifest = join(root, "deployment-manifest.json");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "SOURCE.txt"), `Corresponding source:\nhttps://github.com/Chris0Jeky/MDviewer/tree/${SHA}\n`);
  writeFileSync(join(dist, "index.html"), "<html>synthetic public fixture</html>");
  writeFileSync(join(dist, "assets", "app.js"), "console.log('synthetic');");
  return { root, dist, manifest };
}
function cli(mode: string, dist: string, manifest: string, sha = SHA) {
  return spawnSync(process.execPath, [SCRIPT, mode, dist, manifest, sha], { encoding: "utf8" });
}
function prepared() {
  const data = fixture();
  const result = cli("create", data.dist, data.manifest);
  expect(result.status, result.stderr).toBe(0);
  return data;
}

describe("tested deployment artifact", () => {
  it("verifies unchanged bytes after copying the artifact to another runner directory", () => {
    const { root, dist, manifest } = prepared();
    const download = join(root, "download"); cpSync(dist, download, { recursive: true });
    expect(cli("verify", download, manifest).status).toBe(0);
  });
  it.each(["modified", "missing", "extra"])("refuses %s artifact files", change => {
    const { dist, manifest } = prepared();
    if (change === "modified") writeFileSync(join(dist, "assets", "app.js"), "tampered");
    if (change === "missing") unlinkSync(join(dist, "assets", "app.js"));
    if (change === "extra") writeFileSync(join(dist, "extra.js"), "unreviewed");
    const result = cli("verify", dist, manifest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Artifact files or checksums differ");
  });
  it("refuses an artifact from another source SHA", () => {
    const { dist, manifest } = prepared();
    const result = cli("verify", dist, manifest, "0".repeat(40));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Manifest revision");
  });
  it("requires SOURCE.txt to name the exact repository revision URL", () => {
    const { dist, manifest } = fixture();
    writeFileSync(join(dist, "SOURCE.txt"), `untrusted text containing ${SHA}\n`);
    const result = cli("create", dist, manifest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SOURCE.txt does not identify");
  });
  it("refuses a modified manifest without reading paths supplied by it", () => {
    const { dist, manifest } = prepared();
    const data = JSON.parse(readFileSync(manifest, "utf8")) as { files: { path: string; sha256: string }[] };
    data.files.push({ path: "../private.txt", sha256: "0".repeat(64) });
    writeFileSync(manifest, JSON.stringify(data));
    const result = cli("verify", dist, manifest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Artifact files or checksums differ");
  });
  it("keeps the manifest outside the directory that will be uploaded to Pages", () => {
    const { dist } = fixture();
    const result = cli("create", dist, join(dist, "manifest.json"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Manifest must be outside");
  });
  it("refuses symbolic-link directories instead of traversing their targets", () => {
    const { root, dist, manifest } = fixture();
    const outside = join(root, "outside"); mkdirSync(outside);
    writeFileSync(join(outside, "synthetic.txt"), "outside upload root");
    symlinkSync(outside, join(dist, "link"), process.platform === "win32" ? "junction" : "dir");
    const result = cli("create", dist, manifest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Artifact contains a symbolic link");
  });
  it("refuses a source directory link before reading it", () => {
    const { root, dist, manifest } = fixture();
    unlinkSync(join(dist, "SOURCE.txt"));
    const outside = join(root, "outside"); mkdirSync(outside);
    symlinkSync(outside, join(dist, "SOURCE.txt"), process.platform === "win32" ? "junction" : "dir");
    const result = cli("create", dist, manifest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SOURCE.txt must be a regular file");
  });
  it("requires a full SHA instead of a short or arbitrary source label", () => {
    const { dist, manifest } = fixture();
    const result = cli("create", dist, manifest, "2097c21");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected a full Git commit SHA");
  });
});

function job(name: string) {
  const section = WORKFLOW.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-zA-Z_][\\w-]*:|$(?![\\s\\S]))`, "m"))?.[0];
  expect(section, `missing ${name} workflow job`).toBeDefined();
  return section ?? "";
}
describe("deployment workflow boundaries", () => {
  it("allows a non-main ref only for a dry build, passing refs through env", () => {
    const gate = job("e2e");
    expect(gate).toContain("if: ${{ !inputs.dry_run && github.ref != 'refs/heads/main' }}");
    expect(gate).toContain("REF: ${{ github.ref }}");
    expect(gate).not.toMatch(/run:.*\$\{\{ github\.ref \}\}/);
  });
  it("captures the manifest before E2E and verifies it before publishing the artifact", () => {
    const gate = job("e2e");
    const create = gate.indexOf("deployment-artifact.mjs create");
    const e2e = gate.indexOf("run: npm run test:e2e");
    const verify = gate.indexOf("deployment-artifact.mjs verify");
    const upload = gate.indexOf("id: tested_artifact");
    expect(create).toBeGreaterThan(0); expect(e2e).toBeGreaterThan(create);
    expect(verify).toBeGreaterThan(e2e); expect(upload).toBeGreaterThan(verify);
    expect(gate).toContain("if-no-files-found: error");
    expect(gate).toContain("artifact-id: ${{ steps.tested_artifact.outputs.artifact-id }}");
  });
  it("gives the dry path neither an environment nor Cloudflare secrets or commands", () => {
    const dry = job("dry_run");
    expect(dry).toContain("if: ${{ inputs.dry_run }}");
    expect(dry).not.toMatch(/environment:|secrets\.|wrangler|npm ci|npm run build/);
    expect(dry).toContain("deployment-artifact.mjs verify");
  });
  it("gives the live path only main, production approval and pinned direct upload of downloaded bytes", () => {
    const live = job("deploy");
    expect(live).toContain("if: ${{ !inputs.dry_run && github.ref == 'refs/heads/main' }}");
    expect(live).toContain("environment: production");
    expect(live).not.toMatch(/npm ci|npm run build/);
    expect(live).toContain("wrangler@4.114.0 -- pages deploy deployment-artifact/dist --project-name mdviewer --branch main");
    expect(live.indexOf("deployment-artifact.mjs verify")).toBeLessThan(live.indexOf("secrets.CLOUDFLARE_API_TOKEN"));
  });
  it.each(["dry_run", "deploy"])("binds %s to the producer's artifact ID in the same run", name => {
    const consumer = job(name);
    expect(consumer).toContain("needs: [e2e]");
    expect(consumer).toContain("uses: actions/download-artifact@v8");
    expect(consumer).toContain("artifact-ids: ${{ needs.e2e.outputs.artifact-id }}");
    expect(consumer).toContain("digest-mismatch: error");
    expect(consumer).not.toMatch(/github-token:|run-id:|repository:/);
  });
});
