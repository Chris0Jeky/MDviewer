# Guard delayed editor mutations by document ownership

**Completed:** [#185](https://github.com/Chris0Jeky/MDviewer/pull/185), merged as
`f0faf7c624b0c0682aaa10d31c0d391efb95500a`, closes
[#184](https://github.com/Chris0Jeky/MDviewer/issues/184). Scope: `Editor.ts`, focused
unit regressions, and native undo browser regressions. The corrected fresh-textarea
implementation passed all five hosted jobs and independent review; the
[authoring checkpoint](2026-11-05-authoring-checkpoint.md) records the exact heads and
later combined-main verification. The reproduced failures below remain historical evidence.

## Failure reproduced

The former large paste/drop continuation confirmed a byte count, then read the live
textarea selection when the promise resolved. Six regressions first failed against
the pristine implementation: a different active document received the insert; an
equal-text document switch was undetected; a moved selection received the insert;
and a destroyed or detached editor could still mutate and report text.

## Contract

`setDocument({ id?, name, text } | null)` retains the host's stable document id.
Legacy callers without ids use the name as a compatibility identity. Hosts with
multiple documents of the same name must supply ids, as App's `DocStore` does.
Same-id, same-text updates leave the textarea value, caret, and undo history alone.
Every document boundary or edit advances a revision, including changes that later
return to the original id or text.

`replaceRange(start, end, text, signal?): Promise<boolean>` accepts an ordered,
in-bounds UTF-16 range. It returns false for unchanged text, invalid ranges, failed
admission, cancellation, stale context, active IME composition, or a noneditable,
destroyed, detached, or inert textarea. The signal is checked before admission and
before committing; it does not dismiss a host's confirmation UI.

Before awaiting confirmation, the operation captures document identity, edit and
selection revisions, full source value, selection endpoints/direction, and the
focused element. It must still own all of those when it resumes. Deliberately
focusing the source is followed by another value/selection ownership check because
a host focus listener can switch documents; that second check permits the command's
own focus change. Rejected or throwing confirmers are treated as refusals without
an unhandled rejection.

Paste and text drop remain native below the existing soft gate. Intercepted inserts,
explicit replacements, and Tab share the guarded insertion path. UTF-8 admission
accounts for the replaced range. A configured hard limit is enforced independently
of the soft threshold or the host's response; a host confirmer is still called so
it can explain a hard-limit refusal. Ordinary typing remains native.

Successful commits use `execCommand("insertText")` so the browser owns the undo
entry. Its native input event is not duplicated. Where that command is unavailable,
the existing manual splice fallback emits one input event for both the editor host
and observers such as Find/Replace. That fallback retains the pre-existing weaker
undo guarantee of unsupported engines; it is not a substitute editor history.

## Equal-content document boundaries

Hosted Chromium exposed that even a different-value assignment retains native undo
history: the equal-content switch regression restored A's earlier text into B.
Every real document identity boundary therefore replaces the textarea with a fresh
native editing host. Editor listeners are removed from the previous node and bound
to the new one; composition state belongs to the new host. The controller's read-only
`input` getter always returns the current node. Integrations that bind listeners to
the textarea must rebind after a document switch. Source focus is retained when the
previous textarea owned it; unrelated controls keep their focus.

Initial adoption of the first typed document during `onInput` keeps the same node:
App creates Untitled from that exact input event, and its native undo entry must
survive. Same-id, same-text updates also preserve the node and caret.

## Verification boundary

Unit tests cover delayed document/selection/value changes, edit-then-undo revisions,
switch-away-and-back revisions, teardown, cancellation, confirmation failure, hard
limits, observable input delivery, native-command preference, IME admission, detached
old-node listeners, typed-document adoption, and delayed accepted edits after a
focus change.
The existing editor tests remain unchanged.

`tests/e2e/editor-edit-safety.spec.ts` checks first-typing undo, equal-content document
switch undo isolation, and undo through the shared Tab path in real Chromium.
Those checks require hosted browser CI; jsdom is not evidence of native undo behavior.

No document persistence, network paths, dependencies, rendering, pagination, export
leases, desktop ownership, or Find/Replace UI were changed by this slice.
AI-6/AI-7/AI-8/AI-9 and Windows #169 remain open. Further work is tracked in
[Future work](../FUTURE_WORK.md) and [#195](https://github.com/Chris0Jeky/MDviewer/issues/195).
