#!/usr/bin/env python3
"""PreToolUse hook for MDviewer (matches Bash).

A second-layer guardrail so that `bypassPermissions` mode stays safe. It blocks:

  1. Unconditionally dangerous shell (any branch): recursive force-delete, sudo,
     world-writable chmod, piping the network into a shell, bare force-push,
     destructive `git clean`, and `npm publish`.
  2. History-rewriting / work-discarding git ops *while on a protected branch*
     (main, master, develop, release): rebase, force-push (incl. --force-with-lease),
     hard/soft/mixed reset, `checkout -- <path>`, `restore`, `commit --amend`,
     and `pull --rebase`.

Contract: exit 0 to allow, exit 2 to block (stderr is shown to the agent).
On any internal error we fail OPEN (exit 0) so the hook can never wedge a session
-- the destructive-pattern denylist in .claude/settings.json still applies.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

PROTECTED_BRANCHES = {"main", "master", "develop", "release"}

# (compiled pattern, human reason) -- denied on ANY branch.
UNCONDITIONAL_DENY = [
    (re.compile(r"\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r", re.I),
     "recursive force-delete (rm -rf) is blocked"),
    (re.compile(r"\bsudo\b", re.I), "sudo is blocked"),
    (re.compile(r"\bchmod\s+-R\s+777\b", re.I), "chmod -R 777 is blocked"),
    (re.compile(r"\b(curl|wget|iwr|irm)\b[^\n|]*\|\s*(sh|bash|iex|powershell)\b", re.I),
     "piping a network download into a shell is blocked"),
    (re.compile(r"\bgit\s+push\b[^\n]*\s(-f\b|--force(?!-with-lease))", re.I),
     "bare force-push (git push --force/-f) is blocked; use --force-with-lease on a feature branch"),
    (re.compile(r"\bgit\s+clean\b[^\n]*-[a-z]*f", re.I),
     "git clean -f permanently deletes untracked files; blocked"),
    (re.compile(r"\bnpm\s+publish\b", re.I), "npm publish is blocked"),
]

# (compiled pattern, human reason) -- denied only on PROTECTED branches.
PROTECTED_DENY = [
    (re.compile(r"\bgit\s+rebase\b(?!\s+--(abort|continue|skip))", re.I),
     "rebase rewrites history"),
    (re.compile(r"\bgit\s+push\b[^\n]*--force-with-lease", re.I),
     "force-push"),
    (re.compile(r"\bgit\s+reset\b[^\n]*--(hard|soft|mixed)", re.I),
     "reset moves/discards commits"),
    (re.compile(r"\bgit\s+checkout\b[^\n]*--\s", re.I),
     "checkout -- <path> discards working-tree changes"),
    (re.compile(r"\bgit\s+restore\b(?![^\n]*--staged\b)", re.I),
     "restore discards working-tree changes"),
    (re.compile(r"\bgit\s+commit\b[^\n]*--amend", re.I),
     "amend rewrites the last commit"),
    (re.compile(r"\bgit\s+pull\b[^\n]*--rebase", re.I),
     "pull --rebase rewrites history"),
]


def _current_branch() -> str | None:
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except Exception:
        return None
    if out.returncode != 0:
        return None
    branch = out.stdout.strip()
    return branch or None


def _deny(reason: str, branch: str | None) -> int:
    where = f" on protected branch '{branch}'" if branch else ""
    sys.stderr.write(
        f"BLOCKED by MDviewer pre_tool_use guard: {reason}{where}.\n"
        "Per CLAUDE.md, explain the operation and its risks in plain language and let "
        "the user run it themselves, or work on a feature branch. Recovery commands "
        "(git rebase --abort, git merge --abort, git stash) are always allowed.\n"
    )
    return 2


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0  # fail open

    if payload.get("tool_name") != "Bash":
        return 0
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not command:
        return 0

    for pat, reason in UNCONDITIONAL_DENY:
        if pat.search(command):
            return _deny(reason, None)

    branch = _current_branch()
    if branch in PROTECTED_BRANCHES:
        for pat, reason in PROTECTED_DENY:
            if pat.search(command):
                return _deny(reason, branch)

    return 0


if __name__ == "__main__":
    sys.exit(main())
