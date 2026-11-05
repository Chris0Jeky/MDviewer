# Optional desktop crash recovery design

Status: **design reviewed and merged; default-off implementation not started**. Issue
[#197](https://github.com/Chris0Jeky/MDviewer/issues/197), depending on the reviewed
[file-lifecycle design](FILE_LIFECYCLE.md) in #196. Prepared 2026-11-05. Current
documents, latest-close recovery and session positions remain memory-only.

The identity, revocation, capacity and deletion contracts were independently
reviewed with #196 and merged in [#209](https://github.com/Chris0Jeky/MDviewer/pull/209),
commit `2aec9104c7f35f4ac230705e4ba6775e0ee3e7ec`. No recovery storage was enabled.
The implementation, fault-injection and measurement gates below remain open;
see the [current checkpoint](2026-11-05-editor-followup-checkpoint.md).

## User contract

Offer a Windows-only setting **Keep local recovery copies**, off by default. The
description must say that enabling it writes unsaved document content and names
to this Windows account's local application-data folder; those copies may remain
after a crash and may be readable by the account, administrators or backup tools.
Do not imply encryption or cloud sync. Settings persistence alone does not grant
permission to start this writer. Web/PWA storage behavior remains unchanged.

The recovery writer only preserves recoverable edits. It does not save originals,
clear dirty state, bind files, reopen arbitrary native paths, watch files or count
as a successful Save. A recovered document is a fresh, unbound, dirty document;
even if its former original still exists, saving it requires explicit Save As.
Restore, Discard and Discard All must be keyboard accessible and clearly distinguish
the recoverable snapshot from the on-disk original. Do not auto-open recovered
content into an ordinary reader session without a user choice.

## Bounded writer

Store data in one native-owned recovery directory under the current account's
local application data. Rust owns file creation, enumeration, integrity checks and
deletion. The frontend receives bounded snapshot metadata and opaque IDs, never a
general filesystem API. Use unpredictable internal filenames, not document names
or source paths. Do not persist original paths, native save capabilities, telemetry
IDs or writable ownership. Reject symlinks/reparse traversal and validate every
manifest name against that fixed directory before any read or deletion.

Retain at most 32 recoverable documents and 25,000,000 UTF-8 source bytes per complete
generation. Use a versioned manifest with explicit lengths and content digests,
an aggregate metadata bound of 1 MiB, and at most two committed generations plus
one temporary generation. A hard **80 MiB on-disk cap**, including all manifests
and temporary files, bounds that storage. No compression, database or full edit
history is required. At capacity, visibly pause recovery and retain the previous
valid generation; never silently remove an unreviewed recovery to make room.

Coalesce source changes: request a snapshot after one second idle, no more often
than once per five seconds, and at most every 30 seconds during continuous edits.
Those are proposed initial intervals to qualify in #202, not a durability promise.
Allow one native writer and one pending latest-state marker; never queue unbounded
source snapshots. Copy a coherent session generation when work is admitted, write
temporary payloads, flush, then atomically publish its manifest last. Retain the
previous complete generation until the new one is verified. An incomplete or
invalid generation must never supersede a valid one after restart.

The reader starts no recovery work while disabled. When enabled, use an asynchronous
bounded discovery step and start a writer only when recoverable edits exist. Native
disk work stays off WebView2's UI thread. Record source-copy/serialization cost and
retained memory as well as disk-write duration; background work is not free merely
because it runs asynchronously. Reader/workspace handoff preserves the logical
snapshot generation and never writes a transient empty session over recoverable work.

## Lifetime, consent and deletion

| Event | Required behavior |
| --- | --- |
| Enable | Explain local storage, enable the native epoch, then snapshot existing recoverable edits within the bounds. |
| Disable | Revoke the epoch first, stop admissions, cancel/drain the current writer, delete committed and temporary recovery files, and verify deletion. A late writer cannot recreate them. If deletion fails, keep recovery disabled and offer Retry deletion with an honest warning. |
| Successful Save | Remove recovery only for the exact source revision saved; newer edits remain recoverable. Do not treat Save Copy as Save. |
| Explicit close/discard of unsaved document | After discard confirmation, remove its recovery in a committed manifest update and revoke pending snapshots for that identity. A crash during deletion must not silently resurrect dismissed content without explaining the incomplete cleanup. |
| Ordinary clean close | Delete recovery for clean documents; finish or visibly handle pending recovery cleanup. Existing unsaved close protection remains. |
| Restore | Import a bounded copy as a fresh dirty document; retain the recovery until successful owned save or explicit discard so another crash during review does not lose the only copy. |
| Startup after crash | Offer valid recoveries with source name, last successful snapshot time and size. Report damaged entries separately and preserve other valid entries. No content goes to logs. |
| Disk full/access denial | Keep live editor text and the previous valid generation, show that recovery is paused, and offer retry/disable. Do not show “protected” for an unsuccessful snapshot. |

Use an enable/disable epoch plus session/document generations to reject stale
async completions, including ones crossing a settings toggle or process restart.
The on-disk enabled flag cannot outrun the revocation/cleanup ordering. An interrupted
disable must resume deletion on next launch before any recovery admission. No
background process continues after the app exits.

Keep unresolved crash recoveries for **seven days from their last successful
snapshot**, then offer explicit cleanup on the next launch. Do not silently expire
unreviewed content. The storage cap still applies: until the user restores/discards
old data or disables recovery, new snapshotting may be paused with an explanation.
This is a retention/reminder policy, not a promise of automatic secure erasure.
Uninstall must state whether recovery data remains and provide a deliberate deletion
choice; it must not leave the user guessing. Reinstallation cannot silently enable
recovery from an old settings file.

## Trust and failure boundaries

Validate schema version, names, entry count, lengths, checksums and aggregate sizes
before allocating or importing content. Read with fixed bounds even when a manifest
lies. Unknown versions or corruption produce a recoverable notice; do not execute
HTML, open remote resources or follow embedded paths during discovery. Render only
after explicit Restore through the existing sanitization pipeline. Reject tokens
from another process, revoked epoch or arbitrary renderer-supplied filename.

Crash recovery is best-effort protection since the last completed snapshot, not
lossless autosave or an original-file backup. State that limit in the UI. Power loss,
storage damage, user deletion and external modification can still prevent recovery.
Do not add network requests, telemetry content, file paths, titles or source bytes.
The implementation PR must update all existing memory-only/privacy statements for
the narrowly opted-in desktop exception, while retaining the default and web rules.

## Required proof before enabling the feature

- [x] Review #196's identity/revision design first (#209). Recovery must never serialize its
      writable capabilities or change original-file behavior.
- [ ] Pure generation/epoch and bounded-admission tests, with an old writer completing
      after disable, discard, Save, Save Copy and reader/workspace transitions.
- [ ] Real native filesystem fault injection: corrupt/truncated manifests and payloads,
      length/hash mismatch, unknown versions, reparse paths, disk full, denied deletion,
      interruption before/after manifest commit, and restart during disable cleanup.
- [ ] Actual Windows two-process crash/restart tests with exact Unicode source bytes,
      first-run off, opt-in, restore/discard, repeated restore, cleanup and uninstall.
- [ ] Observe steady-state CPU, input latency, source-copy/retained memory and disk
      bytes on #202's workloads; preserve reader startup and use #169 for whole-process
      representative hardware acceptance.
- [ ] Coordinate `AGENTS.md`, `CLAUDE.md`, implementation/native/privacy contracts,
      agent index and Windows guide; exact-head CI and independent review.

This reviewed design advances the storage/retention decision without adding disk persistence.
Keep #197 open until the reviewed implementation and these checks are complete.
