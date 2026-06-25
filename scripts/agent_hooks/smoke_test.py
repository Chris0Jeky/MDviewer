#!/usr/bin/env python3
"""Smoke-test the MDviewer agent hooks (`npm run agent:hooks:smoke`).

Drives each hook script with synthetic Claude Code events and asserts the
documented contract:
  - session_start prints orientation context (exit 0)
  - pre_tool_use BLOCKS an unconditionally dangerous command (exit 2)
  - pre_tool_use ALLOWS a safe command (exit 0)
  - post_tool_use flags an edit to an agentic-tooling file
  - post_tool_failure appends a sanitized record to the autolog

Exit 0 if every check passes, 1 otherwise.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

HOOKS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HOOKS))
PY = sys.executable or "python"


def run(script: str, payload: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [PY, os.path.join(HOOKS, script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=ROOT,
        timeout=10,
        env={**os.environ, "CLAUDE_PROJECT_DIR": ROOT},
    )


def main() -> int:
    failures: list[str] = []

    # 1. session_start prints something and exits 0.
    r = run("session_start.py", {"hook_event_name": "SessionStart"})
    if r.returncode != 0 or "MDviewer agent context" not in r.stdout:
        failures.append("session_start did not print orientation context")

    # 2. pre_tool_use blocks a dangerous command.
    r = run("pre_tool_use.py", {"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}})
    if r.returncode != 2:
        failures.append(f"pre_tool_use failed to block 'rm -rf /' (exit {r.returncode})")

    # 3. pre_tool_use allows a safe command.
    r = run("pre_tool_use.py", {"tool_name": "Bash", "tool_input": {"command": "git status"}})
    if r.returncode != 0:
        failures.append(f"pre_tool_use wrongly blocked 'git status' (exit {r.returncode})")

    # 4. post_tool_use flags an agentic-tooling edit.
    r = run("post_tool_use.py", {"tool_name": "Write", "tool_input": {"file_path": ".claude/settings.json"}})
    if "agentic-tooling" not in r.stdout:
        failures.append("post_tool_use did not flag an edit to .claude/settings.json")

    # 5. post_tool_failure writes an autolog line.
    autolog = os.path.join(ROOT, "docs", "agentic", "failure_autolog.jsonl")
    before = os.path.getsize(autolog) if os.path.exists(autolog) else 0
    run("post_tool_failure.py", {
        "tool_name": "Bash",
        "tool_input": {"command": "npm run build"},
        "tool_response": {"error": "smoke-test synthetic failure"},
    })
    after = os.path.getsize(autolog) if os.path.exists(autolog) else 0
    if after <= before:
        failures.append("post_tool_failure did not append to failure_autolog.jsonl")

    if failures:
        print(f"FAIL: {len(failures)} hook smoke check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        return 1

    print("OK: all hook smoke checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
