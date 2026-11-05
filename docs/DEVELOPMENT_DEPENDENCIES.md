# Development dependency advisory handling

## Scoped glob and minimatch migration — 2026-11-05

The lockfile previously resolved minimatch 10.2.6 for ESLint, config-array,
typescript-estree and Workbox's glob, and glob 11.1.0 for Workbox. Two reviewed
advisories apply:

- [GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249):
  globstar preprocessing can amplify pattern rows beyond the requested budget.
  The advisory identifies minimatch 11.0.1 as the first patched release.
- [GHSA-3g3m-2fjr-6pw4 / CVE-2026-118773](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4):
  canceled glob walks can continue traversing the filesystem. The advisory
  identifies glob 14.0.2 as the first patched release.

The parent-scoped overrides select minimatch 11.0.4 for `eslint`,
`@eslint/config-array` and `@typescript-eslint/typescript-estree`, and glob
14.0.3 for `workbox-build`. Glob 14 supplies its compatible minimatch 11
dependency. Direct ESLint, typescript-eslint and Workbox versions stay governed
by their existing declarations. The application's production dependency entries
are unchanged. The separate `filelist` dependency keeps minimatch 5.1.9, which
falls outside this advisory's affected range.

These changes must travel together. Minimatch 11 uses `Matcher` objects in its
compiled pattern rows; glob 11 assumes those rows contain `RegExp` objects.
Replacing only minimatch can therefore break Workbox's filesystem matching.
The affected linting consumers use the retained named `minimatch` function or
`Minimatch.match`, including partial matching and the `pattern` property.
Workbox uses the retained named `globSync` API with `cwd`, `follow` and
`ignore` options. Both upgraded packages preserve CommonJS entry points and
support the project's Node 24 installation target.

Primary package contracts:

- [minimatch 11.0.4 manifest](https://github.com/isaacs/minimatch/blob/v11.0.4/package.json)
  and [source](https://github.com/isaacs/minimatch/blob/v11.0.4/src/index.ts).
- [glob 14.0.3 manifest](https://github.com/isaacs/node-glob/blob/v14.0.3/package.json)
  and [source](https://github.com/isaacs/node-glob/blob/v14.0.3/src/index.ts).

Reassess these overrides when the respective parent packages adopt patched,
compatible dependency ranges. Remove an override only after checking the
installed consumer and rerunning the compatibility controls.

## Behavioral verification

`tests/dev-dependency-compatibility.test.ts` resolves dependencies from their
actual installed parents through CommonJS. It verifies:

- A deliberately small globstar expansion respects an explicit eight-row budget
  for all four minimatch consumers. The vulnerable version produces 64 rows.
- ESLint discovers the same files and applies a real rule across brace patterns,
  nested paths, dotfiles, Unicode filenames and ignored directories/files.
- Config-array preserves negated ignores and nested/dotfile matching.
- Workbox's real `getManifest` includes the application's precache extensions,
  excludes unwanted files, retains revisions and relative URLs, and respects
  directory-link traversal with `globFollow` enabled or disabled.
- Workbox's installed glob stops initiating directory reads when cancellation is
  delivered during the first read. The fixture bounds all work to a small local
  directory tree and waits for pending callbacks before cleanup.

Before the override, the four expansion controls and cancellation control fail;
the three compatibility controls pass. Qualification also requires a clean
`npm ci --engine-strict`, the full agent checks, both production builds and
inspection of generated precache contents. Browser offline behavior remains
covered by the production Playwright suite. A package audit alone does not
establish consumer compatibility.

Local qualification on Node 24.22.1 passed the eight focused controls, typecheck,
lint, 686 unit tests, four server tests, Observatory checks and both production
builds. The generated service worker contained all 181 expected precache entries,
including 19 WOFF2 assets, without missing, extra or duplicate URLs. A clean
`npm ci --engine-strict --offline` also succeeded with the final lockfile. Hosted
production browser checks remain required before merge; this record makes no
claim that they have run locally.

## Rejected deepmerge advisory

As checked on 2026-11-05, the primary
[CVE Program record for CVE-2026-93753](https://github.com/CVEProject/cvelistV5/blob/main/cves/2026/93xxx/CVE-2026-93753.json)
has state `REJECTED`. Its CNA, VulnCheck, rejected it on
2026-11-02T16:33:19.357Z because it does not describe a security vulnerability.
The fetched record's Git blob was `c8c2d0f6b996779a87c50e142c5d1fb77e8b2cf5`.

The npm/GitHub advisory feed can still report
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) against
deepmerge 4.3.1 and its development-only ancestors. Treat that specific finding
as invalid audit residue while the primary rejection stands. Preserve the raw
audit output and explain a nonzero result; do not describe it as a zero-finding
audit, suppress audit results, or change unrelated packages merely to remove
the stale report. This disposition applies only to this rejected CVE, not to
future deepmerge advisories.

The qualification audit on 2026-11-05 reported zero production findings with
`npm audit --omit=dev`. The full `npm audit` exited nonzero with four low entries:
`deepmerge`, `@rollup/plugin-node-resolve`, `workbox-build` and `vite-plugin-pwa`.
All four trace to this same rejected advisory; no moderate, high or critical
finding remained. No audit suppression was added.
