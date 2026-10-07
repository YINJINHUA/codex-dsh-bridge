import test from 'node:test';
import assert from 'node:assert/strict';
import { sidA } from './helpers.mjs';
import { setup } from './dsh-policy-helpers.mjs';
import { configureDsh, dshPolicy } from '../lib/dsh-policy.mjs';
import { exchange } from '../lib/transport.mjs';

// Separate test files provide process isolation for Host and Worker variants.
export function permissionTransportTests(worker) {
test(`explicit inherit keeps Host new-session defaults through ${worker ? 'Worker' : 'Host'}`, { timeout: 180000 }, async t => {
  const f = setup(t); configureDsh(f.base, 'full-access');
  const original = f.ctx.sessionController.create;
  let hostDefault = { preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' };
  f.ctx.sessionController.create = async req => {
    const value = await original(req); f.states.set(req.sessionId, { ...hostDefault }); return value;
  };
  // The full-access coordinator's state must never be copied into the worker.
  f.service.set(f.sessions.get(sidA), 'danger-full-access'); f.applied.length = 0;
  const configured = dshPolicy(f.base);
  await f.listen(worker);
  const req = { ...f.req, dshPermission: 'inherit' };
  const first = await exchange(f.base, req);
  assert.equal(first.ok, true);
  assert.deepEqual(first.value.permission, { requested: 'inherit', verified: false, source: 'dsh_default', overrideApplied: false });
  assert.deepEqual(f.states.get(first.value.sessionId), hostDefault);
  assert.equal((await exchange(f.base, req)).value.duplicate, true);
  const changed = await exchange(f.base, f.req);
  assert.equal(changed.ok, false); assert.equal(changed.error, 'request_id_conflict');
  hostDefault = { preset: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' };
  const second = await exchange(f.base, { ...req, id: 'inherit-full-default' });
  assert.equal(second.ok, true);
  assert.deepEqual(f.states.get(second.value.sessionId), hostDefault);
  assert.deepEqual(f.applied, []); assert.equal(f.calls.length, 2);
  assert.deepEqual(dshPolicy(f.base), configured);
  assert.equal(f.states.get(sidA).sandbox, 'danger-full-access');
});

test(`new-session full access is verified before prompt through ${worker ? 'Worker' : 'Host'}`, { timeout: 180000 }, async t => {
  const f = setup(t); configureDsh(f.base, 'full-access');
  const prompt = f.ctx.sessionController.prompt;
  f.ctx.sessionController.prompt = async req => {
    assert.equal(f.states.get(req.sessionId)?.approval, 'never'); return prompt(req);
  };
  await f.listen(worker);
  const result = await exchange(f.base, f.req);
  assert.equal(result.ok, true); assert.equal(result.value.permission.verified, true);
  assert.equal(result.value.permission.preset, 'danger-full-access');
  assert.deepEqual(f.applied, [result.value.sessionId]);
  configureDsh(f.base, 'inherit');
  assert.equal((await exchange(f.base, f.req)).value.duplicate, true);
  assert.equal(f.applied.length, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.states.has(sidA), false);
});

}
