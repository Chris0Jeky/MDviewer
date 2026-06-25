#!/usr/bin/env python3
"""PostToolUse hook for MDviewer (matches Edit|Write|MultiEdit).

When an edit touches the agentic-tooling surface (Claude/Codex contracts,
skills, hooks, MCP config, autodoc, agentic docs), remind the agent to run the
tooling validators before handoff. This is advisory only and never blocks.
"""
from __future__ import annotations

import json
import sys

# Path prefixes that constitute the "agentic tooling" surface.
SENSITIVE_PREFIXES = (
    ".claude/",
    "scripts/agent_hooks/",
    "autodoc/",
    "docs/agentic/",
)

# Specific root files that are part of the contract.
SENSITIVE_FILES = (
    "CLAUDE.md",
    "AGENTS.md",
    ".mcp.json",
    "package.json",
    "ACTION_ITEMS.md",
)

REMINDER = (
    "[agentic-tooling] You edited an agent-facing file. Before handoff run "
    "`npm run agent:hooks:smoke` and `npm run agent:skills:validate`, and keep "
    "CLAUDE.md / AGENTS.md / autodoc/AGENT_INDEX.md in sync if the contract changed."
)


def _normalize(path: str) -> str:
    p = path.replace("\\", "/")
    # Strip a leading "./" prefix without touching a leading dotfile like ".claude".
    if p.startswith("./"):
        p = p[2:]
    return p


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    tool_input = payload.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("path") or ""
    if not path:
        return 0

    norm = _normalize(str(path))
    # Drop everything up to and including the project dir if an absolute path leaked in.
    tail = norm
    if "mdviewer/" in norm.lower():
        tail = norm[norm.lower().rindex("mdviewer/") + len("mdviewer/") :]

    hit = tail.startswith(SENSITIVE_PREFIXES) or tail in SENSITIVE_FILES
    if hit:
        print(REMINDER)
    return 0


if __name__ == "__main__":
    sys.exit(main())
