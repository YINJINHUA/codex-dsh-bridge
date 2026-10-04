import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { readBounded } from '../lib/read.mjs';
import { readJSON, replaceJSON, register, projectConfig } from '../lib/config.mjs';
import { dshPolicy } from '../lib/dsh-policy.mjs';
import { codexCreate, assertSeparateState } from '../lib/codex-create.mjs';
import { start, respond } from '../plugin/index.mjs';
import { exchange } from '../lib/transport.mjs';

test('bounded file reads accumulate short chunks and reject overflow', t => {
  const f = fixture(); t.after(f.cleanup);
  const file = path.join(f.base, 'short.json'); replaceJSON(file, { text: 'multibyte 中文' });
  const original = fs.readSync;
  fs.readSync = (fd, buffer, offset, length, position) => original(fd, buffer, offset, Math.min(length, 2), position);
  try {
    assert.deepEqual(readJSON(file), { text: 'multibyte 中文' });
    const fd = fs.openSync(file, 'r');
    try { assert.throws(() => readBounded(fd, 5, 'overflow'), /overflow/); }
    finally { fs.closeSync(fd); }
  } finally { fs.readSync = original; }
});

test('malformed permission policy revision fails closed', t => {
  const f = fixture(); t.after(f.cleanup);
  replaceJSON(path.join(f.base, 'dsh-creation-policy.json'),
    { version: 1, newSessionPermission: 'full-access', revision: '-'.repeat(36) });
  assert.throws(() => dshPolicy(f.base), /invalid_dsh_creation_policy/);
});

test('Codex creation rejects overlapping private state before executing or claiming a request', async t => {
  const f = fixture(); t.after(f.cleanup);
  const cfg = { roots: [f.base, f.dir], revision: 'a'.repeat(64) };
  for (const root of [f.base, f.dir]) {
    await assert.rejects(codexCreate('does-not-exist', { op: 'create', id: 'overlap-1', title: 'Overlap test', text: 'Never execute', root, project: 'overlap', revision: cfg.revision }, cfg, f.base),
      /bridge_state_workspace_overlap/);
  }
  const nested = path.join(f.base, 'nested'); fs.mkdirSync(nested);
  assert.throws(() => assertSeparateState(nested, f.base), /bridge_state_workspace_overlap/);
  assert.doesNotThrow(() => assertSeparateState(f.a, f.base));
  assert.equal(fs.existsSync(path.join(f.base, 'creations')), false);
});

for (const worker of [false, true]) test(`sanitized Host errors survive transport (worker=${worker})`, { timeout: 180000 }, async t => {
  const f = fixture(); let stop;
  t.after(async () => { if (stop) await stop(); f.cleanup(); });
  let message = 'windows_security_unavailable';
  f.ctx.sessionController.projections = async () => { throw Error(message); };
  stop = await start(f.ctx, f.base, { worker });
  assert.equal((await exchange(f.base, f.req('status'))).error, message);
  message = 'private path and secret material must not leave Host';
  assert.match((await exchange(f.base, f.req('status'))).error, /^(bridge_error|host_operation_failed)$/);
});

test('response serialization and closed-write failures destroy only their client', () => {
  let destroyed = 0;
  const client = { end() { throw Error('write failure'); }, destroy() { destroyed++; } };
  const cycle = {}; cycle.self = cycle;
  assert.doesNotThrow(() => respond(client, cycle));
  assert.doesNotThrow(() => respond(client, { ok: true }));
  assert.equal(destroyed, 2);
});

test('Worker startup preserves a safe failure classification', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(); t.after(f.cleanup);
  fs.chmodSync(f.base, 0o755);
  await assert.rejects(start(f.ctx, f.base, { worker: true }), /unsafe_directory/);
});
