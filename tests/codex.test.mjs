import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { codexStatus, codexSend, readThread } from '../lib/codex.mjs';
import { projectConfig } from '../lib/config.mjs';
import { fixture, fakeCodex, uuidA } from './helpers.mjs';

function setup(t) {
  const f = fixture(); t.after(f.cleanup);
  const binary = fakeCodex(f), cfg = projectConfig(f.base, 'alpha');
  const req = { project: 'alpha', session: uuidA, id: 'reply-1', text: 'hello $(touch forbidden)\nreply' };
  process.env.TEST_ROOT = f.a; process.env.TEST_QUEUE = path.join(f.dir, 'queue.jsonl');
  t.after(() => { delete process.env.TEST_ROOT; delete process.env.TEST_QUEUE; delete process.env.TEST_FAIL; });
  return { ...f, binary, cfg, req };
}

test('Codex project metadata gates arbitrary existing IDs; wrong project never queues', async t => {
  const f = setup(t);
  const status = await codexStatus(f.binary, uuidA, f.cfg.roots);
  assert.equal(status.membershipVerified, true);
  assert.match(status.statusSource, /not_desktop_liveness/);
  process.env.TEST_ROOT = f.b;
  await assert.rejects(codexSend(f.binary, f.req, f.cfg, f.base), /project_mismatch/);
  assert.equal(fs.existsSync(process.env.TEST_QUEUE), false);
});

test('Codex queue uses argument array, durable dedup and explicit queued-only receipt', async t => {
  const f = setup(t);
  const first = await codexSend(f.binary, f.req, f.cfg, f.base);
  const second = await codexSend(f.binary, f.req, f.cfg, f.base);
  assert.equal(first.delivery, 'queued_only'); assert.equal(second.duplicate, true);
  const calls = fs.readFileSync(process.env.TEST_QUEUE, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1); assert.equal(calls[0][2], uuidA);
  assert.ok(calls[0][4].endsWith(f.req.text));
  await assert.rejects(codexSend(f.binary, { ...f.req, text: 'different' }, f.cfg, f.base), /request_id_conflict/);
});

test('nonzero/ambiguous Codex delivery cannot repeat even with same body', async t => {
  const f = setup(t); process.env.TEST_FAIL = '1';
  await assert.rejects(codexSend(f.binary, f.req, f.cfg, f.base), /delivery_unknown_no_retry/);
  delete process.env.TEST_FAIL;
  await assert.rejects(codexSend(f.binary, f.req, f.cfg, f.base), /delivery_unknown_no_retry/);
  assert.equal(fs.readFileSync(process.env.TEST_QUEUE, 'utf8').trim().split('\n').length, 1);
});

test('invalid thread ID or missing CLI fails closed', async () => {
  await assert.rejects(codexStatus('codex', '--unsafe', []), /invalid_session/);
  await assert.rejects(codexStatus('/definitely-missing-codex', uuidA, []), /codex_unavailable/);
});

test('unresponsive metadata reader times out without ever queueing a message', async t => {
  const f = setup(t); process.env.TEST_SILENT = '1';
  t.after(() => { delete process.env.TEST_SILENT; });
  await assert.rejects(readThread(f.binary, uuidA, { timeoutMs: 100 }), /codex_timeout/);
  assert.equal(fs.existsSync(process.env.TEST_QUEUE), false);
});
