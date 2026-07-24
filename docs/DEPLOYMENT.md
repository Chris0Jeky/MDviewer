# Running and deploying MDviewer

MDviewer is a static, client-side application. Hosting serves the application code, fonts, and
syntax grammars; Markdown documents and generated PDFs stay in the visitor's browser. There is no
conversion backend, database, telemetry, or runtime network API.

## Recommended paths

| Need | Best fit | Cost | Important tradeoff |
| --- | --- | --- | --- |
| Permanent public URL | Cloudflare Pages | Free tier is ample | Anyone with the URL can load the app |
| Private access from your devices | Tailscale Serve | Free Personal plan | This PC and the local server must stay running |
| Temporary public demo | Cloudflare Quick Tunnel | Free | Random URL; development-only, no uptime guarantee |
| Stable authenticated self-hosting | Named Cloudflare Tunnel + Access | Free tier may fit | Requires Cloudflare account/domain configuration |
| Same LAN only | Built-in server on `0.0.0.0` | Free | Plain HTTP; may require a Windows Firewall rule |

The best default is **Cloudflare Pages**. MDviewer does not need a server process, so static hosting
is cheaper, more available, and simpler than keeping this PC online. Use **Tailscale Serve** when the
URL should remain private or when you specifically want this machine to be the host.

## Live production deployment

- Stable URL: **https://mdviewer-c9r.pages.dev/**
- Cloudflare Pages project: `mdviewer`
- Production branch: `main`
- First production deployment: `e3bd9770` from merge commit `7f4eedf`
- Immutable deployment URL: **https://e3bd9770.mdviewer-c9r.pages.dev/**
- Last operator verification: 2026-07-24 — stable/immutable URLs, entry title, hashed asset,
  immutable asset caching, and committed security headers passed smoke checks

The current project uses Wrangler direct upload. To publish a new verified `main` build from an
authenticated maintainer machine:

```powershell
npm run build
npm exec --yes wrangler@latest -- pages deploy dist --project-name mdviewer --branch main
```

Direct upload does not automatically deploy later Git pushes. Connect the Pages project to GitHub in
the Cloudflare dashboard if automatic production and pull-request preview deployments become useful.
Confirm what is actually live rather than inferring it from GitHub:

```powershell
npm exec --yes wrangler@latest -- pages deployment list --project-name mdviewer --json
```

After a deployment, smoke both the stable and immutable URLs, inspect the entry title and hashed
asset response, and confirm the `_headers` policy. Do not record Wrangler tokens or Cloudflare account
identifiers in the repository.

## One command or one click on this PC

Install Node.js once, clone the repository, then run:

```powershell
npm install
npm start
```

`npm start` makes a fresh production build, serves it at `http://127.0.0.1:4173`, and opens the
default browser. On Windows, double-click **Start MDviewer.cmd** for the same result. The server binds
to loopback by default, so other machines cannot reach it accidentally.

To serve an already-built `dist/` without rebuilding:

```powershell
npm run serve
```

Options are available after `--`, for example `npm run serve -- --port 8080 --open`. Stop the server
with Ctrl+C or by closing its terminal.

## Permanent public URL: Cloudflare Pages with optional Git integration

Cloudflare's Vite guide uses exactly this repository's build contract: `npm run build` and output
directory `dist`. A Git-connected Pages project can rebuild after pushes. The current `mdviewer`
project was created by Wrangler direct upload and does not yet have that automatic behavior.

1. Push the branch you want to publish to GitHub.
2. In Cloudflare: **Workers & Pages → Create application → Pages → Import an existing Git repository**.
3. Select this repository and set:
   - Production branch: `main`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: `22` (set `NODE_VERSION=22` if the build UI does not infer it)
4. Deploy, test the `*.pages.dev` URL, and optionally attach a custom domain.

The free-plan limits currently include 500 builds/month, 20,000 files, and 25 MiB per file. The
MDviewer build is comfortably below those file-count and per-file limits. The committed `_headers`
file supplies baseline browser security and long-lived caching for hashed assets. Production source
maps are disabled; set `SOURCE_MAPS=true` only for a deliberate debugging build.

Official references: [Cloudflare Pages Vite deployment](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/)
and [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

## Private access from anywhere: Tailscale Serve

Install Tailscale on this PC and each device that should access MDviewer, sign them into the same
tailnet, then use two terminals:

```powershell
# Terminal 1
npm start

# Terminal 2
tailscale serve --bg 4173
tailscale serve status
```

Tailscale supplies an HTTPS URL and proxies it to the loopback-only MDviewer server. Its Personal
plan currently permits six free users. The app is reachable only according to the tailnet's access
rules; it is not placed on the public Internet.

To remove the endpoint:

```powershell
tailscale serve reset
```

Official references: [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) and
[free Personal plan](https://tailscale.com/docs/account/manage-plans/free-plans-discounts).

## Temporary public link from this PC: Cloudflare Quick Tunnel

Install `cloudflared`, start MDviewer, then open a second terminal:

```powershell
# Terminal 1
npm start

# Terminal 2
cloudflared tunnel --url http://localhost:4173
```

The second command prints a random `trycloudflare.com` URL. Anyone with it can load the application,
so treat it as public and stop `cloudflared` after the demo. Cloudflare explicitly describes Quick
Tunnels as testing/development only, with no uptime guarantee and a 200 in-flight-request limit.

Official reference: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

For a stable URL hosted by this PC, create a named Cloudflare Tunnel and put Cloudflare Access in
front of it. Access acts as an identity-aware proxy and can require email one-time PIN or an identity
provider before forwarding a request. See [Cloudflare Access for self-hosted apps](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/).

## Same-network access

```powershell
npm start -- --host 0.0.0.0 --port 4173
```

Then visit `http://<this-pc-ip>:4173` from the other device. This deliberately exposes the server on
the local network and uses unencrypted HTTP. Prefer Tailscale for regular use; do not forward this
port from the router to the Internet.

## What “called remotely” means today

The remote product is the browser application: open its URL, load Markdown locally, and export the
PDF locally. There is intentionally no HTTP endpoint such as `POST /convert`, because implementing
one would upload documents to a browser-automation worker and change the privacy, security, cost,
font, and pagination model. If automation becomes a requirement, build it as a separately named
service with authentication, upload limits, isolated Chromium jobs, cleanup guarantees, and explicit
privacy language rather than silently turning this local-first app into a document-processing server.
