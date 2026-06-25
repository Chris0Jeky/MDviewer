# Git Workflow — MDviewer

Plain-language git rules for agents (and humans) working in this repo. The
`scripts/agent_hooks/pre_tool_use.py` hook enforces the destructive-operation
rules below; this document explains the *why* and the recovery paths.

## Branch safety tiers

- **Protected branches** (`main`, `master`, `develop`, `release`): no rebase,
  force-push, hard/soft/mixed reset, `commit --amend`, `checkout -- <path>`,
  `restore`, or `pull --rebase`. The pre-tool hook blocks these outright.
- **Feature branches** (anything else): the same operations are *allowed* but you
  must explain what you are doing and the risk before running them.
- **Always blocked, any branch**: `rm -rf`, `sudo`, `chmod -R 777`, bare
  force-push (`--force` without `--force-with-lease`), `git clean -f`,
  piping a download into a shell, and `npm publish`.

## Default workflow

1. Branch off `main` for any change: `git switch -c feat/<short-name>`.
2. Make a small, reviewable slice (see `mdv-safe-slice`).
3. Keep `main` current with **merge, not rebase**: `git merge main`.
4. Reconcile a diverged remote with `git merge origin/<branch>` (not rebase).
5. **Never `git commit --amend` after pushing.** Make a new commit instead.
6. Open a PR (if using a remote) or merge locally after the gates in
   `CLAUDE.md` › PR Merge Protocol pass.

## Commit style

- Short imperative subject: `fix(paginate): keep tables whole across page breaks`.
- Scope tags mirror the source folders: `render`, `paginate`, `export`, `app`,
  `ui`, `docs`, `test`, `chore`.
- **No `Co-Authored-By` trailer** (`includeCoAuthoredBy` is `false` in
  `.claude/settings.json`). Commits are authored by the human running the agent.

## Explain-before-acting rule

Before any command that rewrites history or discards work (rebase, force-push,
reset, clean, `checkout --`, `restore`):

1. State, in plain language, what the command does.
2. State what could be lost and whether it is reversible.
3. Prefer a non-destructive alternative if one exists.
4. Let the user run it, or proceed only with explicit approval.

## Recovery (always allowed)

- `git rebase --abort`, `git merge --abort`, `git cherry-pick --abort`
- `git stash` / `git stash pop`
- `git reflog` to find lost commits, then `git switch -c rescue <sha>`

## When you get tangled

Stop. Do not attempt destructive recovery to "get unstuck." Tell the user the
current state, what happened, and the safest options first. Never silently
discard work.
