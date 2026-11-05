# Guard delayed editor mutations by document ownership

Issue: #184. Scope: `Editor.ts`, focused unit regressions, and native undo browser regressions.

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
selection revisions, full source value, and selection endpoints/direction. It must
still own all of those when it resumes. The focus operation is followed by another
ownership check because a host focus listener can switch documents. Rejected or
throwing confirmers are treated as refusals without an unhandled rejection.

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

An identical value assignment can retain a browser's native undo history. A real
document switch therefore forces a synchronous different-value write before seeding
equal text, fencing the previous history without emitting an edit. Initial adoption
of the first typed document during `onInput` is exempt from that write: App creates
Untitled from that exact input event, and the first native undo entry must survive.

## Verification boundary

Unit tests cover delayed document/selection/value changes, edit-then-undo revisions,
switch-away-and-back revisions, teardown, cancellation, confirmation failure, hard
limits, observable input delivery, native-command preference, and IME admission.
The existing editor tests remain unchanged.

`tests/e2e/editor-edit-safety.spec.ts` checks first-typing undo, equal-content document
switch undo isolation, and undo through the shared Tab path in real Chromium.
Those checks require hosted browser CI; jsdom is not evidence of native undo behavior.

No document persistence, network paths, dependencies, rendering, pagination, export
leases, desktop ownership, or Find/Replace UI are changed by this slice.
