#!/usr/bin/env python3
"""SessionStart hook for MDviewer.

Prints a short orientation message that Claude Code injects into the new
session's context. Keep it terse: it is a signpost, not documentation.

Hook contract: stdout is added to the session context. We read and discard
stdin (Claude Code passes a JSON event there) and never fail the session.
"""
from __future__ import annotations

import sys

CONTEXT = (
    "MDviewer agent context: read CLAUDE.md, AGENTS.md, docs/PRODUCT_VISION.md, "
    "docs/Project_Roadmap.md, and autodoc/AGENT_INDEX.md before editing.\n"
    "CORE INVARIANT: a rendered PDF must NEVER slice a code block, figure, table, "
    "or callout across a page boundary. Paged.js owns pagination; render order is "
    "markdown -> Shiki -> KaTeX -> Mermaid (await) -> Paged.js.\n"
    "Before handoff on agentic-tooling changes, run `npm run agent:hooks:smoke` "
    "and `npm run agent:skills:validate`.\n"
    "Read ACTION_ITEMS.md first and flag every OPEN item in any status summary."
)


def main() -> int:
    try:
        sys.stdin.read()
    except Exception:
        pass
    print(CONTEXT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
