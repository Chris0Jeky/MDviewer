# Running and deploying MDviewer

MDviewer is a static, client-side application. Hosting serves the application code, fonts, and
syntax grammars; Markdown documents and generated PDFs stay in the visitor's browser. There is no
conversion backend, database, or document API. The production origin also loads the Pulseboard SDK
(`public/pulseboard.js`), which sends content-free usage data to the owner's collector; it is inert on
every other origin, including previews, Tailscale and local serves (README "Privacy and usage data").

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
- Current production deployment: `f97778db` from merge commit `df50e7a` (2026-09-27 —
  offline export proofs + two-part production-egress proof, MD3 closed) —
  immutable URL **https://f97778db.mdviewer-c9r.pages.dev/**, deployment id
  `f97778db-22ac-4637-b40c-758ecd96885e`
- Previous production deployment: `c3509120` from merge commit `a56b2f5` (2026-09-27,
  performance budget + 250 kB confirm gate on all ingestion paths, Pulseboard
  SDK 3.3.0) —
  immutable URL **https://c3509120.mdviewer-c9r.pages.dev/**
- Earlier production deployments: `f73c4f85` from `b566e23` (2026-09-26),
  `cdc831b1` from `0da2e26` (2026-09-26), `c3dee6ad` from `578590c`
  (2026-09-26), `f353480c` from `4e7d99a` (2026-09-26) and `3378378d` from
  `8a9c942` (2026-08-16, QA-sweep + PWA release).
- Last operator verification: 2026-09-27 — stable/immutable URLs return HTTP 200 with
  identical bytes (5331) and the entry title; security headers
  (`Cross-Origin-Opener-Policy: same-origin`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`) present;
  `/sw.js` and `/manifest.webmanifest` return `max-age=0, must-revalidate`;
  `/pulseboard.js` serves SDK 3.3.0 byte-identical to the repo artifact
  (SHA-256 `889EB618…B454BA9B4D`) and the lock hash; `/SOURCE.txt` names
  `df50e7a`; the immutable URL boots clean in real Chromium (SDK 3.3.0, 6
  sample sheets, zero console/page errors); `npm run smoke:egress` against the
  immutable URL passes (498 requests, all same-origin — the app phones
  nowhere). Only 1 file uploaded (228 already uploaded): this deploy changes
  tests/docs only, no application bytes. Real-browser install, the
  update-toast flow, and the full Beta-bar acceptance remain operator work
  (AI-7 step 5, AI-8).

The current project uses Wrangler direct upload. To publish a new verified `main` build from an
authenticated maintainer machine:

```powershell
npm run build
npm exec --yes wrangler@4.114.0 -- pages deploy dist --project-name mdviewer --branch main
```

`4.114.0` is the exact Wrangler version used and reviewed for the first deployment; upgrade it as a
separate reviewed change. Direct upload does not automatically deploy later Git pushes, and Cloudflare
does not allow an existing Direct Upload project to switch to Git integration. To preserve the current
project and stable URL while automating deployments, use the reviewed workflow below with this pinned
Wrangler version and scoped Cloudflare API-token/account-id secrets. Alternatively, create a new
Git-integrated Pages project and plan the URL or custom-domain migration explicitly.

### Automated deploy (MD1)

`.github/workflows/deploy.yml` is the reviewed CI-compatible direct-upload path. It is
deliberately manual-only. Live uploads run from `main`; a dry run can verify a reviewed branch
before merge (`gh workflow run deploy.yml --ref <reviewed-branch> -f dry_run=true`). Both paths
first run `agent:check`, build once and run the full Chromium E2E suite against that production
bundle. `scripts/deployment-artifact.mjs` records a sorted file/SHA-256 inventory before E2E,
requires `SOURCE.txt` to identify the exact full revision URL, and rechecks the inventory after
E2E. Only a successful gate uploads `dist/` and the manifest as one immutable Actions artifact.

The separate dry and live jobs download that producer's exact artifact ID in the same run;
download digest mismatches fail, and the manifest verifier rejects changed, missing or extra
files and a different source SHA. The manifest stays outside the Pages upload directory.
Neither consumer rebuilds. The dry job references no GitHub environment or Cloudflare secrets,
so it needs no production approval and creates no GitHub deployment. The live job uses
`production`, verifies the downloaded bytes before reading credentials, uploads those bytes
with Wrangler `4.114.0`, and confirms Cloudflare recorded this SHA. The post-deploy live smoke
below still applies to every automated deploy — the workflow uploads; the runbook verifies.

Real dispatch acceptance remains required; static tests do not prove hosted job behavior:

1. Dispatch the reviewed branch with `dry_run=true` and record the run URL and actual head SHA.
2. Confirm the build/E2E and dry jobs pass, the live job is skipped, and the downloaded
   artifact ID, file inventory and `SOURCE.txt` identify that run's SHA.
3. Confirm the run has no pending environment approvals and creates no new `production`
   deployment record. Keep AI-9 open: a dry run does not satisfy its live-promotion gate.

One-time operator setup (the credentials gate stays human — never commit these):

1. Cloudflare dashboard → Manage Account → API tokens → Create Token with Account /
   Cloudflare Pages / Edit on this account only (the **Edit Cloudflare Workers**
   template also works for Wrangler Pages uploads — prefer the narrower custom
   token).
2. Repository → Settings → Environments → New environment `production` (or open
   the one the first dry run auto-created), then:
   - Deployment branches and tags → Selected branches → add `main` only. This is the
     real branch control: a dispatch runs the workflow file from its own ref, so the
     in-workflow "Refuse non-main refs" step can be edited away on any branch. It
     binds only while `main` itself stays protected (merge protection, AI-5): a
     workflow pushed straight to `main` passes the policy.
   - Required reviewers → yourself, so a live dispatch waits for your approval (the
     promotion gate). The separate dry job uses no environment and does not wait.
   - Environment secrets → add `CLOUDFLARE_API_TOKEN` (the token) and
     `CLOUDFLARE_ACCOUNT_ID` (Manage Account → Account ID). Keep them out of
     repository secrets: those are readable by a workflow on any branch, which the
     two controls above do not cover.
3. Prove the dry path above (no secrets needed), then dispatch once live from `main`, approve
   production and run the live smoke. AI-9 holds the first live automated upload until this
   operator setup is complete; the established authenticated-maintainer direct-upload
   fallback above remains available for an approved, verified build.

Upgrade the pinned Wrangler as a single reviewed change spanning the workflow and
this runbook. Keep the direct-upload notes below: they remain the fallback when
Actions is unavailable.

Confirm what is actually live rather than inferring it from GitHub:

```powershell
npm exec --yes wrangler@4.114.0 -- pages deployment list --project-name mdviewer --json
```

After a deployment, smoke both the stable and immutable URLs, inspect the entry title and hashed
asset response, and confirm the `_headers` policy. Do not record Wrangler tokens or Cloudflare account
identifiers in the repository.

Run the live egress probe against the immutable URL and record its verdict in the deploy record:

```powershell
npm run smoke:egress -- https://<deployment-id>.mdviewer-c9r.pages.dev/
```

It renders the sample, runs both export paths, and fails on any request outside the page origin —
proof the app itself phones nowhere. (The SDK is inert under automation by design, so the probe
observes the app alone.) In CI, `tests/pulse-egress.test.ts` executes the vendored SDK in isolated
jsdom realms at the registered HTTPS origin. Automation, GPC and DNT must suppress all observed
egress after explicit opt-in, event calls, queued timers and lifecycle flushes. A control without
privacy signals must send the region hint and both event lanes only to the collector. The test
intercepts fetch, beacon, XHR, WebSocket/EventSource, worker/importScripts and resource-element
destinations, supplies synthetic responses, and refuses any resource request that bypasses its
interceptor. Element `innerHTML`, `outerHTML` and `insertAdjacentHTML` hooks inspect parsed
resource attributes synchronously, including detached subtrees and images that jsdom does not
load. DOM observation also inspects inserted/removed nodes and changed attributes. CSS
background URLs, navigation, dynamic imports and other parsing APIs remain outside these
behavioral observers. Guard inversions and synthetic alternate sinks are exercised in memory
to verify that these assertions detect regressions; no fixture contacts a live service. Static
source allow-lists supplement this behavior coverage. The `/pulseboard.js` byte-identity check below
extends the checked artifact identity to the served bytes; jsdom does not replace the live
browser probe or the manual Beta-bar acceptance gate.

Building from a downloaded source archive (no `.git`) is supported: `npm run build`
still produces a distribution, and `dist/SOURCE.txt` says so honestly. Such a tree
carries no revision on its own, so whoever produced the archive can identify it with
`MDVIEWER_SOURCE_ID` (a release tag or an archive checksum), which the notice then
names verbatim. Inside a Git checkout the variable is ignored — exact HEAD is the
stronger claim.

## Offline support and installability

MDviewer ships a Workbox-generated service worker (`vite-plugin-pwa`, `generateSW` mode) and a
web-app manifest. `dist/sw.js`, `dist/workbox-<hash>.js`, and `dist/manifest.webmanifest` are
build artifacts — nothing to configure at deploy time.

- The precache is deliberately the **whole** application (~183 entries, ~11 MiB): every lazy
  chunk (Paged.js, Mermaid 12 including its bundled ELK engine, jsPDF/html2canvas-pro, Shiki
  grammars and engine) and the KaTeX `woff2` fonts. This is what makes Print / Download / math
  genuinely work offline instead of only *appearing* to work until the first export. A first
  visit downloads the precache in the background.
- Updates use **prompt, not auto-update**: after a deploy, an already-open session shows a
  "new version available" toast and reloads only when the user accepts. Returning users can be
  one deploy behind until they do.
- The manifest declares `standalone`, `start_url: "/"`, and 192/512/maskable icons, so the app
  is installable from Chrome/Edge and via iOS "Add to Home Screen".
- `public/_headers` serves `/sw.js` and `/manifest.webmanifest` with
  `max-age=0, must-revalidate` (a stale `sw.js` would pin users to an old precache and hide the
  update prompt) and the hashed `/workbox-*.js` as immutable. After each deploy, smoke-check
  those `Cache-Control` values along with the existing header checks.
- Brand assets (favicon, manifest icons, OG card) regenerate from the single source
  `public/favicon.svg` via `node scripts/generate-icons.mjs` (uses the pinned Playwright
  Chromium; no extra dependency).
- Offline proof lives in `tests/e2e/offline.spec.ts` and only runs against the production
  bundle: `npm run build`, then
  `E2E_TARGET=preview npx playwright test tests/e2e/offline.spec.ts`.

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

## Permanent public URL: Cloudflare Pages and automation choices

Cloudflare's Vite guide uses exactly this repository's build contract: `npm run build` and output
directory `dist`. A newly created Git-connected Pages project can rebuild after pushes. The current
`mdviewer` project was created by Wrangler direct upload and cannot be converted in place.

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

Official references: [Cloudflare Pages Vite deployment](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/),
[Direct Upload limitations](https://developers.cloudflare.com/pages/get-started/direct-upload/),
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
