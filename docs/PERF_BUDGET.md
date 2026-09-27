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
| 101 kB | 67 | 2.3 s | 3 (0.4 s) | 8.5 → 28.3 MB | 20,301 |
| 251 kB | 169 | 6.6 s | 11 (1.6 s) | 8.5 → 39.8 MB | 39,279 |
| 501 kB | 338 | 18.1 s | 126 (9.9 s) | 8.5 → 46.2 MB | 78,243 |
| 1.0 MB | 673 | 62.1 s | 465 (51.8 s) | 8.5 → 42.2 MB | 155,833 |
| 1.8 MB | 1206 | 191.5 s | 1032 (176.4 s) | 8.5 → 84.1 MB | 279,525 |

Heap is read with `--enable-precise-memory-info` (the ladder's own
`perf-chromium` project); without it Chromium reports a coarsened flat
value. Repeat runs vary with machine load (the 1 MB rung measured 59–96 s,
the 500 kB rung 18–26 s), so treat every figure above as approximate (±30%)
and read the budgets below as wide bands, not thresholds.

Dev-server comparison on the same machine and commit (unminified, HMR):

| Input | Pages | Wall time | Longtasks (blocking) | JS heap | DOM nodes |
| --- | --- | --- | --- | --- | --- |
| 101 kB | 67 | 2.3 s | 4 (0.6 s) | 25.8 → 90.2 MB | 20,270 |
| 251 kB | 169 | 6.4 s | 10 (1.4 s) | 25.9 → 69.7 MB | 39,248 |
| 501 kB | 338 | 18.2 s | 127 (10.2 s) | 25.9 → 73.4 MB | 78,212 |
| 1.0 MB | 673 | 62.9 s | 500 (53.9 s) | 25.9 → 84.6 MB | 155,802 |
| 1.8 MB | 1206 | 183.1 s | 1034 (169.5 s) | 25.9 → 93.6 MB | 279,494 |

Cost per page grows with document length (roughly 34 ms/page at 67 pages to
159 ms/page at 1206 pages on the production bundle): pagination is
superlinear, so budgets are set per size band, not per page. Main-thread
blocking grows faster still — at the top rung 176 s of 192 s wall time is
longtask blocking, i.e. the page is effectively frozen, which is why the
confirm gate below exists. Retained JS heap grows with input (+20 to
+76 MB over an 8.5 MB baseline); DOM nodes scale linearly (~230–300/page).
The dev target tracks the bundle within ±20% on wall time at every rung —
layout dominates, not module loading — so the ladder is valid on either
target.

## The budget

- **Up to 250 kB (~170 pages):** seconds-scale on the reference machine
  (2–7 s wall, under 2 s of it blocking). No warning; this is the
  comfortable band.
- **Above 250 kB:** confirm-to-proceed (`SIZE_SOFT_BYTES`) on every ingestion
  path — file picker/drop, window paste, and editor paste. The dialog is the
  honest UX for waits of tens of seconds to minutes (500 kB → ~18 s,
  1 MB → ~62 s, 1.8 MB → ~192 s) during which the page is mostly frozen.
  Gradual in-editor growth past the gate (typing, not pasting) is accepted
  without a dialog: each debounced render grows incrementally, and gating
  keystrokes would need an async confirm plus a textarea revert that
  discards the native undo history.
- **Above 25 MB:** refused outright (`SIZE_HARD_BYTES`) on every ingestion
  path: pagination would be unusable.
- **Responsiveness:** no unguarded input may block the main thread more than
  ~10 s. The worst unguarded rung (250 kB) blocks ~2 s; everything above the
  gate carries the confirm dialog. If a future ladder shows the 250 kB rung
  approaching 10 s of blocking, lower the gate — do not widen this budget.
- **Memory:** retained JS heap growth must stay under 100 MB at every rung
  (reference: +20 to +76 MB over an 8.5 MB baseline on the bundle target).
  DOM nodes must scale linearly with pages (~230–300/page on the reference
  mix); superlinear node growth is a leak-shaped regression.
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
