// Guard for the locked Pulseboard SDK v3 artifact (Chris0Jeky/Pulseboard#105).
// It proves the file is the exact reviewed build, points only at the Pulseboard collector,
// publishes no server constants, and defines window.Pulseboard in a vm without making any
// network request before mount, or at all off the registered HTTPS origin.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const COLLECTOR = 'https://pulseboard-observatory.commit-atlas.workers.dev';
const root = new URL('../', import.meta.url);
const lock = JSON.parse(readFileSync(new URL('observatory.lock.json', root), 'utf8'));
assert.equal(lock.sdk, '3.0.0', 'The lock must record SDK 3.0.0');
const entries = Object.entries(lock.installs ?? {});
assert.equal(entries.length, 1, 'The lock must record exactly one installed artifact');

for (const [target, entry] of entries) {
  assert.equal(entry.project, 'mdviewer', target);
  const code = readFileSync(new URL(target, root), 'utf8');
  assert.equal(createHash('sha256').update(code).digest('hex'), entry.sha256, `${target} does not match the lock`);
  assert.match(code.split('\n', 3)[1], /^ \* pulseboard-sdk 3\.0\.0 for mdviewer\. /, 'Header must name pulseboard-sdk 3.0.0');
  assert.ok(code.includes(`"collector":"${COLLECTOR}"`), 'Collector origin must be the Pulseboard Worker');
  assert.ok(code.includes('"origin":"https://mdviewer-c9r.pages.dev"'), 'Registered origin must be the production Pages host');
  assert.ok(!/MAX_BYTES|MAX_BATCH/.test(code), 'Server-only constants must not be published');
  const hosts = new Set([...code.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]));
  for (const host of hosts) {
    assert.ok(['pulseboard-observatory.commit-atlas.workers.dev', 'mdviewer-c9r.pages.dev'].includes(host) || host.endsWith('.test'),
      `Unexpected absolute URL host in the artifact: ${host}`);
  }

  // Load it into a fake window whose DOM is still loading: the API appears, nothing is fetched.
  const network = [];
  const listeners = {};
  const fakeWindow = (href) => {
    const url = new URL(href);
    const ctx = {
      location: { href, origin: url.origin, protocol: url.protocol, pathname: url.pathname, search: '', hash: '' },
      navigator: { webdriver: false },
      document: {
        readyState: 'loading',
        addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      },
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      fetch(...args) { network.push(args); throw new Error('Unexpected network'); },
      console,
    };
    vm.createContext(ctx);
    return ctx;
  };

  const ctx = fakeWindow('http://localhost:5180/');
  vm.runInContext(code, ctx);
  const api = ctx.Pulseboard;
  assert.ok(api, 'window.Pulseboard must be defined');
  assert.equal(api.version, '3.0.0');
  assert.deepEqual(Object.keys(api), ['version', 'route', 'count', 'track', 'consent']);
  assert.equal(network.length, 0, 'No request before mount');
  // Mount off the registered origin: the SDK must stay inert and never throw into the host.
  for (const fn of listeners.DOMContentLoaded ?? []) fn();
  assert.equal(api.route('editor'), false);
  assert.equal(api.count('export.print_requested'), false);
  assert.equal(api.track('doc.opened', { source: 'file', sizeBucket: '<1k' }), false);
  assert.equal(network.length, 0, 'No request off the registered origin');
}
console.log('Pulseboard SDK 3.0.0 artifact: hash, collector, header and inert-off-origin vm run passed. Full host CI remains required.');
