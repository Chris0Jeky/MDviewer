/* SPDX-License-Identifier: GPL-3.0-only
 * Pulseboard Observatory 0.1.0. Generated; see observatory.lock.json.
 * Disabled until endpoint is configured. No dynamic/CDN dependency. */
(function () {
'use strict';
/** Pulseboard Observatory 0.1.0. Content-free, closed event contract. */
const VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = ['v', 'id', 'session', 'seq', 'event', 'route', 'release', 'value'];
function validateEvent(e, project) {
  if (!e || Object.getPrototypeOf(e) !== Object.prototype || Object.keys(e).some(k => !FIELDS.includes(k))) return false;
  return e.v === VERSION && typeof e.id === 'string' && typeof e.session === 'string' && UUID.test(e.id) && UUID.test(e.session)
    && Number.isSafeInteger(e.seq) && e.seq >= 1 && e.seq <= 1000000
    && project.events.includes(e.event) && project.routes.includes(e.route)
    && project.releases.includes(e.release)
    && (e.value === undefined || (project.measurements.includes(e.event)
      && typeof e.value === 'number' && Number.isFinite(e.value) && e.value >= 0 && e.value <= 3600000));
}

/** No DOM capture, URLs, storage, identity, network or timers before explicit consent. */
function createObserver(config, runtime = globalThis) {
  const { project, endpoint = '', origin, release = 'unattributed', route = 'home' } = config;
  let consent = false, disposed = false, epoch = 0, session = '', seq = 0;
  let queue = [], timer = null, flight = null, lastEvent = 0, failures = 0, requests = 0;
  const stats = { sent: 0, dropped: 0, failures: 0 };
  const privacy = () => runtime.navigator?.doNotTrack === '1' || runtime.navigator?.globalPrivacyControl === true;
  function eligible() {
    try {
      const url = new URL(endpoint);
      return !disposed && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        && runtime.location?.origin === origin && runtime.location.protocol === 'https:'
        && !runtime.navigator?.webdriver && !privacy() && typeof runtime.crypto?.randomUUID === 'function';
    } catch { return false; }
  }
  function clear() {
    epoch++; queue = []; session = ''; seq = 0;
    if (timer !== null) runtime.clearTimeout(timer);
    timer = null; flight?.abort();
  }
  function schedule() {
    if (timer === null && consent && queue.length && !disposed) {
      timer = runtime.setTimeout(() => { timer = null; void flush(); }, 5000);
    }
  }
  function setConsent(value) {
    clear(); consent = value === true && eligible(); failures = 0;
    // Request budget does not reset on consent toggles.
    if (consent) session = runtime.crypto.randomUUID();
    return consent;
  }
  function track(event, options = {}) {
    if (!consent || !eligible()) { if (consent) { consent = false; clear(); } return false; }
    const now = Date.now();
    if (lastEvent && now - lastEvent > 1800000) { session = runtime.crypto.randomUUID(); seq = 0; }
    lastEvent = now;
    const e = { v: 1, id: runtime.crypto.randomUUID(), session, seq: ++seq,
      event, route: options.route ?? route, release };
    if (options.value !== undefined) e.value = options.value;
    if (!validateEvent(e, project) || Object.keys(options).some(k => !['route', 'value'].includes(k))) { stats.dropped++; return false; }
    if (queue.length >= 100 || failures >= 3 || requests >= 120) { stats.dropped++; return false; }
    queue.push(e); schedule(); return true;
  }
  const post = (batch, extra) => runtime.fetch(endpoint, { method: 'POST', credentials: 'omit',
    referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: batch }), ...extra });
  async function flush() {
    if (!eligible()) { consent = false; clear(); return; }
    if (flight || !consent || !queue.length || failures >= 3 || requests >= 120) return;
    const generation = epoch, batch = queue.splice(0, 20);
    const abort = new runtime.AbortController(); flight = abort; requests++;
    const timeout = runtime.setTimeout(() => abort.abort(), 5000);
    try {
      const response = await post(batch, { signal: abort.signal });
      if (!response.ok) throw new Error('collector');
      if (generation === epoch) { stats.sent += batch.length; failures = 0; }
    } catch {
      stats.failures++;
      // Deliberately at-most-once: failed batches are dropped, never revived on re-consent.
      if (generation === epoch) { failures++; stats.dropped += batch.length; }
    } finally {
      runtime.clearTimeout(timeout); if (flight === abort) flight = null; schedule();
    }
  }
  /** The page is being hidden and the timer will never fire: hand the rest of the queue over with keepalive.
   *  Deliberately not navigator.sendBeacon, which attaches cookies and cannot omit credentials. */
  function flushOnHide() {
    if (!consent || !eligible()) return 0;
    const generation = epoch; let handed = 0;
    while (queue.length && failures < 3 && requests < 120) {
      const batch = queue.splice(0, 20); requests++; handed += batch.length;
      try {
        post(batch, { keepalive: true })?.then?.(
          response => { if (generation === epoch) { if (response?.ok) stats.sent += batch.length; else stats.dropped += batch.length; } },
          () => { stats.failures++; if (generation === epoch) stats.dropped += batch.length; });
      } catch { stats.failures++; stats.dropped += batch.length; }
    }
    return handed;
  }
  function dispose() { consent = false; disposed = true; clear(); }
  return { setConsent, track, flush, flushOnHide, dispose, status: () => ({ active: consent && eligible(), queued: queue.length, requests, ...stats }) };
}

/** Optional UI facade. Loaded scripts stay inert until deployment configuration exists. */
function mountObserver(config, create, runtime = globalThis) {
  const { document, location, navigator } = runtime;
  if (!document || !config.endpoint || location?.origin !== config.origin || location.protocol !== 'https:') return null;
  if (!location.pathname.startsWith(config.scopePath || '/')) return null;
  if (navigator?.globalPrivacyControl || navigator?.doNotTrack === '1' || navigator?.webdriver) return null;
  try { const u = new URL(config.endpoint); if (u.protocol !== 'https:' || u.search || u.hash || u.username || u.password) return null; } catch { return null; }
  if (config.publicFlag && runtime[config.publicFlag.global]?.[config.publicFlag.key] !== config.publicFlag.expected) return null;
  const observer = create(config, runtime);
  const key = 'pulseboard:consent:v1:' + config.id + ':' + config.endpoint, CONSENT_MS = 90 * 86400000;
  let granted = false, overdue = false;
  // A stored expiry is never trusted past 90 days from now; a tampered or corrupt one cannot grant indefinite consent.
  try {
    const stored = JSON.parse(runtime.localStorage.getItem(key) || 'null'), cap = Date.now() + CONSENT_MS;
    const until = Number.isFinite(stored?.until) ? Math.min(stored.until, cap) : 0;
    granted = stored?.allow === true && until > Date.now(); overdue = granted && stored.until > cap;
  } catch { /* Session choice still works without storage. */ }
  const details = document.createElement('details'); details.id = 'pulseboard-usage-sharing';
  const title = document.createElement('summary'); title.textContent = 'Usage sharing';
  const note = document.createElement('p'); note.textContent = 'Optional: share a small set of action counts with ' + new URL(config.endpoint).hostname + '. No document text, filenames, form values or browsing history is sent. Raw events expire after 14 days. Your choice lasts 90 days on this browser.';
  const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox';
  label.append(checkbox, document.createTextNode(' Share basic usage for this site'));
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  let announced = false;
  function apply(value, persist) {
    checkbox.checked = observer.setConsent(value);
    status.textContent = checkbox.checked ? 'Sharing is on. Untick to stop future collection.' : 'Sharing is off. The app works normally.';
    if (persist) { try { runtime.localStorage.setItem(key, JSON.stringify({ allow: checkbox.checked, until: Date.now() + CONSENT_MS })); } catch { status.textContent += ' This choice could not be saved.'; } }
    // One page view per page, on the first time sharing is on: re-ticking the box is not another visit.
    if (checkbox.checked && !announced) { announced = true; observer.track('page.view'); void observer.flush(); }
  }
  checkbox.addEventListener('change', () => apply(checkbox.checked, true));
  details.append(title, note, label, status); document.body.append(details); apply(granted, overdue);
  const error = () => observer.track('app.error');
  const click = event => {
    try { for (const item of config.clicks || []) { if (event.target?.closest?.(item.selector)) { observer.track(item.event); break; } } }
    catch { /* A bad selector must never throw inside a listener on the host document. */ }
  };
  runtime.addEventListener('error', error); runtime.addEventListener('unhandledrejection', error); document.addEventListener('click', click);
  const dispose = () => { observer.dispose(); runtime.removeEventListener('error', error); runtime.removeEventListener('unhandledrejection', error); document.removeEventListener('click', click); details.remove(); };
  // A tracked click that navigates would otherwise be discarded by dispose(); hand the queue over first.
  runtime.addEventListener('pagehide', () => { observer.flushOnHide(); dispose(); }, { once: true });
  return { track: observer.track, flush: observer.flush, flushOnHide: observer.flushOnHide, status: observer.status, dispose };
}

const config = {"id":"mdviewer","project":{"events":["page.view","app.ready","app.error","action.requested","action.completed","action.failed","duration.ms","export.print_requested","export.pdf_completed"],"routes":["home","editor"],"releases":["unattributed"],"measurements":["duration.ms"]},"origin":"https://mdviewer-c9r.pages.dev","endpoint":"","scopePath":"/","release":"unattributed","route":"home","clicks":[]};
function start() { globalThis.PulseboardUsage?.dispose(); globalThis.PulseboardUsage = mountObserver(config, createObserver); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
globalThis.addEventListener?.('pageshow', event => { if (event.persisted) start(); });
})();
