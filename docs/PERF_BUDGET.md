# MDviewer performance budget

Large-document behavior is profiled, not guessed. The ladder below is produced by
`tests/e2e/large-doc-perf.spec.ts` (opt-in: `MDVIEWER_PERF=1`), which loads
deterministic stress documents from `tests/perf/generateLargeDoc.ts` through the
real file-input path and times load to paginated.

## Reference measurement (2026-09-26)

Reference machine: 13th Gen Intel i5-13600K, 32 GB RAM, Windows, headless
Chromium (Playwright 1.63). Production bundle (`E2E_TARGET=preview`) built from
the ladder at `f63cb40` (later commits touch docs and the paste/drop gates
only, which do not affect the measured numbers). Times are wall clock from
document load to pagination settled.

| Input | Pages | Wall time | Longtasks (blocking) | JS heap | DOM nodes |
| --- | --- | --- | --- | --- | --- |
| 101 kB | 67 | 2.3 s | 3 (0.5 s) | 7.3 → 27.6 MB | 20,301 |
| 251 kB | 169 | 10.8 s | 84 (7.3 s) | 7.3 → 29.8 MB | 39,279 |
| 501 kB | 338 | 25.1 s | 193 (16.8 s) | 7.3 → 32.0 MB | 78,243 |
| 1.0 MB | 673 | 68.5 s | 505 (59.0 s) | 7.3 → 36.5 MB | 155,833 |
| 1.8 MB | 1206 | 224.5 s | 1061 (209.8 s) | 7.3 → 36.8 MB | 279,525 |

Heap is read with `--enable-precise-memory-info` (the ladder's own
`perf-chromium` project) after a CDP garbage collection, so the delta is
retained memory, not live garbage. Repeat runs vary with machine load: the
250 kB rung measured 6–11 s wall (1–8 s blocking) and the 500 kB rung 18–26 s
across runs, so treat every figure above as approximate and read the
budgets below as wide bands, not thresholds. Budgets are defined on the
production bundle; dev-target numbers are comparison only.

Dev-server comparison on the same machine and commit (unminified, HMR):

| Input | Pages | Wall time | Longtasks (blocking) | JS heap | DOM nodes |
| --- | --- | --- | --- | --- | --- |
| 101 kB | 67 | 2.3 s | 3 (0.4 s) | 24.6 → 65.0 MB | 20,270 |
| 251 kB | 169 | 6.6 s | 9 (1.4 s) | 24.6 → 66.6 MB | 39,248 |
| 501 kB | 338 | 18.5 s | 142 (10.9 s) | 24.6 → 67.5 MB | 78,212 |
| 1.0 MB | 673 | 63.5 s | 476 (53.4 s) | 24.6 → 70.4 MB | 155,802 |
| 1.8 MB | 1206 | 235.1 s | 1052 (220.1 s) | 24.6 → 75.2 MB | 279,494 |

Cost per page grows with document length (roughly 34 ms/page at 67 pages to
186 ms/page at 1206 pages on the production bundle): pagination is
superlinear, so budgets are set per size band, not per page. Main-thread
blocking grows faster still — at the top rung 210 s of 224 s wall time is
longtask blocking, i.e. the page is effectively frozen, which is why the
confirm gate below exists. Retained JS heap grows with input (+20 to
+30 MB over a 7.3 MB baseline); DOM nodes scale linearly (~230–300/page).
The dev target shows the same scaling curve (per-rung wall within ~40%,
dominated by run-to-run load variance rather than the target) — layout
dominates, not module loading — so the ladder is valid on either target.

## The budget

- **Up to 250 kB (~170 pages):** seconds-scale on the reference machine
  (2–11 s wall depending on load). No warning; this is the comfortable band.
- **Above 250 kB:** confirm-to-proceed (`SIZE_SOFT_BYTES`) on every ingestion
  path — file picker/drop, window paste, and editor paste and text drop. The
  dialog is the honest UX for waits of tens of seconds to minutes
  (500 kB → ~18–25 s, 1 MB → ~62–69 s, 1.8 MB → ~3–4 min) during which the
  page is mostly frozen. An editor paste or text drop is confirmed when it
  crosses the gate or is itself over 250 kB; once the user has accepted a
  large document, smaller pastes and drops into it insert natively.
  Gradual in-editor growth past the gate (typing, not
  pasting or dropping) is accepted without a dialog: each debounced render
  grows incrementally, and gating keystrokes would need an async confirm
  plus a textarea revert that discards the native undo history.
- **Above 25 MB:** refused outright (`SIZE_HARD_BYTES`) on every ingestion
  path: pagination would be unusable.
- **Responsiveness:** no unguarded input may block the main thread more than
  ~10 s on the quiet reference machine. The worst unguarded rung (250 kB)
  blocks ~1–2 s quiet, up to ~8 s observed under load; everything above the
  gate carries the confirm dialog. If a future quiet ladder shows the 250 kB
  rung approaching 10 s of blocking, lower the gate — do not widen this
  budget.
- **Memory:** retained JS heap growth must stay under 50 MB at every rung on
  the bundle target (reference: +20 to +30 MB over a 7.3 MB baseline).
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
