import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const lock = JSON.parse(readFileSync(new URL('observatory.lock.json', root), 'utf8'));
// The lock is keyed by target since Pulseboard#15; the original single-entry shape still reads.
const installs = lock.installs ?? { [lock.target]: { project: lock.project, sha256: lock.sha256 } };
const entries = Object.entries(installs);
assert.ok(entries.length > 0, 'The lock records no installed artifact');
for (const [target, entry] of entries) {
  const code = readFileSync(new URL(target, root), 'utf8');
  assert.equal(createHash('sha256').update(code).digest('hex'), entry.sha256, target);
  assert.ok(code.includes('"endpoint":""'), 'Activation requires a separate reviewed change');
  assert.ok(!/MAX_BYTES|MAX_BATCH/.test(code), 'Server-only constants must not be published');
  const context = { document: { readyState: 'complete' }, fetch() { throw new Error('Unexpected network'); }, setTimeout() { throw new Error('Unexpected timer'); } };
  vm.runInNewContext(code, context);
  assert.equal(context.PulseboardUsage, null);
}
console.log('Observer hash and inactive runtime passed. Full host CI remains required.');
