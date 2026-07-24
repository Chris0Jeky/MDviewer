import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const SECURITY_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function usage() {
  return `Usage: npm run serve -- [--host HOST] [--port PORT] [--open]

Serve the production build in dist/. The default is private to this machine:
  --host 127.0.0.1  Bind address (use 0.0.0.0 only for LAN/tunnel access)
  --port 4173       TCP port
  --open            Open the local URL in the default browser`;
}

export function parseArgs(args) {
  const options = { host: "127.0.0.1", port: 4173, open: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--host") options.host = args[++index];
    else if (argument === "--port") options.port = Number(args[++index]);
    else if (argument === "--open") options.open = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }

  if (!options.host) throw new Error("--host requires a value");
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("--port must be an integer between 0 and 65535");
  }
  return options;
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function resolveRequestPath(root, rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, "http://localhost").pathname);
  } catch {
    return null;
  }

  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  const candidate = resolve(root, relative || "index.html");
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(rootPrefix) ? candidate : null;
}

async function existingFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function createStaticServer({ root }) {
  const resolvedRoot = resolve(root);

  return createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
      return;
    }

    const requested = resolveRequestPath(resolvedRoot, req.url ?? "/");
    if (!requested) {
      send(res, 400, "Bad Request\n");
      return;
    }

    let filePath = requested;
    if (!(await existingFile(filePath))) {
      // Vite is a single-page app. Only extensionless routes fall back to index;
      // missing assets must stay 404 so deployment mistakes remain visible.
      if (extname(filePath)) {
        send(res, 404, "Not Found\n");
        return;
      }
      filePath = join(resolvedRoot, "index.html");
    }

    if (!(await existingFile(filePath))) {
      send(res, 404, "Production build not found. Run npm run build first.\n");
      return;
    }

    const metadata = await stat(filePath);
    const extension = extname(filePath).toLowerCase();
    const immutable = filePath.includes(`${sep}assets${sep}`) && /-[\w-]{8,}\./.test(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "Content-Length": metadata.size,
      "Content-Type": MIME_TYPES.get(extension) ?? "application/octet-stream",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(filePath).pipe(res);
  });
}

function openBrowser(url) {
  const command = process.platform === "win32"
    ? ["cmd.exe", ["/d", "/s", "/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
  child.unref();
}

export async function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const root = join(repoRoot, "dist");
  try {
    await access(join(root, "index.html"));
  } catch {
    console.error("Production build not found. Run npm run build first.");
    process.exitCode = 1;
    return;
  }

  const server = createStaticServer({ root });
  server.on("error", (error) => {
    console.error(`Could not start MDviewer: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : options.port;
    const browserHost = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
    const url = `http://${browserHost}:${port}`;
    console.log(`MDviewer is running at ${url}`);
    if (options.host !== "127.0.0.1" && options.host !== "::1" && options.host !== "localhost") {
      console.log("This server is reachable beyond this machine. Prefer a private Tailscale Serve endpoint.");
    }
    if (options.open) openBrowser(url);
  });
  return server;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
