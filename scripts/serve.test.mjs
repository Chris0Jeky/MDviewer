import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createStaticServer, formatBrowserHost, parseArgs } from "./serve.mjs";

let root;
let server;
let baseURL;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "mdviewer-serve-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html><h1>MDviewer</h1>");
  await writeFile(join(root, "assets", "app-12345678.js"), "console.log('ok')");
  server = createStaticServer({ root });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseURL = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

test("parses safe local defaults and explicit exposure options", () => {
  assert.deepEqual(parseArgs([]), { host: "127.0.0.1", port: 4173, open: false });
  assert.deepEqual(parseArgs(["--host", "0.0.0.0", "--port", "8080", "--open"]), {
    host: "0.0.0.0",
    port: 8080,
    open: true,
  });
  assert.throws(() => parseArgs(["--port", "not-a-port"]), /--port must be/);
  assert.equal(formatBrowserHost("::1"), "[::1]");
  assert.equal(formatBrowserHost("localhost"), "localhost");
});

test("serves the app with security and cache headers", async () => {
  const response = await fetch(baseURL);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /MDviewer/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-cache");

  const asset = await fetch(`${baseURL}/assets/app-12345678.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control"), /immutable/);
});

test("supports SPA routes but does not hide missing assets", async () => {
  assert.equal((await fetch(`${baseURL}/settings`)).status, 200);
  assert.equal((await fetch(`${baseURL}/missing.js`)).status, 404);
  assert.equal((await fetch(baseURL, { method: "POST" })).status, 405);
});
