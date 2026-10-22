# Windows reader implementation plan

Spec: `docs/design/WINDOWS_READER.md`.

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
