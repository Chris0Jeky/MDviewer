# Observatory integration

Shared kit: [Pulseboard #15](https://github.com/Chris0Jeky/Pulseboard/pull/15), source commit `8d92fff11f581d600c357e402cd521426665f318`.

The local SDK is staged with an empty endpoint. It neither sends telemetry nor reads consent storage. MDviewer's current no-upload/no-runtime-API promise remains in force. Do not activate remote reporting merely by merging this PR.

Run `node observatory/check.mjs` and the existing Node 22/24, head-contract, production-build and Playwright checks. Verify the new same-origin asset is precached and that offline rendering/export remains intact. The shared kit's 58 local tests do not replace these host checks.

Activation requires a separately approved product-policy and notice change, collector deployment, CSP review, an updated locked artifact and explicit consent/withdrawal tests. No document text, Markdown, filenames, images, URLs, math source or export contents may enter the event contract.

After deliberate activation the baseline is page views and content-free error occurrence counts. Export names are reserved but not yet wired. `export.print_requested` must mean a dialog request, never a claimed saved PDF. `export.pdf_completed` belongs only after a successful actual PDF operation. A later semantic-hook PR must cover both paths and their failure tests.
