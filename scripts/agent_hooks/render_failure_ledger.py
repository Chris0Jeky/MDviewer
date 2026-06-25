#!/usr/bin/env python3
"""Render docs/agentic/failure_ledger.jsonl into the table in FAILURE_LEDGER.md.

Rewrites the content between the <!-- LEDGER:START --> and <!-- LEDGER:END -->
markers. Pure stdlib. Run from the repo root:

    python scripts/agent_hooks/render_failure_ledger.py
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
JSONL = os.path.join(ROOT, "docs", "agentic", "failure_ledger.jsonl")
MD = os.path.join(ROOT, "docs", "agentic", "FAILURE_LEDGER.md")
START = "<!-- LEDGER:START -->"
END = "<!-- LEDGER:END -->"
COLUMNS = ["date", "class", "surface", "failure", "workaround", "future_fix", "status"]
HEADERS = ["Date", "Class", "Surface", "Failure", "Workaround", "Future fix", "Status"]


def _cell(value: str) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def main() -> int:
    if not os.path.isfile(JSONL):
        print(f"FAIL: {JSONL} not found")
        return 1
    rows = []
    with open(JSONL, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))

    table = ["| " + " | ".join(HEADERS) + " |", "| " + " | ".join(["---"] * len(HEADERS)) + " |"]
    for row in rows:
        table.append("| " + " | ".join(_cell(row.get(c, "")) for c in COLUMNS) + " |")
    block = f"{START}\n" + "\n".join(table) + f"\n{END}"

    with open(MD, encoding="utf-8") as fh:
        md = fh.read()
    if START not in md or END not in md:
        print(f"FAIL: markers not found in {MD}")
        return 1
    pre = md[: md.index(START)]
    post = md[md.index(END) + len(END) :]
    with open(MD, "w", encoding="utf-8") as fh:
        fh.write(pre + block + post)

    print(f"OK: rendered {len(rows)} ledger row(s) into FAILURE_LEDGER.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
