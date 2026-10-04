import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fixture, sidA } from './helpers.mjs';
import { configureDsh, dshPolicy } from '../lib/dsh-policy.mjs';
import { projectConfig, replaceJSON } from '../lib/config.mjs';
import { handle, validate } from '../plugin/core.mjs';
import { setNewSessionPermission } from '../plugin/permission.mjs';
import { start } from '../plugin/index.mjs';
import { exchange } from '../lib/transport.mjs';
import { validateCodex } from '../lib/codex-host.mjs';

function setup(t) {
  const f = fixture(); let stop;
  t.after(async () => { if (stop) await stop(); f.cleanup(); });
  const sessions = new Map([[sidA, { id: sidA }]]), states = new Map(), applied = [];
  const service = {
    resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }),
    set(session, preset) { applied.push(session.id); states.set(session.id, { preset, sandbox: preset, approval: 'never' }); },
    current: session => states.get(session.id)?.preset,
    permissionState: session => states.get(session.id) ?? {}
  };
  f.ctx.get = name => name === 'permissionPresets' ? service : undefined;
  f.ctx.agents.get = id => sessions.has(id) ? { session: sessions.get(id), status: 'idle' } : undefined;
  f.ctx.workspaceRegistry.resolveByPath = async root => ({ id: 'workspace', sessionIds: f.members.get(root) || [] });
  f.ctx.sessionController.create = async ({ sessionId }) => {
    sessions.set(sessionId, { id: sessionId }); f.members.get(f.a).push(sessionId); return { sessionId };
  };
  f.ctx.sessionController.rename = async () => {};
  f.ctx.bridgePermission = (id, signal) => setNewSessionPermission(f.ctx, id, signal);
  const req = { op: 'create', project: 'alpha', id: 'policy-create', revision: projectConfig(f.base, 'alpha').revision,
    root: f.a, title: 'Permission test', text: 'Synthetic authorized task.' };
  return { ...f, req, service, sessions, states, applied,
    async listen(worker) { stop = await start(f.ctx, f.base, { worker }); } };
}

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

for (const worker of [false, true]) test(`explicit inherit keeps Host new-session defaults through ${worker ? 'Worker' : 'Host'}`, { timeout: 180000 }, async t => {
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

test('CLI DSH inherit reaches Host and rejects elevation or use with Codex', { timeout: 180000 }, async t => {
  const f = setup(t); configureDsh(f.base, 'full-access'); await f.listen(true);
  const file = path.join(f.a, 'task.txt'); fs.writeFileSync(file, 'Synthetic authorized worker instructions.');
  const cli = fileURLToPath(new URL('../bin/bridge.mjs', import.meta.url));
  const run = (to, mode) => promisify(execFile)(process.execPath, [cli, 'create', '--project', 'alpha',
    '--to', to, '--request-id', 'cli-inherit', '--title', 'Worker', '--text-file', file, '--dsh-permission', mode],
    { env: { ...process.env, CODEX_DSH_BRIDGE_HOME: f.base }, timeout: 60000 });
  const out = JSON.parse((await run('dsh', 'inherit')).stdout);
  assert.equal(out.ok, true); assert.equal(out.value.permission.source, 'dsh_default');
  for (const [to, mode] of [['codex', 'inherit'], ['dsh', 'full-access']]) {
    await assert.rejects(run(to, mode), error => JSON.parse(error.stdout).error === 'invalid_create_request');
  }
  assert.equal(f.applied.length, 0); assert.equal(f.calls.length, 1);
});

for (const worker of [false, true]) test(`new-session full access is verified before prompt through ${worker ? 'Worker' : 'Host'}`, { timeout: 180000 }, async t => {
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
