# Windows reader implementation plan

**Completed:** the original reader/host work merged in
[#158](https://github.com/Chris0Jeky/MDviewer/pull/158). The sequence below is historical;
subsequent New, editing and readiness work is recorded in the
[authoring checkpoint](2026-11-05-authoring-checkpoint.md). Windows acceptance
[#169](https://github.com/Chris0Jeky/MDviewer/issues/169) and AI-6/AI-7/AI-8/AI-9 remain open.
New work is tracked in [Future work](../FUTURE_WORK.md) and
[#195](https://github.com/Chris0Jeky/MDviewer/issues/195).

Spec: [Windows reader design](WINDOWS_READER.md).

1. Implement the isolated native host, bounded file policy, queue and external-link
   policy; prove these with Rust tests. Pin dependencies and generate Cargo.lock.
2. Add the continuous reader entry, ingestion/session policy and serialized native
   queue drain. Test bounds, invalid data and superseded reads before implementation.
3. Add lazy Edit & PDF handoff, preserving edits on return and protecting unsaved
   work on close. Keep the web entry and its render pipeline unchanged.
4. Run real browser scenarios with the desktop CSP, no-slice/export regressions and
   the existing unit suite. Build Windows artifacts in Actions and independently
   review the exact published head before merging.
5. Document installation, measured evidence and remaining Windows acceptance.

Review focus: a second launch during a file read; invalid/oversize/Unicode files;
close or mode change during export; links or HTML attempting native access;
dependencies or Paged.js accidentally loading during plain reading.
