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

| Input | Pages | Wall time | Longtasks (blocking) | JS heap | DOM nodes |
| --- | --- | --- | --- | --- | --- |
| 101 kB | 67 | 2.2 s | 3 (0.4 s) | 10.0 → 10.0 MB | 20,301 |
| 251 kB | 169 | 6.8 s | 11 (1.6 s) | 10.0 → 10.0 MB | 39,279 |
| 501 kB | 338 | 17.9 s | 113 (9.3 s) | 10.0 → 10.0 MB | 78,243 |
| 1.0 MB | 673 | 62.1 s | 481 (51.6 s) | 10.0 → 10.0 MB | 155,833 |
| 1.8 MB | 1206 | 196.4 s | 1084 (183.5 s) | 10.0 → 10.0 MB | 279,525 |

Repeat runs vary with machine load (the 1 MB rung measured 61–96 s, the
500 kB rung 18–26 s), so treat every figure above as approximate (±30%) and
read the budgets below as wide bands, not thresholds.

Dev-server comparison on the same machine and commit (unminified, HMR):

| Input | Pages | Wall time | Longtasks (blocking) | JS heap | DOM nodes |
| --- | --- | --- | --- | --- | --- |
| 101 kB | 67 | 2.2 s | 4 (0.6 s) | 26.0 → 26.0 MB | 20,270 |
| 251 kB | 169 | 6.2 s | 8 (1.3 s) | 26.0 → 26.0 MB | 39,248 |
| 501 kB | 338 | 18.7 s | 116 (10.2 s) | 26.0 → 26.0 MB | 78,212 |
| 1.0 MB | 673 | 58.7 s | 461 (48.2 s) | 26.0 → 26.0 MB | 155,802 |
| 1.8 MB | 1206 | 200.7 s | 1016 (185.4 s) | 26.0 → 26.0 MB | 279,494 |

Cost per page grows with document length (roughly 33 ms/page at 67 pages to
163 ms/page at 1206 pages on the production bundle): pagination is
superlinear, so budgets are set per size band, not per page. Main-thread
blocking grows faster still — at the top rung 184 s of 196 s wall time is
longtask blocking, i.e. the page is effectively frozen, which is why the
confirm gate below exists. DOM nodes scale linearly (~230–300/page); the JS
heap stays flat because the paginated DOM lives outside the V8 heap, so the
heap pair guards JS-side retention only. The dev target tracks the bundle
within ±20% on wall time at every rung — layout dominates, not module
loading — so the ladder is valid on either target.

## The budget

- **Up to 250 kB (~170 pages):** seconds-scale on the reference machine
  (2–7 s wall, under 2 s of it blocking). No warning; this is the
  comfortable band.
- **Above 250 kB:** confirm-to-proceed (`SIZE_SOFT_BYTES`). The dialog is the
  honest UX for waits of tens of seconds to minutes (500 kB → ~18 s,
  1 MB → ~62 s, 1.8 MB → ~196 s) during which the page is mostly frozen.
- **Above 25 MB:** refused outright (`SIZE_HARD_BYTES`): pagination would be
  unusable.
- **Responsiveness:** no unguarded input may block the main thread more than
  ~10 s. The worst unguarded rung (250 kB) blocks ~2 s; everything above the
  gate carries the confirm dialog. If a future ladder shows the 250 kB rung
  approaching 10 s of blocking, lower the gate — do not widen this budget.
- **Memory:** DOM nodes must scale linearly with pages (~230–300/page on the
  reference mix); superlinear node growth is a leak-shaped regression. The JS
  heap must stay flat rung-over-rung (reference: 10.0 MB before and after at
  every rung on the bundle target).
- **CI:** the ladder is skipped by default (`MDVIEWER_PERF` unset) and asserts
  completion only, never a duration — wall times are machine-dependent. Any
  change that makes a ladder rung fail to complete, show the fatal card, or
  misplace the confirm dialog is a regression.

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
