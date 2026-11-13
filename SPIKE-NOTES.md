# Local pages spike: notes (stopped early, 2026-11-13)

Stopped by the coordinator (owner wind-down) before any build or launch. Nothing below was
measured in a real WebView2 window. Every finding is from reading the pinned sources:
tauri 2.12.4, wry 0.57.0 (Cargo.lock), in `~/.cargo/registry/src/index.crates.io-*/`.
No app, listener or other process was started, and `library.json` was never read or touched.

## Findings from source (unverified at runtime)

1. **Per-root origin is possible through a subdomain.** On Windows wry registers the WebView2
   filter `https://<scheme>.*` (`wry/src/webview2/mod.rs` `attach_custom_protocol_handler`, using
   `AddWebResourceRequestedFilterWithRequestSourceKinds(..., ALL, ALL)` when `ICoreWebView2_22`
   exists, so iframes and shared workers are covered). `custom_protocol_workaround.rs` rewrites
   `https://<scheme>.` to `<scheme>://`. So `https://mdvpage.<token>.localhost/x` should arrive
   in the handler as `mdvpage://<token>.localhost/x`: one origin per token, separate from
   `https://tauri.localhost`. Unverified: that WebView2 resolves and isolates such a host.

2. **The IPC bridge is injected into iframes on Windows.** wry `lib.rs` documents for
   `with_initialization_script_for_main_only`: on Windows, scripts are always added to subframes
   regardless of `for_main_frame_only`. Tauri's `__TAURI_INTERNALS__` and `ipc-protocol.js`
   (which closes over `__TAURI_INVOKE_KEY__`) are marked main-frame-only
   (`tauri/src/manager/webview.rs`), so on Windows a cross-origin frame should get a working
   `__TAURI_INTERNALS__.invoke` that sends the real invoke key. **This disproves the brief's
   assumption that a cross-origin frame cannot reach IPC.** The invoke key is not a wall for
   frames; only the ACL origin check is.

3. **A bare scheme host would be treated as the app (Local origin).** `tauri/src/webview/mod.rs`
   `is_local_url` on Windows treats `https://<name>.localhost` as local when `<name>` is a
   registered URI scheme. So a page on `https://mdvpage.localhost` would get the main
   capability: every command allowed. A page on `https://mdvpage.<token>.localhost` strips to
   `mdvpage.<token>`, which is not a registered protocol, so it should be `Origin::Remote`, and
   with no `remote` capability every app command should be rejected. **The per-token subdomain is
   therefore a security requirement, not a nicety. Never serve pages from the bare scheme host.**

4. **A child webview shares the window's capability.** `resolve_access(cmd, window_label,
   webview_label, origin)`: `capabilities/main.json` scopes by `windows: ["main"]`, which covers
   every webview in that window. A child webview gives no extra isolation unless the capability
   is rescoped to `webviews: [...]`, and it still relies on the Remote origin.

5. **The postMessage fallback is the remaining unknown.** If the frame's CSP blocks
   `https://ipc.localhost`, `ipc-protocol.js` falls back to `window.ipc.postMessage`, which carries
   the key. If WebView2 delivers that frame message to the top-level `WebMessageReceived`, the
   request URL Tauri checks may be the top document (`tauri.localhost`), which is Local. That would
   be a full bypass. It must be measured first.

## Unanswered (not measured)

- Q1 runtime: the actual origin string and subdomain resolution in WebView2.
- Q2: whether the frame runs out of process; whether `__TAURI_INTERNALS__` / `chrome.webview` /
  `window.ipc` exist in the frame; whether commands are rejected over fetch and over postMessage;
  whether a child webview behaves the same way.
- Q3: whether WebView2 honours CSP, Permissions-Policy and Content-Type on scheme responses;
  whether ES modules, workers and wasm load.
- Q4: whether `Sec-Fetch-Dest` / `Sec-Fetch-Mode` reach the handler (wry copies every request
  header WebView2 exposes in `prepare_request`, so the handler will see them if WebView2 sends
  them).
- Q5: every exfiltration route under `default-src 'self'`.
- Q6: process count and private bytes.

## Planned harness (for whoever resumes)

- Handler: `register_asynchronous_uri_scheme_protocol("mdvpage", ..)`. The token comes from the
  host `<token>.localhost`, and the level (CSP) is chosen per token. It logs every request's
  method, URI and headers to a `%TEMP%` log. A same-origin `POST /__report` appends the page's
  results to that log. This is the observation channel: it works under `connect-src 'self'`.
- Leak target: one Python raw TCP+UDP logger on 127.0.0.1 that records connects with no bytes
  (preconnect), HTTP paths tagged per route, and STUN/TURN for WebRTC.
- Main CSP `frame-src` gains `https://mdvpage.<token>.localhost`. A spike thread calls
  `window.eval` to add and remove iframes on a timed plan: one frame per navigation probe (form,
  `location=`, meta refresh, top navigation, `window.open`), plus one bare-host frame for the
  Local-origin IPC test.
- IPC probe command: the existing harmless `take_pending_files`. A resolved value means allowed;
  an ACL error means rejected.
- Wasm fixture: the 41-byte `add` module.
