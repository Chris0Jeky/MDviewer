---
name: mdv-safe-slice
description: Turn a request into one small reviewable MDviewer change with explicit verification and minimal collateral.
user-invocable: true
---

# mdv-safe-slice

Use this to convert any request into a single narrow diff that a reviewer can read in
one sitting. Prefer narrow edits over rewrites; preserve existing behavior unless the
task explicitly asks to change it.

## Checklist

1. Restate the requested outcome in one sentence.
2. Identify the single seam (`mdv-repo-map`). Confirm the pinned signature in
   `docs/design/IMPLEMENTATION_SPEC.md` section 7 — do NOT change a public signature
   unless the task is the signature; if you must, also run `mdv-interface-map`.
3. Keep the change in one layer (render / paginate / export / ui / app). Cross-layer
   edits are a smell unless the seam genuinely requires it.
4. Honor the strict TS rules: `import type` for type-only imports, guard
   `T | undefined` from indexing, prefix unused params with `_`, no file extensions in
   imports, avoid `any`.
5. Do NOT reorder the render pipeline (spec section 3). Pagination is always last.
6. Add or extend the matching test in the same diff (`mdv-test-harness`).

## Minimal-collateral rules

- Import DOM ids/classes from `src/app/dom.ts`; never hardcode names.
- Import `Settings` from `src/app/settings.ts`.
- No new runtime network calls, telemetry, or document persistence.
- Touch CSS only in the correct file: break rules live in `src/styles/print.css`;
  dynamic `@page` lives in `src/paginate/cssBuilder.ts`; screen chrome in `app.css`.

## Verify

- Run `npm run test` for unit-level changes.
- Run the relevant e2e spec for any layout-affecting change — always
  `tests/e2e/nocutoff.spec.ts` for pagination/break work.
- State exactly what you ran, the result, and what you did NOT verify and why.
