# Pulseboard SDK integration

MDviewer serves the Pulseboard SDK v3 artifact `public/pulseboard.js` (Chris0Jeky/Pulseboard#105),
built by Pulseboard's `observatory/adapters/build-sdk.mjs` for project `mdviewer` and pinned by
`observatory.lock.json` (`"sdk": "3.0.0"`, SHA-256 per target). Never edit the artifact; rebuild it
from a Pulseboard checkout and update the lock:

```sh
cd <Pulseboard>/observatory
node adapters/build-sdk.mjs mdviewer <MDviewer checkout> public/pulseboard.js
```

`node observatory/check.mjs` (`npm run agent:observatory:check`, part of `npm run agent:check` and
CI) verifies the hash against the lock, the `pulseboard-sdk 3.0.0` header, the collector origin
`https://pulseboard-observatory.commit-atlas.workers.dev`, the absence of server constants, and that
the file defines `window.Pulseboard` in a vm without any request before mount or off the registered
origin.

The SDK is active only on `https://mdviewer-c9r.pages.dev`; local runs, Pages previews, automation
(`navigator.webdriver`, so the Playwright suite) and browsers with GPC or DNT get an inert API that
sends nothing. Storage on the collector also requires `mdviewer` in Pulseboard's
`COLLECT_STAT_PROJECTS` and `COLLECT_PRODUCT_PROJECTS`; that is a separate Pulseboard change.

Product code talks to the SDK only through `src/app/pulse.ts`, whose functions take closed enums,
a size bucket and a page count — never a string from a document or a user. `tests/pulse.test.ts`
proves no document text, file name, heading or URL reaches any `window.Pulseboard` call, that the app
works without the SDK, and that JavaScript error events are stopped before the SDK's listener
(`installErrorShield`, because error messages can quote document text). What is sent, what is never
sent and how to turn it off: README "Privacy and usage data".

Event meanings: `export.print_requested` is a print-dialog request, never a claim that a PDF was
saved; `export.pdf_completed` fires only after the raster PDF download finished.
