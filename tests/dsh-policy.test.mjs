import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sidA } from './helpers.mjs';
import { setup } from './dsh-policy-helpers.mjs';
import { configureDsh, dshPolicy } from '../lib/dsh-policy.mjs';
import { projectConfig, replaceJSON } from '../lib/config.mjs';
import { handle, validate } from '../plugin/core.mjs';
import { setNewSessionPermission } from '../plugin/permission.mjs';
import { validateCodex } from '../lib/codex-host.mjs';

test('DSH creation defaults to inherit; wire accepts only a DSH inherit opt-out', t => {
  const f = setup(t);
  assert.equal(dshPolicy(f.base).newSessionPermission, 'inherit');
  for (const mode of [undefined, 'auto', 'danger-full-access', 'workspace-write']) {
    assert.throws(() => configureDsh(f.base, mode), /invalid_dsh_creation_permission/);
  }
  for (const extra of [{ permission: 'full-access' }, { newSessionPermission: 'full-access' },
    { op: 'configure-dsh' }, { sandbox: 'danger-full-access' }]) assert.throws(() => validate({ ...f.req, ...extra }));
  validate({ ...f.req, dshPermission: 'inherit' });
  for (const mode of ['full-access', 'workspace-write', '', null, false]) {
    assert.throws(() => validate({ ...f.req, dshPermission: mode }), /invalid_create_request/);
  }
  assert.throws(() => validateCodex({ ...f.req, target: 'codex', dshPermission: 'inherit' }), /invalid_create_request/);
  replaceJSON(path.join(f.base, 'dsh-creation-policy.json'), { version: 1, newSessionPermission: 'full-access' });
  assert.throws(() => dshPolicy(f.base), /invalid_dsh_creation_policy/);
});

test('inherit leaves DSH defaults alone; changing policy never upgrades a completed creation', async t => {
  const f = setup(t);
  const first = await handle(f.ctx, f.req, f.base);
  assert.deepEqual(first.permission, { requested: 'inherit', verified: false });
  configureDsh(f.base, 'full-access');
  assert.equal((await handle(f.ctx, f.req, f.base)).duplicate, true);
  await handle(f.ctx, { op: 'send', project: 'alpha', session: sidA, id: 'ordinary-send',
    revision: f.req.revision, text: 'Synthetic ordinary send.' }, f.base);
  assert.equal(f.applied.length, 0);
});

test('permission failure keeps created identity and blocks prompt and automatic recreation', async t => {
  const f = setup(t); configureDsh(f.base, 'full-access');
  f.service.set = () => {};
  await assert.rejects(handle(f.ctx, f.req, f.base), /dsh_permission_verification_failed/);
  assert.equal(f.calls.length, 0);
  const record = JSON.parse(fs.readFileSync(path.join(f.base, 'creations', fs.readdirSync(path.join(f.base, 'creations'))[0])));
  assert.equal(record.state, 'created'); assert.ok(f.sessions.has(record.sessionId));
  await assert.rejects(handle(f.ctx, f.req, f.base), /creation_unknown_no_retry/);
  assert.equal(f.sessions.size, 2);
});

test('local policy revoked during creation or rename prevents first task', async t => {
  for (const phase of ['create', 'rename']) {
    const f = setup(t); configureDsh(f.base, 'full-access');
    const original = f.ctx.sessionController[phase];
    f.ctx.sessionController[phase] = async req => {
      const value = await original(req); configureDsh(f.base, 'inherit'); return value;
    };
    await assert.rejects(handle(f.ctx, f.req, f.base), /configuration_changed/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.applied.length, phase === 'create' ? 0 : 1);
  }
});

test('missing or incompatible permission service and cancellation do not mutate permissions', async t => {
  const f = setup(t);
  f.ctx.get = () => undefined;
  assert.throws(() => setNewSessionPermission(f.ctx, sidA), /dsh_permission_unavailable/);
  f.ctx.get = () => f.service;
  f.service.resolve = () => ({ sandbox: 'danger-full-access', approval: 'ask' });
  assert.throws(() => setNewSessionPermission(f.ctx, sidA), /dsh_permission_unavailable/);
  const abort = new AbortController(); abort.abort();
  assert.throws(() => setNewSessionPermission(f.ctx, sidA, abort.signal));
  assert.equal(f.applied.length, 0);
});
