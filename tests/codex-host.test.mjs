import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, fakeCodex, uuidA } from './helpers.mjs';
import { configureCodex } from '../lib/codex-host.mjs';
import { handle, validate } from '../plugin/core.mjs';
import { start } from '../plugin/index.mjs';
import { exchange } from '../lib/transport.mjs';
import { projectConfig, projectFile } from '../lib/config.mjs';
import { readThread } from '../lib/codex.mjs';

function setup(t) {
  const f = fixture(); t.after(f.cleanup);
  const binary = fakeCodex(f);
  process.env.TEST_ROOT = f.a; process.env.TEST_QUEUE = path.join(f.dir, 'queue');
  t.after(() => { delete process.env.TEST_ROOT; delete process.env.TEST_QUEUE; });
  const req = { ...f.req('send', 'alpha', uuidA), target: 'codex' };
  return { ...f, binary, req };
}

test('Codex Host relay is opt-in local configuration; wire cannot choose executable or permission', async t => {
  const f = setup(t);
  await assert.rejects(handle(f.ctx, f.req, f.base), /codex_host_not_configured/);
  for (const extra of [{ binary: f.binary }, { argv: ['exec'] }, { env: {} }, { sandbox: 'danger-full-access' },
    { op: 'configure-codex' }, { target: 'other' }, { op: 'result' }]) {
    assert.throws(() => validate({ ...f.req, ...extra }));
  }
  assert.throws(() => configureCodex(f.base, 'codex'), /absolute/);
  configureCodex(f.base, f.binary);
  assert.equal((await handle(f.ctx, f.req, f.base)).accepted, true);
  assert.equal((await handle(f.ctx, f.req, f.base)).duplicate, true);
  assert.equal(fs.readFileSync(process.env.TEST_QUEUE, 'utf8').trim().split('\n').length, 1);
});

test('relay checks membership, registration and cancellation before dispatch', async t => {
  const f = setup(t); configureCodex(f.base, f.binary);
  process.env.TEST_ROOT = f.b;
  await assert.rejects(handle(f.ctx, f.req, f.base), /project_mismatch/);
  process.env.TEST_ROOT = f.a;
  const abort = new AbortController(); abort.abort();
  await assert.rejects(handle(f.ctx, f.req, f.base, abort.signal));
  await assert.rejects(handle(f.ctx, { ...f.req, revision: '0'.repeat(64) }, f.base), /configuration_changed/);
  assert.equal(fs.existsSync(process.env.TEST_QUEUE), false);
});

test('Codex relay traverses real transport and worker without caller subprocess or duplicate queue', { timeout: 180000 }, async t => {
  const f = setup(t); configureCodex(f.base, f.binary);
  const stop = await start(f.ctx, f.base, { worker: true }); t.after(stop);
  assert.equal((await exchange(f.base, f.req)).value.accepted, true);
  assert.equal((await exchange(f.base, f.req)).value.duplicate, true);
  const { text, ...status } = { ...f.req, op: 'status', id: 'read' };
  assert.equal((await exchange(f.base, status)).value.membershipVerified, true);
  fs.unlinkSync(projectFile(f.base, 'alpha'));
  assert.equal((await exchange(f.base, status)).error, 'unknown_project');
});

test('official name setter rechecks project before mutation and verifies name read-back', async t => {
  const f = setup(t);
  const result = await readThread(f.binary, uuidA, { name: 'Child C', roots: [f.a] });
  assert.equal(result.name, 'Child C');
  await assert.rejects(readThread(f.binary, uuidA, { name: 'Wrong', roots: [f.b] }), /project_mismatch/);
  const cfg = projectConfig(f.base, 'alpha');
  await assert.rejects(readThread(f.binary, uuidA, { name: 'Revoked', roots: cfg.roots,
    beforeRename() { throw Error('revoked'); } }));
});
