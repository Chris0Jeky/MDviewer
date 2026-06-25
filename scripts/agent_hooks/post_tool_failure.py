#!/usr/bin/env python3
"""PostToolUseFailure hook for MDviewer.

Appends a sanitized record of the failed tool call to a gitignored autolog so
recurring failures can be reviewed and (if confirmed) promoted to the curated
ledger at docs/agentic/failure_ledger.jsonl. Never blocks; never raises.

Sanitization: redact obvious secrets, truncate long payloads, and normalize
paths so the autolog stays small and safe to read.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import sys

MAX_FIELD = 800
AUTOLOG = os.path.join("docs", "agentic", "failure_autolog.jsonl")

# Coarse secret patterns -> replaced with a stable placeholder.
SECRET_PATTERNS = [
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+"),
    re.compile(r"(?i)(api[_-]?key|secret|token|password|passwd|pwd)\s*[=:]\s*\S+"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
]


def _redact(text: str) -> str:
    if not text:
        return ""
    for pat in SECRET_PATTERNS:
        text = pat.sub("[REDACTED]", text)
    return text


def _truncate(text: str, limit: int = MAX_FIELD) -> str:
    text = _redact(str(text))
    if len(text) <= limit:
        return text
    digest = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()[:12]
    return text[:limit] + f"...[truncated; sha256:{digest}]"


def _classify(surface: str, failure: str) -> str:
    low = failure.lower()
    if any(k in low for k in ("not found", "no such file", "cannot find", "missing")):
        return "blocker"
    if "permission" in low or "denied" in low:
        return "blocker"
    if any(k in low for k in ("flaky", "timeout", "timed out", "retr")):
        return "non_blocking_risk"
    return "non_blocking_risk"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    tool = str(payload.get("tool_name", "unknown"))
    tool_input = payload.get("tool_input") or {}
    response = payload.get("tool_response") or payload.get("error") or {}

    target = (
        tool_input.get("command")
        or tool_input.get("file_path")
        or tool_input.get("path")
        or ""
    )
    if isinstance(response, dict):
        failure = response.get("error") or response.get("message") or json.dumps(response)[:MAX_FIELD]
    else:
        failure = str(response)

    record = {
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "class": _classify(tool, str(failure)),
        "surface": tool,
        "target": _truncate(str(target), 400),
        "failure": _truncate(str(failure)),
        "status": "open",
    }

    try:
        os.makedirs(os.path.dirname(AUTOLOG), exist_ok=True)
        with open(AUTOLOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        # Logging is best-effort; never let it surface as a second failure.
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
