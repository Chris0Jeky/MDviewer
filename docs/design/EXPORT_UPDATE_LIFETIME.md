# Export and update lifetime

## Render host ownership (#62)

Both export paths hold the existing serialized scheduler after flushing pending preparation. Renders, document changes and close/teardown queue behind the export. A new coalescing batch at each export fence prevents later requests from cancelling the final pre-export preparation. The lock releases on success or failure; task errors remain observable.

Each render captures its settings and filename before asynchronous preparation. Successful pagination publishes that metadata as the only exportable snapshot. Starting a newer preparation invalidates export eligibility: old pages may remain readable on a preparation failure but cannot be downloaded as though they were the latest document. Closing the last document removes Paged.js styles as well as its pages.

## Update consent and recovery (#58)

Worker activation and document reload are separate steps. The update prompt remains dismissible while activation is pending, recovers after rejection/timeout and allows a cancelled reload to be retried without a second controllerchange. Native and plugin readiness notifications converge idempotently. Dismissal cancels owned listeners, timers and queued activation; readiness in another tab never grants reload consent.

App owns the final reload decision, refuses it during export and checks current open work immediately before navigation. A positive explicit confirmation bypasses the native beforeunload prompt only for that navigation, with expiry and exception cleanup. The normal navigation guard remains active after cancellation.

vite-plugin-pwa v1.3.0 source at src/client/build/register.ts ignores the reloadPage argument. The explicit onNeedReload callback suppresses the plugin's own location.reload, rather than relying on updateSW(false). No runtime caching, storage, telemetry or endpoint is introduced.

## Verification scope

Four scheduler regressions pass through an offline adapter executing the actual test file against the actual scheduler. Isolated real Chromium probes pass consent cancellation/one-shot bypass, duplicate readiness/cancel retry, and dismissal-before-activation-microtask cleanup. Component TypeScript checking passes. Added Vitest App orchestration tests verify close deferral, completed-render filename/settings and fail-closed stale exports.

Local npm installation is unavailable due registry DNS failure. Full hosted unit/type/lint/build and production Chromium tests are required; isolated probes are not a substitute for the full app. AI-7 live two-deployment/PWA operator verification remains open. The source archive provenance portion of #62 is not addressed by this change and must remain tracked.
