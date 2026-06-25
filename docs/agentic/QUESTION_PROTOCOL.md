# Question Protocol — MDviewer

Do not ask a question just because something is uncertain. Ask only when the
uncertainty is a **true blocker** and cannot be resolved from code, docs, or a
sensible default.

## Decision table

| Situation | Action |
| --- | --- |
| Irreversible product decision (drop a feature, change the core PDF contract) | **Ask** |
| Destructive action (delete a file you did not create, rewrite history) | **Ask** |
| Missing credential or external resource | **Ask** |
| Ambiguous acceptance criterion that changes the deliverable | **Ask** |
| A visual/UX choice with a reasonable default | Proceed, state the assumption |
| Which test lane to add | Proceed (see `mdv-test-harness`) |
| Library/API detail you can verify | Verify (Context7 / docs), don't ask |
| Internal naming, file layout, refactor shape | Proceed, narrow diff |

## How to ask

- Batch all blocker questions into **one** compact message.
- For each, give the decision, the options, and your recommended default.
- Never block the whole task on a question you can park behind an assumption.

## Assumption template

> **Assumption:** <specific choice>.
> **Reason:** <source: code path, doc, or convention>.
> **Reversible by:** <file/setting to change if wrong>.

Record assumptions in the handoff so the next session can audit them.
