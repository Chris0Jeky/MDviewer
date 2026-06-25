---
name: mdv-interface-map
description: Update autodoc/AGENT_INDEX.md and IMPLEMENTATION_SPEC.md when public MDviewer seams or signatures change.
user-invocable: true
---

# mdv-interface-map

Use this whenever a change alters a public seam: an exported signature, a DOM id/class,
a setting, the render order, or a file's role. Keeping the maps accurate is what lets
agents find seams without bulk-searching.

## When to update

- A pinned signature in `IMPLEMENTATION_SPEC.md` section 7 changed (name, params,
  return type). Code and spec must NOT drift — fix both in the same change.
- A new exported module/function was added, or one was removed/moved.
- A DOM id/class/attr changed in `src/app/dom.ts` (also update spec section 8 and the
  `dom-contract` test).
- A new `Settings` field was added (update `settings.ts`, spec section 7/9, and
  `cssBuilder` if it affects `@page`).

## Procedure

1. Edit `autodoc/AGENT_INDEX.md` to point at the new/changed seam.
2. Edit `docs/design/IMPLEMENTATION_SPEC.md` (sections 6 file tree, 7 signatures, 8 DOM
   names) so it matches the code exactly.
3. If a library integration changed, update `docs/design/LIBRARY_NOTES.md`.
4. Keep the edits minimal and exactly true; do not document aspirational APIs.

## Rules

- The spec is the source of truth when code and docs disagree — never let them drift in
  a merged change.
- DOM names live ONLY in `src/app/dom.ts`; the docs mirror them, they do not redefine
  them.

## Verify

`npm run test` (`tests/dom-contract.test.ts` catches id/class drift; signature changes
break dependent specs at typecheck). Confirm the doc text matches the actual exports
before handoff.
