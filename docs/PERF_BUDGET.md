# MDviewer performance budget

Large-document behavior is profiled, not guessed. The ladder below is produced by
`tests/e2e/large-doc-perf.spec.ts` (opt-in: `MDVIEWER_PERF=1`), which loads
deterministic stress documents from `tests/perf/generateLargeDoc.ts` through the
real file-input path and times load to paginated.

## Reference measurement (2026-09-26)

Reference machine: 13th Gen Intel i5-13600K, 32 GB RAM, Windows, headless
Chromium (Playwright 1.63). Production bundle (`E2E_TARGET=preview`) built from
the ladder commit below. Times are wall clock from document load to pagination
settled.

| Input | Pages | Wall time |
| --- | --- | --- |
| 103 kB | 68 | 2.5 s |
| 507 kB | 341 | 20.2 s |
| 1.0 MB | 678 | 95.9 s |
| 1.8 MB | 1218 | 267.7 s |

Repeat runs vary with machine load: the 1 MB rung measured 65–96 s across
three runs, so treat every figure above as approximate (±30%) and read the
budgets below as wide bands, not thresholds.

Dev-server comparison on the same machine and commit (unminified, HMR):

| Input | Pages | Wall time |
| --- | --- | --- |
| 103 kB | 68 | 2.7 s |
| 507 kB | 341 | 23.5 s |
| 1.0 MB | 678 | 76.0 s |
| 1.8 MB | 1218 | 264.1 s |

Cost per page grows with document length (roughly 36 ms/page at 68 pages to
220 ms/page at 1218 pages on the production bundle): pagination is
superlinear, so budgets are set per size band, not per page. The dev target
measures within 30% of the bundle at every rung — layout dominates, not
module loading — so the ladder is valid on either target.

## The budget

- **Up to 500 kB (~340 pages):** paginates in well under a minute on the
  reference machine. No warning; this is the comfortable band.
- **500 kB – 2 MB:** minutes-scale on the reference machine. The app already
  asks for confirmation above `SIZE_SOFT_BYTES` (2 MB); the confirm dialog is
  the honest UX for this band.
- **Above 2 MB:** confirm-to-proceed (soft gate). Above 25 MB the app refuses
  outright (`SIZE_HARD_BYTES`): pagination would be unusable.
- **CI:** the ladder is skipped by default (`MDVIEWER_PERF` unset) and asserts
  completion only, never a duration — wall times are machine-dependent. Any
  change that makes a ladder rung fail to complete is a regression.

## Re-running

```powershell
$env:MDVIEWER_PERF = '1'
npx playwright test tests/e2e/large-doc-perf.spec.ts          # dev target
$env:E2E_TARGET = 'preview'; npm run build                    # then again
npx playwright test tests/e2e/large-doc-perf.spec.ts          # on the bundle
```

When re-measuring on new hardware or after pipeline changes, replace the
reference table above (keeping the date, machine, and commit) rather than
appending: one current table, history in git.
