#!/usr/bin/env python3
"""Validate MDviewer Claude skills (`npm run agent:skills:validate`).

Checks every .claude/skills/<name>/SKILL.md for:
  - a YAML frontmatter block delimited by `---`
  - a `name:` that matches the directory name
  - a non-empty `description:`
  - a `user-invocable:` flag

Also verifies that each skill is referenced in CLAUDE.md's Skill Routing list,
so the contract and the on-disk skills cannot silently drift apart.

Exit 0 if all checks pass, 1 otherwise. Pure stdlib (no PyYAML dependency).
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
SKILLS_DIR = os.path.join(ROOT, ".claude", "skills")
CLAUDE_MD = os.path.join(ROOT, "CLAUDE.md")


def _frontmatter(text: str) -> dict[str, str] | None:
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    block = text[3:end].strip("\n")
    fields: dict[str, str] = {}
    for line in block.splitlines():
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line.strip())
        if m:
            fields[m.group(1).strip()] = m.group(2).strip()
    return fields


def main() -> int:
    errors: list[str] = []
    if not os.path.isdir(SKILLS_DIR):
        print(f"FAIL: skills directory not found: {SKILLS_DIR}")
        return 1

    claude_md_text = ""
    if os.path.isfile(CLAUDE_MD):
        with open(CLAUDE_MD, encoding="utf-8") as fh:
            claude_md_text = fh.read()

    names = sorted(
        d for d in os.listdir(SKILLS_DIR)
        if os.path.isdir(os.path.join(SKILLS_DIR, d))
    )
    if not names:
        print("FAIL: no skills found under .claude/skills/")
        return 1

    for name in names:
        skill_md = os.path.join(SKILLS_DIR, name, "SKILL.md")
        if not os.path.isfile(skill_md):
            errors.append(f"{name}: missing SKILL.md")
            continue
        with open(skill_md, encoding="utf-8") as fh:
            text = fh.read()
        fm = _frontmatter(text)
        if fm is None:
            errors.append(f"{name}: missing or malformed YAML frontmatter")
            continue
        if fm.get("name") != name:
            errors.append(f"{name}: frontmatter name '{fm.get('name')}' != directory '{name}'")
        if not fm.get("description"):
            errors.append(f"{name}: empty description")
        if "user-invocable" not in fm:
            errors.append(f"{name}: missing 'user-invocable' field")
        if claude_md_text and name not in claude_md_text:
            errors.append(f"{name}: not referenced in CLAUDE.md Skill Routing")

    if errors:
        print(f"FAIL: {len(errors)} skill issue(s) across {len(names)} skill(s):")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK: {len(names)} skill(s) validated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
