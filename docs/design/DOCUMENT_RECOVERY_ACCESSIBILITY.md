# Recovery announcement and phone visibility

The one-close recovery contract and public API remain in IMPLEMENTATION_SPEC.md section 13. This note describes its private presentation details.

Review finding 4108907761 identified that the original status was populated under a hidden row. The new tests in run 36193551103 reproduced that hidden-ancestor problem (411 other unit tests passed) and the phone lifetime hint extending to y=500.36 beyond the toolbar's y=439.875 bottom. The phone failure repeated on retry.

The recovery controller now owns an always-mounted, initially empty `span.visually-hidden.document-recovery-announcement[role=status][aria-atomic=true]` alongside, not inside, the hidden controls. It uses the existing visually-hidden utility. The visible status is ordinary text; the announcement names the closed file and Undo availability. Discard, Undo and teardown clear the announcement together with the snapshot and filename. Teardown removes it. No timer, global listener or new persistence is introduced.

The recovery offer is inserted before the ordinary toolbar rows so Undo, Discard and the retention explanation can be viewed together in the bounded phone toolbar. When there is no recovery the row remains hidden, preserving the normal workspace layout. The source Open/Save keyboard selectors remain unique and unchanged.

Automated coverage checks announcer lifetime and complete offer geometry. It is not a claim of a manual screen-reader test. Final-head CI and independent review remain necessary. The baseline also recorded a separate, retry-passing raster-preview transform timing failure; that is not counted as a clean initial run or attributed to recovery without investigation.
