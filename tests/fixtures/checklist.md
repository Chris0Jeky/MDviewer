# Checklist Flow Fixture

This document exists for `tests/e2e/list-flow.spec.ts`. It mirrors the shape of a
real-world human-todo checklist that once paginated badly: one heading, a short
intro, and many LONG task-list items rich in inline code (hyphenated
identifiers, Windows paths, flags, shas). List items must fragment across pages
like paragraphs — a whole item pushed to the next page used to leave up to half
a page blank — and inline code must wrap without auto-hyphenation, which reads
as part of the token and can corrupt a copied command.

Item shape is load-bearing for this fixture: blank lines separate the items (a
loose list, so each item renders as `li > p`), every item carries two solid
paragraphs of inline code so that several items must split across page
boundaries, one item embeds a fenced code block (which must still stay whole
inside its fragmenting parent), and one item carries a 64-character unbreakable
token (which must wrap inside the page instead of overflowing it).

- [x] **q-1 — Create the two agent lanes `jeky-claude-lane` and `jeky-codex-lane`
  and store their keys.** Download both private keys, move them to
  `%LOCALAPPDATA%\agent-lanes\app.pem`, and lock the file down with
  `icacls %LOCALAPPDATA%\agent-lanes\app.pem /inheritance:r` so only the owner
  identity keeps `(OI)(CI)(F)`. Fill `tools/gh-lanes.json` with the two App IDs
  and installation IDs, then run `..\tools\lane-bin\gh.ps1 --verify --lane all`
  and confirm step 8 prints the lane line with `used=1` for each lane.

  Continued: rotate the keys after the first successful run, keeping the
  previous `.pem` bytes in `tools/gh-lanes.json.old` until the new
  installation token answers `gh api user` with the `<app>[bot]` attribution.
  Record the `core 8249/8250` budget line from step 8 next to the lane name so
  the next session can tell at a glance which lane drew on the shared quota.

- [x] **q-2 — Reconcile the occupied live checkout at `C:/Users/jekyt/.claude`.**
  The deployment branch `codex/checkpoint-live-claude-20260803` preserved the
  exact seven modified plus three untracked paths as commit `31fcd772`; verify
  with `git status --short --branch` and `git stash list` before touching
  anything. Fast-forward through `main@4fdfdd45`, confirm level with
  `origin/main`, and re-run the harmless `git status --short --branch` allow
  canary plus the inert force-push dry run that the `1.6.26` banner must block.

  Continued: from clean agent-harness `main`, a reviewed `sync-global --apply`
  must install the changed `~/.codex/REPOS.md` before any fresh session is
  trusted, with recoverable backups kept under `~/.codex/backups/`. Only when
  `doctor` reports canonical == deployed `1.6.26` with green dispatcher and
  activation checks may the old checkpoint branch be deleted with
  `git branch -d` (never `-D` while its upstream still exists).

  Finally: verify one fresh session end to end from that exact root, running
  the `guided-walkthrough` skill over the remaining open items and confirming
  the SessionStart nudge still sees every unchecked `[ ]` box via
  `hooks/session_orientation.py`. The walkthrough must show its own evidence
  dates inline; a bare "done" with no dated proof reopens the item instead of
  closing it, because the verified-completion rule admits no attestations.

- [x] **q-3 — Merge the gates stack oldest-first, watching the `ESTATE.md` row.**
  Both branches rewrote the claude-config row; resolve as a union and never by
  taking one side, keeping this arc's dated privacy paragraph and the
  `HUMAN_TODO.md` cell alongside the gates branch's `.github/` facts. Re-check
  `private: true` with a fresh `gh api repos/Chris0Jeky/MDviewer --jq .private`
  read after the merge, and confirm zero registered runners remain.

  Continued: the feared ESTATE-row collision resolved correctly when
  `origin/main` kept the dated 2026-07-25 measurement, but re-measure anyway:
  run `gh api repos/Chris0Jeky/MDviewer --jq '{private, default_branch}'`
  and compare against the row. If the privacy sentence ever drifts back to the
  old unverified claim, reopen this item instead of editing around it.

- [x] **q-4 — Decide the `workflow_dispatch` workflow and the dormant runners.**
  Fresh REST verification found issue #29 closed and only a dormant
  `workflow_dispatch` workflow; scoped local checks remain the proof surface,
  so do not call them CI. Record the decision in the canonical `ESTATE` row
  with commit `9f49e49`, then verify protection still requires a PR with
  `gh api repos/Chris0Jeky/MDviewer/branches/main/protection`.

  Continued: enumerate the remaining `.github/workflows/*.yml` files and
  confirm each one is either referenced by the row or deleted; a workflow
  that exists but is mentioned nowhere is a finding, not a leftover. Keep the
  `workflow_dispatch` trigger out of any reinstated file unless the decision
  row explicitly blesses it with a date and a reason.

- [x] **q-5 — Post-exposure hardening with CLASSIC protection understood.** The
  protection is CLASSIC with `enforce_admins: false` and
  `required_approving_review_count: 0`, and `rulesets` is `[]`, so an admin's
  own push is not blocked and a PR merges on zero approvals. The declared
  memory-commit lane lets a push carrying nothing but `projects/*/memory/*.md`
  go direct to `main`; GitHub enforces none of that scope, so it is held by
  the agent doing the push plus the local `tests/check-memory-lane.ps1`.

  Continued: read the protection back after every settings change with
  `gh api repos/Chris0Jeky/MDviewer/branches/main/protection --jq` and diff
  it against the row's dated record; silent drift here once hid nineteen days
  of public exposure. Nothing in this paragraph needs an owner action — it is
  recorded so the item is never misread later as "protection with no
  exemption" or "exemption with no enforcement story".

  Finally: re-open only if secrets ever enter that repo's tree or history, and
  define "secrets" the way the exposure note does — a `.pem` file, a pasted
  installation token, or a `tools/gh-lanes.json` with live IDs all count, while
  a bare App slug like `jeky-codex-lane` does not. The decisions and the
  implementation above are verified; the owner confirmed on the amended date
  that the framing still reads right, which is the evidence this item closes
  on rather than any agent paraphrase of the protection JSON.

- [x] **q-6 — Push the agent-harness branch `docs/model-routing-standard`.**
  Verify upstream state first: `agent-harness#50` must read CLOSED and the
  branch content must have landed via the harness sessions before this item
  closes. The sibling Taskdeck item was already done, so only the upstream
  verification with `gh pr view 50 --json state,mergedAt` remains on the
  checklist for this lane of work.

  Continued: after the upstream close, delete the local tracking branch and
  prune with `git fetch --prune`, then confirm `git branch -vv` shows no
  stale `gone` upstreams. If the branch content landed only partially, open a
  follow-up numbered item rather than reopening this one: the push half and
  the landing half deserve separate evidence lines.

- [x] **q-7 — Keep the two checkouts in distinct roles, then clean up.** The
  Desktop checkout is the visible authoring clone used by GitHub Desktop; the
  hidden live deployment checkout at `C:/Users/jekyt/.claude` is dirty and must
  not be deleted or used for unrelated authoring. All 12 stale linked
  worktrees under the Desktop clone were independently inspected with tracked,
  untracked, ignored, and commit-containment checks before plain removal.

  Continued: the two remaining non-main branches both have upstreams and are
  not merged, so they stay; everything else local must already be merged or
  explicitly tracked. Copy the three private ignored reports out with a hash
  check before any removal, exactly as the `operations-foundation` note
  describes, and keep the receipts next to the dated worktree log.

- [x] **q-8 — Decide the upstream tracker items with direct evidence.** The
  upstream owners `agent-harness#30` and `agent-harness#35` are both CLOSED as
  verified with `gh` on the decision day; a record comment was added to the
  local mirror item. Close only after issue-state verification, and keep the
  `q-N` numbering stable: never renumber, never reuse a retired number.

  Continued: the record comment must quote the exact verification commands
  and their output dates, not a paraphrase — future readers re-run the
  commands, they do not trust the prose. If either upstream item ever
  reopens, add a new `q-N` item pointing back here instead of unchecking a
  checked box; history stays append-only.

- [x] **q-9 — Wire the `verify-and-handoff` skill through `sync-global`.**
  From clean agent-harness `main`, a reviewed `sync-global --apply` installed
  the changed `~/.codex/REPOS.md` and the `verify-and-handoff` skill, with
  recoverable backups at `~/.codex/backups/20260803T125703Z` and
  `~/.agents/skills/.harness-backups/20260803T125703Z`. Direct SHA-256
  comparison proves global `REPOS.md` equals the versioned source, and
  `doctor` then reported canonical == deployed `1.6.26` with green checks.

  Continued: run the harmless `git status --short --branch` allow canary and
  the inert force-push dry run from both fresh clients (`claude 2.1.220` and
  `codex 0.146.0`) rooted at that exact checkout before trusting the lane.
  The canary must pass and the dry run must be blocked pre-Git with the
  `1.6.26` banner; any other outcome reopens the deployment item.

  Finally: paste the two lane IDs from step 8 into `tools/gh-lanes.json`
  exactly as printed — `jeky-claude-lane` first, `jeky-codex-lane` second —
  and re-run the full `..\tools\lane-bin\gh.ps1 --verify --lane all` pass to
  confirm `used=1` for each lane with `core 8249/8250` budget remaining. The
  agent half of this item is a printed no-op until the human half lands, so
  nothing below this paragraph may be inferred or pre-checked.

- [x] **q-10 — Hold the commit-exhaustion discriminator out of the gateway.**
  The controlled no-gateway Codex lifecycle discriminator is clean and current
  pressure is non-acute, but the MCP gateway and container lifecycle gates
  stay open. This item historically pre-empts the dependency ordering after
  the 2026-07-26 incident; it closes only on the owner's explicit decision in
  a guided walkthrough, never on agent inference.

  Continued: re-read the incident note before each walkthrough so the
  discriminator stays calibrated — `tests/mutate-gates.ps1` uses a live skill
  file as its mutation probe, and whichever branch lands second must repoint
  those two probes at a skill that still exists. The elevated kernel-pool
  attribution gate is the one that most often surprises; check it first.

- [x] **q-11 — Record the long unbreakable build token visibly and safely.**
  The release pipeline printed exactly one 64-character lowercase hex token
  `a3f9c2e71b4d6085f7e193a6c2d5b8049e6f1a3c7d9b2e5f6084132a7c9d4e6b1` and it
  must appear verbatim in the exported PDF, wrapped inside the page column
  rather than clipped at the paper edge. No hyphen glyph may be inserted
  mid-token: `overflow-wrap: anywhere` with `hyphens: none` breaks the line
  cleanly without inventing characters that corrupt a pasted token.

  Continued: store the same token in `tools/gh-lanes.json.old` next to the
  rotated `.pem` bytes, and confirm the PDF copy matches with a character
  count rather than by eye — sixty-four hex characters, no inserted hyphen,
  no dropped nibble. If the count ever reads sixty-five, the wrapper has
  invented a glyph and the stylesheet regressed.

- [x] **q-12 — Keep the fenced probe whole inside this fragmenting item.** The
  probe below is short enough to fit any page, so pagination must keep it on
  one sheet even when this long parent item splits around it across a page
  boundary; the item fragments, the nested atomic block does not.

  ```typescript
  export interface LaneProbe {
    lane: "jeky-claude-lane" | "jeky-codex-lane";
    used: 1;
  }
  ```

  After the probe, continued prose keeps the item long: re-run
  `..\tools\lane-bin\gh.ps1 --verify --lane all`, confirm the `used=1` line,
  and archive the output next to `tools/gh-lanes.json` for the next review.
  The probe plus both prose paragraphs make this the longest item on purpose,
  so at least one pagination run splits this item across a boundary.

- [x] **q-13 — Reconcile the home-directory hook installation floorlessly.**
  The 2026-09-07 owner decision is floorless for this repository and for
  agent-harness: reconcile Kraspyon's `~/.claude` home with the floorless
  decision, keep the force-push deny rules in the live settings file, and run
  the `/hooks` canary before closing. The swarm merge policy and hard stops
  decided the same night live in `prompts/OVERNIGHT_MUSE_SWARM.md`.

  Continued: the force-push deny rules live in the live settings file, not in
  any checked-in sample — verify with the `/hooks` canary output, not by
  reading the repo. Repositories on this host that rode the global hook are
  enumerated in the follow-up item; do not conflate their evidence with this
  reconciliation's canary proof.

- [x] **q-14 — Close the trust-file loop for the remaining assistants.** The
  Grok trust-file action `28a`, the Muse trust-file action `29a`, and the
  deferred Grok Bot question `28b` stay open for the owner's own hand; agents
  never invent a human acknowledgement. Surface `HUMAN_TODO.md` in every
  summary, walk the list with the `guided-walkthrough` skill, and keep the
  SessionStart nudge seeing every unchecked `[ ]` box.

  Continued: the swarm merge policy and its hard stops are the durable
  record of the 2026-09-20 night session — quote them rather than
  re-deriving them. When the owner completes `28a` or `29a` by hand, close
  only that sub-action and leave the deferred Bot question visibly open with
  its own evidence line.
