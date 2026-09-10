# MDviewer hosting compatibility

Reference-only preparation, 2026-09-10. `manifest.json` is an inert, machine-readable intake. It changes no application behavior, hostname, Pages project, billing, telemetry or deployment trigger. Existing workflows may still publish on a future main merge; inspect them first.

Keep the existing Pages Direct Upload project described in `docs/DEPLOYMENT.md`. A custom domain does not require a new runtime, a document-upload service or replacement of that project. Prepare CI-compatible direct upload from the existing verified build rather than assuming a Git push already deploys or that Direct Upload can be changed in place into Git integration.

## Bounded work

MD1 prepares one reviewed publish path with narrowly scoped credentials supplied outside Git. Publish the approved `dist` output only, retain the previous deployment and do not enable an automatic production path as an incidental docs change.

MD2 prepares canonical metadata and base-path tests after an owned hostname is selected. Test direct entry, refresh, lazy same-origin assets, fonts, diagram/render resources and the existing public address. An eventual display-name change must preserve settings namespaces unless a separately tested migration is approved.

MD3 preserves the existing local-only document pipeline, sanitize/render/paginate order and no-slice guarantees. Hosting preparation is not permission for runtime telemetry, third-party scripts, remote document resources or a backend converter. No unregistered name/domain candidate is adopted or published here.

## Verification

Follow the existing `AGENTS.md`, `ACTION_ITEMS.md`, `ORCHESTRATOR.md` and relevant skills. This file is a reference, not a replacement agent workflow. Syntax: `python -m json.tool .hosting/manifest.json`.

Future code/build changes use the existing `npm run agent:check`, `npm run build` and relevant Playwright/export checks. Actual production acceptance additionally inspects emitted files and hosted responses. JSON validation does not establish those results. Keep the PR draft until its applicable checks and independent review have passed; preserve the repository's merge policy.
