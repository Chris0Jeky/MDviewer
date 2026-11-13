# Native Save / Save As design

Status: **implemented on Windows (companion push S1a + S1b, 2026-11-11); some
acceptance cases open (see the checklist)**. Issue
[#196](https://github.com/Chris0Jeky/MDviewer/issues/196); companion
[optional recovery design](RECOVERY.md). Prepared against main `5cb2dbb3` on
2026-11-05. Save Markdown (`save_export`) still writes a user-selected copy and
leaves the dirty baseline intact; owned Save/Save As (`save_document`,
`save_document_as` over `src-tauri/src/replace.rs`) implement the rules below.

The behavior, capability and recovery boundaries were independently reviewed and
merged in [#209](https://github.com/Chris0Jeky/MDviewer/pull/209), commit
`2aec9104c7f35f4ac230705e4ba6775e0ee3e7ec`. This completes the design-review
slice. The primitive experiment and the implementation have since landed (see the
status line and checklist); see the [current checkpoint](2026-11-05-editor-followup-checkpoint.md).

## Product decisions

The Windows app should own a file only after an OS-authorized open or successful
Save As. The web/PWA keeps its explicit source-download behavior. Ordinary reading
must not load the editor, start a watcher, open a database or write document state.

| Action / starting state | Destination and result |
| --- | --- |
| Save, new or unbound document | Open Save As; cancel retains the same Untitled document and dirty state. Adopt the chosen destination only after successful persistence. |
| Save, bound and unchanged document | No write and no dialog. Keep focus and the existing binding. |
| Save, bound and edited document | Save the captured source to the bound destination only after native identity/conflict checks pass. |
| Save As, any document | Always ask for a destination. On success, adopt that destination and display name for the same logical document. The previous file is unchanged unless it is the selected destination. |
| Save Copy, any document | Use the existing explicit export path. Do not adopt a binding, rename the document, update its saved baseline or clear dirty state. |
| Save after external content change, replacement, move or deletion | Do not recreate or overwrite automatically. Offer Save As or Cancel; retain the editor text. A separate explicit Reload flow may be added only with discard protection. |
| Save As selects the document's existing destination | Apply the same original-binding conflict check as Save; a picker confirmation cannot bypass it. |
| Save As selects an existing unrelated destination | Require native overwrite confirmation and the same tested compare/replace primitive; snapshot that target at selection. No unchecked final overwrite. |
| Duplicate basenames or the same file opened twice | Keep distinct document identities and capability baselines. A successful save through one binding makes another stale; its later save must conflict rather than silently replace. |

Initial conflict UI deliberately has no **Overwrite anyway** action. Save As keeps
work recoverable without making an unproven race bypass the default. A conflict
message names the current document and reason, never includes document content,
and remains visible until another user action supersedes it. Save, Save As and Save
Copy need distinct accessible names and keyboard hints. Ctrl/Cmd+S becomes native
Save only in the implementation PR; the browser adapter retains source download.

## Ownership and bounded state

Rust owns a per-window, process-lifetime capability registry. An opaque random
token authorizes one logical document; it is not a filename, canonical path or
frontend document ID. Only a validated native picker / launch read or successful
Save As may populate it. The renderer may return the token, captured revision and
bounded text bytes, but cannot choose an arbitrary destination path. Reject an
unknown, revoked, wrong-window or already-busy token before opening a dialog or
writing. Errors expose stable codes and a safe display name, not internal paths.

Each binding retains its native path, volume/file identity, raw-byte digest,
length, encoding and line-ending policy, plus a generation counter. Read the
identity and original bytes through the same validated file handle. Timestamp and
size are useful diagnostics, but are not the equality check: an equal-length edit
or restored timestamp must still conflict. A replaced file with identical bytes
also invalidates the identity. Revalidate the selected local file, parent and
resolved destination at save time; never inherit authority merely from a cached
path string. Symlink/reparse, hard-link, path-alias, network-share and device-path
cases need explicit Windows policy tests before enabling owned writes there.
Preserve existing extension, local-path and read-size restrictions.

The registry is capped by the existing 32-document session. Save source and decoded
admission retain the 25,000,000-byte aggregate bound; general PDF export keeps its
separate 128 MiB bound. One native dialog/write transaction is admitted at a time.
Repeated commands receive a busy result rather than queueing copies of source.
Release capabilities, baseline references and pending work on close/teardown.
Undo Close restores an unbound document with a fresh identity; it cannot revive a
revoked writable capability.

The reader and workspace must transfer a logical document's capability, revision,
saved source and generation together. They may have different UI IDs, but there
must be one ownership map, no basename lookup and no duplicated active capability
owner. A failed transition restores the old owner before releasing the transition
guard. Session positions in #199 remain separate from file authority.

## Captured revisions and completion

Flush pending editor input, then capture immutable `{documentId, revision,
bindingGeneration, text, operationId}` when Save is invoked. A later tab switch,
edit or delayed dialog must not change the bytes being written. Native completion
returns the operation ID, outcome and new binding generation. It does not issue a
generic global “clean” command.

| Completion | Required state transition |
| --- | --- |
| Saved; same logical document/generation still owns the operation | Install the captured text as that document's saved baseline, retain its newer live text, and install the successful native binding. Mark clean only if current source equals the saved source. |
| Saved while newer edits exist | The captured revision is saved; current edits remain dirty. Report “Saved; newer edits remain.” |
| Dialog canceled | No baseline, title, binding, selection or source change. Report cancellation without an error. |
| Conflict or failed write | Preserve source and prior baseline; keep dirty and offer an actionable retry/Save As. Do not rebind to a partially successful destination. |
| Stale or revoked completion | No UI mutation or binding resurrection. Native state must reconcile any operation that crossed its commit point; do not retry it blindly. |

Revisions fence asynchronous work; source equality determines dirty state. Undoing
back to the saved text may become clean even though the edit revision increased.
Retain only the necessary baseline per open document and one in-flight snapshot;
do not accumulate historical sources. Measure that retained baseline and encoding
work in #202 rather than claiming a memory win from token size. Close and workspace
handoff must wait for or explicitly cancel a pending operation before its native
commit point. The existing render lease remains required for PDF exports, but a
plain Markdown save must not force pagination.

## Encoding and line endings

Capture encoding metadata on native open, before decoding discards the BOM. For
owned Save and Save As, preserve UTF-8 with/without BOM and UTF-16 LE/BE with BOM.
New documents use UTF-8 without BOM and LF. Preserve a uniformly CRLF, LF or CR
source by encoding the editor's canonical LF text back to that convention. Preserve
whether the source ends with a newline; do not add one automatically.

Mixed line endings cannot be faithfully reconstructed after textarea editing.
The first owned save of that source must disclose normalization to LF and permit
Cancel or Save As. After a successful accepted conversion, LF becomes its baseline
policy. Invalid Unicode or encoding failures return an error with the source still
available; do not silently replace unpaired surrogates. Save Copy retains today's
documented UTF-8 copy semantics and must not masquerade as byte-preserving Save.
Test byte-for-byte round trips, not just decoded text equality.

## Native persistence gate: atomic is not conflict-safe

Reuse the present writer's same-directory temporary-file, bounded write, `sync_all`
and atomic-persist structure. Do not truncate the original and then write into it.
However, a digest check followed by `persist(destination)` leaves a check-to-replace
window. It is **not** a demonstrated compare-and-replace transaction. A frontend
mutex or a second digest read does not close that window against another process.

Microsoft documents that [CreateFile sharing modes][createfile] last until their
handle closes, including restrictions on writes and deletion/rename. Its
[ReplaceFile contract][replacefile] opens the destination for read/delete with
read/write/delete sharing and documents several distinct failure outcomes.
[Byte-range locks][lockfile] do not stop writes through mapped views. These facts
mean “lock, check, unlock, replace” and an unexamined `ReplaceFileW` substitution
are insufficient proofs. They also mean a lock choice must be tested with the
replacement operation itself, not only with ordinary writes.

Before changing Save Copy semantics, land a small Windows-only experimental test
harness for the candidate primitive. Keep it outside production IPC. It must:

1. Hold the relevant identity/parent ownership through final comparison and commit,
   or document a different mechanism that prevents replacing a newly changed file.
2. Race a separate process performing ordinary writes, truncate, rename/replacement,
   delete/recreate, equal-size/equal-time edits and memory-mapped writes. Include
   already-open handles and mutation of path components. Assert either the intended
   save or a recoverable refusal; never an acknowledged silent loss of external data.
3. Inject denial, sharing violations, exhausted disk, failed flush and failed commit;
   inspect both original and temporary files after each stage and after process exit.
4. Establish the supported local filesystem scope and backup/cleanup behavior. Do
   not advertise power-loss durability solely because a file flush succeeded.

The implementation choice remains blocked on that evidence. If the primitive
cannot meet the intended guarantee for a target, fail closed to Save As/a new
destination; do not relabel a best-effort check as conflict-safe saving. A new
destination needs no-clobber commit semantics so a file created after picker
selection is not accidentally overwritten. Do not adopt Transactional NTFS as a
shortcut: Microsoft [recommends alternatives][txf] for new applications.

This unresolved native gate is explicit engineering work, not a reason to delay
the safe design or to pretend the current export helper already satisfies #196.

### Primitive experiment results

S1a adds an isolated held-handle primitive in `src-tauri/src/replace.rs`, with no
IPC integration. Windows/NTFS release tests exercised 184 separate-process race
trials (100 saves, 84 refusals; no acknowledged external-byte loss), 28 injected
failure/process-exit recovery cases, and altered-artifact recovery refusals.
Ancestor handles exclude write/delete sharing; native same-directory leaf-name
renames avoid reopening those parents. The two-rename namespace gap is journaled,
and an outside claimant is preserved. The full 33-test suite passed within the
60-second budget. ReFS, file symlinks (sandbox creation privilege unavailable), the legacy
file-ID fallback, power-loss durability and production IPC remain unverified.
Unsupported scope and recovery behavior are documented in the native README's
“Conflict-safe replace (experimental)” section. Strict Clippy still reports two
pre-existing `file_policy.rs` lints outside this slice. This evidence does not tick
the implementation gate or qualify native Save.

Hardening after S1b (#229, #313), each with a Windows test in `replace.rs`:

- A save commits under the leaf the file system stores for the original, read from
  its held handle, so a short (8.3) or differently cased input name cannot rename
  the document.

## Implementation slices and qualification

- [x] Independently review this behavior/capability design and the recovery boundary (#209).
- [x] Native primitive experiment above (#226): race harness and fault injection in
      `cargo test`; supported scope in `src-tauri/README.md`.
- [x] Pure saved-baseline/revision state and native bounded capability registry tests,
      including duplicate names, duplicate file identities, stale results and revocation
      (#225; `commands/save.rs` tests; `tests/desktop-owned-save.test.ts`).
- [ ] Owned Save/Save As UI + actual native-dialog tests. Done: Save As through the
      real dialog with a Unicode path, byte-identical UTF-16LE BOM output (Windows smoke);
      byte-exact UTF-8/BOM/UTF-16 × LF/CRLF/CR round trips, conflict/missing/locked,
      stale and revoked completions, cancel, close/release and handoff (unit and Rust
      tests). Open: an in-place Save after a typed edit driven through the real app,
      and single-instance routing while a save is pending.
- [x] Update `AGENTS.md`, `CLAUDE.md`, canonical implementation/native contracts,
      agent index, privacy text and Windows guide (S1b). The web/PWA source download is
      unchanged and the reader entry stays lazy.
- [ ] Exact-head full CI and independent latest-head review before merge. Retain
      ordinary Windows/Narrator/printer/performance acceptance in #169.

The implementation should close #196 only after those acceptance cases pass. This
design alone must not close it or claim native Save is available.

[createfile]: https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew
[replacefile]: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew
[lockfile]: https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex
[txf]: https://learn.microsoft.com/en-us/windows/win32/fileio/deprecation-of-txf
